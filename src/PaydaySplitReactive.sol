// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { AbstractReactive } from "@reactive/src/base/AbstractReactive.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title PaydaySplitReactive — Income Waterfall on Lasna
/// @notice Mirrors each user's ordered bucket list from the BucketsSet event, subscribes to that
///         user's incoming ERC-20 transfers, and asks the destination chain to run the waterfall.
/// @dev    One subscription to BucketsSet plus one Transfer subscription per active (user, token).
///         The contract never holds principal; it only decides when the destination should act.
contract PaydaySplitReactive is AbstractReactive, Ownable2Step {
    /// @notice ERC-20 Transfer(address indexed from, address indexed to, uint256 value).
    uint256 public constant TRANSFER_TOPIC_0 = uint256(keccak256("Transfer(address,address,uint256)"));
    /// @notice PaydaySplit.BucketsSet(address indexed user, address indexed token, uint256 indexed version, ...).
    uint256 public constant BUCKETS_SET_TOPIC_0 =
        uint256(keccak256("BucketsSet(address,address,uint256,address[],uint96[],uint16[],bool[])"));

    uint256 public constant MAX_BUCKETS = 8;
    uint16 public constant MAX_TOTAL_BPS = 10_000;
    uint64 public constant CALLBACK_GAS_LIMIT = 2_000_000;
    uint64 public constant RETRY_CALLBACK_GAS_LIMIT = 1_800_000;
    address public constant CRON_SOURCE = 0x0000000000000000000000000000000000fffFfF;
    uint256 public constant CRON1000_TOPIC = 0xe20b31294d84c3661ddc8f423abb9c70310d0cf172aa2714ead78029b325e3f4;
    uint256 public constant USER_CALLBACK_LIMIT = 100;

    uint8 public constant SKIP_INACTIVE = 1;
    uint8 public constant SKIP_BELOW_MIN = 2;
    uint8 public constant SKIP_SELF = 3;
    uint8 public constant SKIP_DUPLICATE = 4;
    uint8 public constant SKIP_NO_BUDGET = 5;
    uint8 public constant SKIP_USER_BUDGET = 6;

    struct Rule {
        address[] payees;
        uint96[] fixedAmounts;
        uint16[] bps;
        bool[] active;
        uint256 version;
        uint8 activeCount;
        bool subscribed;
    }

    event RuleMirrored(
        address indexed user, address indexed token, uint256 indexed version, uint8 activeCount, bool subscribed
    );
    event Subscribed(address indexed user, address indexed token);
    event Unsubscribed(address indexed user, address indexed token);
    event Seen(address indexed user, address indexed token, uint256 amount, uint256 originTxHash, uint256 logIndex);
    event CallbackRequested(address indexed user, address indexed token, uint256 amount, uint256 originTxHash);
    event Skipped(address indexed user, address indexed token, uint256 amount, uint8 reason);
    event PausedSet(bool paused);
    event ToppedUp(uint256 remaining, uint256 added);
    event MinPaycheckSet(uint256 minPaycheck);
    event UserBudgetReset(address indexed user, address indexed token, uint256 remaining);
    event RetryScheduleSet(uint256 remaining);
    event RetryCallbackRequested(uint256 indexed tick, uint256 remaining);

    error ZeroAddress();

    uint256 public immutable CHAIN_ID;
    address public immutable CONFIG_CONTRACT;
    uint256 public immutable DEST_CHAIN_ID;
    address public immutable CALLBACK_CONTRACT;

    mapping(address => mapping(address => Rule)) private _rules;
    mapping(address => mapping(address => uint256)) public userRemaining;
    mapping(bytes32 => bool) public seen;
    uint256 public remaining;
    uint256 public minPaycheck;
    bool public paused;
    uint256 public remainingRetryCalls;
    uint256 public lastRetryTick;

    constructor(
        uint256 chainId_,
        address configContract_,
        uint256 destChainId_,
        address callbackContract_,
        uint256 limit_
    ) payable Ownable(msg.sender) {
        if (configContract_ == address(0) || callbackContract_ == address(0)) {
            revert ZeroAddress();
        }
        CHAIN_ID = chainId_;
        CONFIG_CONTRACT = configContract_;
        DEST_CHAIN_ID = destChainId_;
        CALLBACK_CONTRACT = callbackContract_;
        remaining = limit_;

        SYSTEM.subscribe(
            chainId_, configContract_, BUCKETS_SET_TOPIC_0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
    }

    // ---------------------------------------------------------------------
    // Reactive entry point
    // ---------------------------------------------------------------------

    /// @inheritdoc IReactive
    function react(LogRecord calldata log_) external onlySystem {
        if (log_.topic0 == CRON1000_TOPIC) {
            _onRetryTick(log_);
            return;
        }
        if (log_.topic0 == BUCKETS_SET_TOPIC_0) {
            _mirrorRule(log_);
            return;
        }
        if (log_.topic0 == TRANSFER_TOPIC_0) {
            _onTransfer(log_);
        }
    }

    function setRetrySchedule(uint256 limit_) external onlyOwner {
        if ((limit_ == 0) != (remainingRetryCalls == 0)) _retrySubscription(limit_ != 0);
        remainingRetryCalls = limit_;
        emit RetryScheduleSet(limit_);
    }

    function _retrySubscription(bool enabled) private {
        if (enabled) {
            SYSTEM.subscribe(
                block.chainid, CRON_SOURCE, CRON1000_TOPIC, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
            );
        } else {
            SYSTEM.unsubscribe(
                block.chainid, CRON_SOURCE, CRON1000_TOPIC, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
            );
        }
    }

    function _onRetryTick(LogRecord calldata log_) private {
        if (
            paused || remainingRetryCalls == 0 || log_.chainId != block.chainid || log_.contractAddress != CRON_SOURCE
                || log_.opCode != 1 || log_.data.length != 32
        ) return;
        uint256 tick = abi.decode(log_.data, (uint256));
        if (tick <= lastRetryTick || tick != log_.blockNumber || tick % 1_000 != 0) return;
        lastRetryTick = tick;
        --remainingRetryCalls;
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: DEST_CHAIN_ID,
                recipient: CALLBACK_CONTRACT,
                gasLimit: RETRY_CALLBACK_GAS_LIMIT,
                payload: abi.encodeWithSignature("executeRetries(address)", address(0))
            })
        );
        if (remainingRetryCalls == 0) _retrySubscription(false);
        emit RetryCallbackRequested(tick, remainingRetryCalls);
    }

    // ---------------------------------------------------------------------
    // Rule mirroring
    // ---------------------------------------------------------------------

    function _mirrorRule(LogRecord calldata log_) internal {
        if (log_.chainId != CHAIN_ID || log_.contractAddress != CONFIG_CONTRACT) return;

        // forge-lint: disable-next-line(unsafe-typecast)
        address user = address(uint160(log_.topic1));
        // forge-lint: disable-next-line(unsafe-typecast)
        address token = address(uint160(log_.topic2));
        uint256 version = log_.topic3;
        if (user == address(0) || token == address(0) || version == 0) return;

        Rule storage rule = _rules[user][token];
        // At-least-once delivery / reorg can replay an older event. Never downgrade the mirror:
        // that would make every subsequent callback stale and silently stop the waterfall.
        if (version <= rule.version) return;

        (address[] memory payees, uint96[] memory fixedAmounts, uint16[] memory bps, bool[] memory active) =
            abi.decode(log_.data, (address[], uint96[], uint16[], bool[]));

        uint256 len = payees.length;
        if (len != fixedAmounts.length || len != bps.length || len != active.length) return;
        if (len > MAX_BUCKETS) return;

        uint256 totalBps = 0;
        uint8 activeCount = 0;
        for (uint256 i; i < len; ++i) {
            if (bps[i] > MAX_TOTAL_BPS) return;
            if (!active[i]) continue;
            if (payees[i] == address(0) || payees[i] == user || payees[i] == CONFIG_CONTRACT) return;
            if (fixedAmounts[i] == 0 && bps[i] == 0) return;
            totalBps += bps[i];
            activeCount++;
        }
        if (totalBps > MAX_TOTAL_BPS) return;

        delete rule.payees;
        delete rule.fixedAmounts;
        delete rule.bps;
        delete rule.active;
        for (uint256 i; i < len; ++i) {
            rule.payees.push(payees[i]);
            rule.fixedAmounts.push(fixedAmounts[i]);
            rule.bps.push(bps[i]);
            rule.active.push(active[i]);
        }
        rule.version = version;
        rule.activeCount = activeCount;

        // Per-user budget: one compromised/abusive payer can exhaust only its own victim's limit,
        // not the global budget shared by every user. Re-arming a rule refills it.
        if (activeCount > 0 && userRemaining[user][token] == 0) {
            userRemaining[user][token] = USER_CALLBACK_LIMIT;
            emit UserBudgetReset(user, token, USER_CALLBACK_LIMIT);
        }

        if (activeCount > 0 && !rule.subscribed) {
            SYSTEM.subscribe(
                CHAIN_ID, token, TRANSFER_TOPIC_0, REACTIVE_IGNORE, uint256(uint160(user)), REACTIVE_IGNORE
            );
            rule.subscribed = true;
            // forge-lint: disable-next-line(reentrancy-events)
            emit Subscribed(user, token);
        } else if (activeCount == 0 && rule.subscribed) {
            SYSTEM.unsubscribe(
                CHAIN_ID, token, TRANSFER_TOPIC_0, REACTIVE_IGNORE, uint256(uint160(user)), REACTIVE_IGNORE
            );
            rule.subscribed = false;
            // forge-lint: disable-next-line(reentrancy-events)
            emit Unsubscribed(user, token);
        }

        // forge-lint: disable-next-line(reentrancy-events)
        emit RuleMirrored(user, token, version, activeCount, rule.subscribed);
    }

    // ---------------------------------------------------------------------
    // Paycheck handling
    // ---------------------------------------------------------------------

    function _onTransfer(LogRecord calldata log_) internal {
        if (log_.chainId != CHAIN_ID || log_.opCode != 3) return;

        // forge-lint: disable-next-line(unsafe-typecast)
        address from = address(uint160(log_.topic1));
        // forge-lint: disable-next-line(unsafe-typecast)
        address to = address(uint160(log_.topic2));
        address token = log_.contractAddress;

        Rule storage rule = _rules[to][token];
        if (rule.activeCount == 0 || !rule.subscribed) return;
        if (from == to) {
            emit Skipped(to, token, 0, SKIP_SELF);
            return;
        }

        // A transfer coming from one of the user's own bucket payees (e.g. a refund) should not
        // immediately be routed again.
        for (uint256 i; i < rule.payees.length; ++i) {
            if (rule.active[i] && from == rule.payees[i]) {
                emit Skipped(to, token, 0, SKIP_SELF);
                return;
            }
        }

        if (log_.data.length < 32) return;
        uint256 amount = abi.decode(log_.data, (uint256));
        if (amount == 0 || amount < minPaycheck) {
            emit Skipped(to, token, amount, SKIP_BELOW_MIN);
            return;
        }
        if (paused) return;
        if (remaining == 0) {
            emit Skipped(to, token, amount, SKIP_NO_BUDGET);
            return;
        }
        uint256 userBudget = userRemaining[to][token];
        if (userBudget == 0) {
            emit Skipped(to, token, amount, SKIP_USER_BUDGET);
            return;
        }

        bytes32 key = keccak256(abi.encode(log_.txHash, log_.logIndex));
        if (seen[key]) {
            emit Skipped(to, token, amount, SKIP_DUPLICATE);
            return;
        }
        seen[key] = true;
        userRemaining[to][token] = userBudget - 1;
        remaining -= 1;

        bytes memory payload = abi.encodeWithSignature(
            "executeSplit(address,address,address,uint256,uint256,uint256,uint256)",
            address(0),
            to,
            token,
            amount,
            rule.version,
            log_.txHash,
            log_.logIndex
        );

        emit Seen(to, token, amount, log_.txHash, log_.logIndex);
        emit CallbackRequested(to, token, amount, log_.txHash);
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: DEST_CHAIN_ID, recipient: CALLBACK_CONTRACT, gasLimit: CALLBACK_GAS_LIMIT, payload: payload
            })
        );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getRule(address user_, address token_)
        external
        view
        returns (
            address[] memory payees,
            uint96[] memory fixedAmounts,
            uint16[] memory bps,
            bool[] memory active,
            uint256 version,
            bool subscribed
        )
    {
        Rule storage rule = _rules[user_][token_];
        return (rule.payees, rule.fixedAmounts, rule.bps, rule.active, rule.version, rule.subscribed);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function topUp(uint256 limit_) external payable onlyOwner {
        remaining += limit_;
        emit ToppedUp(remaining, limit_);
        if (msg.value > 0) _coverDebt();
    }

    function setCallbackLimit(uint256 limit_) external onlyOwner {
        remaining = limit_;
        emit ToppedUp(limit_, 0);
    }

    function topUpUser(address user_, address token_, uint256 limit_) external onlyOwner {
        if (user_ == address(0) || token_ == address(0)) revert ZeroAddress();
        userRemaining[user_][token_] += limit_;
    }

    function setUserBudget(address user_, address token_, uint256 limit_) external onlyOwner {
        if (user_ == address(0) || token_ == address(0)) revert ZeroAddress();
        userRemaining[user_][token_] = limit_;
    }

    function setMinPaycheck(uint256 minPaycheck_) external onlyOwner {
        minPaycheck = minPaycheck_;
        emit MinPaycheckSet(minPaycheck_);
    }

    function coverDebt() external onlyOwner {
        _coverDebt();
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function rescueETH(address payable to_, uint256 amount_) external onlyOwner {
        if (to_ == address(0)) revert ZeroAddress();
        (bool ok,) = to_.call{ value: amount_ }("");
        require(ok, "ETH transfer failed");
    }
}
