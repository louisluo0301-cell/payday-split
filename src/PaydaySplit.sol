// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { AbstractPayer } from "@reactive/src/base/AbstractPayer.sol";

/// @title PaydaySplit — Reactive Income Waterfall
/// @notice Routes every incoming stablecoin payment through an ordered list of buckets. Each bucket
///         can carry a fixed amount, a percentage of gross income, or both; array order is priority,
///         and the default presets put fixed bills (rent, invoices) first. Whatever is left stays in
///         the user's wallet for spending.
/// @dev    Non-custodial: the contract never holds principal. It pulls only amounts the user has
///         approved, one bucket at a time, and a failed bucket does not block the rest of the waterfall.
contract PaydaySplit is AbstractPayer, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Maximum number of buckets per (user, token). Keeps the callback gas bounded.
    uint256 public constant MAX_BUCKETS = 8;
    /// @notice Basis-point denominator.
    uint16 public constant MAX_BPS = 10_000;

    // Reasons emitted with BucketSkipped, so the UI can explain what happened.
    uint8 public constant SKIP_NO_FUNDS = 1;
    uint8 public constant SKIP_INSUFFICIENT_BALANCE = 2;
    uint8 public constant SKIP_TRANSFER_FAILED = 3;
    uint8 public constant SKIP_INACTIVE = 4;
    uint8 public constant SKIP_GOAL_REACHED = 5;

    /// @notice One destination in the waterfall. Array order is priority.
    /// @param payee       Destination address.
    /// @param fixedAmount Fixed amount in token units, added to the percentage for this bucket.
    /// @param bps         Percentage of the gross paycheck, in basis points.
    /// @param active      Whether the bucket participates.
    struct Bucket {
        address payee;
        uint96 fixedAmount;
        uint16 bps;
        bool active;
    }

    /// @notice Emitted whenever a user replaces the waterfall for one token.
    /// @dev    `version` is also topic3, so the Reactive contract can mirror it without decoding data.
    event BucketsSet(
        address indexed user,
        address indexed token,
        uint256 indexed version,
        address[] payees,
        uint96[] fixedAmounts,
        uint16[] bps,
        bool[] active
    );

    /// @notice Emitted when a save is a no-op, so an accidental re-save does not bump the version.
    event RuleUnchanged(address indexed user, address indexed token, uint256 indexed version);

    /// @notice Emitted for every bucket that paid.
    event Split(
        address indexed user,
        address indexed token,
        address indexed payee,
        uint256 paycheck,
        uint256 amount,
        uint256 bucketIndex,
        uint256 version,
        uint256 originTxHash,
        uint256 logIndex
    );

    /// @notice Emitted when a bucket was skipped, without reverting the whole waterfall.
    event BucketSkipped(
        address indexed user,
        address indexed token,
        uint256 bucketIndex,
        uint256 paycheck,
        uint256 requested,
        uint8 reason,
        uint256 version,
        uint256 originTxHash,
        uint256 logIndex
    );

    /// @notice Emitted when part of the paycheck stays in the user's wallet.
    event Retained(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 version,
        uint256 originTxHash,
        uint256 logIndex
    );

    /// @notice A callback arrived for an older version of the rule.
    event StaleRule(
        address indexed user,
        address indexed token,
        uint256 gotVersion,
        uint256 currentVersion,
        uint256 originTxHash,
        uint256 logIndex
    );

    /// @notice Emitted once, when the Reactive contract is bound.
    event ReactiveSet(address indexed reactive);

    error ZeroAddress();
    error InvalidPayee();
    error TooManyBuckets();
    error EmptyBucket();
    error BpsTooHigh();
    error TotalBpsTooHigh();
    error ReactiveAlreadySet();
    error InvalidToken();
    error CallbackNotAuthorized(address got, address expected);

    /// @notice The Reactive contract allowed to call executeSplit. Set once by the owner.
    address public reactive;

    /// @notice user => token => ordered buckets.
    mapping(address => mapping(address => Bucket[])) private _buckets;
    mapping(address => mapping(address => bytes32)) public ruleHash;
    /// @notice user => token => current rule version. Incremented on every setBuckets.
    mapping(address => mapping(address => uint256)) public ruleVersion;
    /// @notice keccak256(user, token, originTxHash, logIndex) => already handled.
    mapping(bytes32 => bool) public processed;

    /// @notice Optional user-owned controls. Zero limits mean unlimited; paused always blocks.
    struct Policy {
        uint96 reserve;
        uint96 maxPerRun;
        uint96 dailyLimit;
        uint96 minIncome;
        uint64 validUntil;
        bool paused;
    }

    struct DailySpend {
        uint256 day;
        uint256 amount;
    }
    mapping(address => mapping(address => Policy)) public policies;
    mapping(address => mapping(address => DailySpend)) public dailySpend;
    event PolicySet(address indexed user, address indexed token, Policy policy);
    event PolicyBlocked(address indexed user, address indexed token, uint8 reason);
    error OnlySelf();
    error InvalidBucket();
    error GoalVersionMismatch();

    /// @notice A user-started funding cycle, scoped to a rule version and bucket index.
    ///         A zero target disables the cap without erasing previously recorded progress.
    struct BucketGoal {
        uint96 target;
        uint96 paid;
        uint64 cycle;
    }
    mapping(address => mapping(address => mapping(uint256 => mapping(uint256 => BucketGoal)))) public bucketGoals;
    event GoalSet(
        address indexed user,
        address indexed token,
        uint256 indexed version,
        uint256 bucketIndex,
        uint96 target,
        uint96 paid,
        uint64 cycle
    );
    event GoalFunded(
        address indexed user,
        address indexed token,
        uint256 indexed version,
        uint256 bucketIndex,
        uint96 paid,
        uint96 target,
        uint64 cycle
    );

    /// @notice Set or extend a target. Only an explicit new cycle resets paid progress.
    /// @dev Rule changes create a new version with fresh goals. Identical saves keep progress.
    function setBucketGoal(address token_, uint256 index_, uint256 expectedVersion_, uint96 target_, bool newCycle_)
        external
        nonReentrant
    {
        if (index_ >= _buckets[msg.sender][token_].length) revert InvalidBucket();
        uint256 version = ruleVersion[msg.sender][token_];
        if (version != expectedVersion_) revert GoalVersionMismatch();
        BucketGoal storage goal = bucketGoals[msg.sender][token_][version][index_];
        if (newCycle_ || goal.cycle == 0) {
            goal.paid = 0;
            goal.cycle += 1;
        }
        goal.target = target_;
        emit GoalSet(msg.sender, token_, version, index_, target_, goal.paid, goal.cycle);
    }

    /// @notice Controls apply immediately on the destination, including queued callbacks.
    function setPolicy(address token_, Policy calldata policy_) external nonReentrant {
        if (token_.code.length == 0) revert InvalidToken();
        policies[msg.sender][token_] = policy_;
        emit PolicySet(msg.sender, token_, policy_);
    }

    modifier onlyReactive(address reactive_) {
        if (reactive == address(0) || reactive_ != reactive) revert CallbackNotAuthorized(reactive_, reactive);
        _;
    }

    /// @param proxy_  The destination chain's Callback Proxy.
    /// @param owner_  Owner (pause, bind Reactive, rescue accidentally sent tokens).
    constructor(IPayable proxy_, address owner_) AbstractPayer(proxy_) Ownable(owner_) { }

    // ---------------------------------------------------------------------
    // Rule management
    // ---------------------------------------------------------------------

    /// @notice Replace the full waterfall for one token. Array order is priority.
    /// @param token_   ERC-20 that funds the waterfall.
    /// @param buckets_ Ordered buckets. Empty array disables the rule.
    function setBuckets(address token_, Bucket[] calldata buckets_) external nonReentrant {
        if (token_ == address(0)) revert ZeroAddress();
        if (token_.code.length == 0) revert InvalidToken();
        if (buckets_.length > MAX_BUCKETS) revert TooManyBuckets();

        Bucket[] memory copy = new Bucket[](buckets_.length);
        for (uint256 i; i < buckets_.length; ++i) {
            copy[i] = buckets_[i];
        }
        _storeBuckets(token_, copy);
    }

    /// @notice Disable the rule without re-typing the buckets.
    function disableAll(address token_) external nonReentrant {
        if (token_ == address(0)) revert ZeroAddress();
        _storeBuckets(token_, new Bucket[](0));
    }

    /// @notice Read the full waterfall for a user and token.
    function getBuckets(address user_, address token_) external view returns (Bucket[] memory) {
        return _buckets[user_][token_];
    }

    function bucketCount(address user_, address token_) external view returns (uint256) {
        return _buckets[user_][token_].length;
    }

    /// @notice Simulate the waterfall for a paycheck, ignoring allowance/balance checks.
    /// @dev    Amounts are aligned with the stored bucket array; inactive or unfunded buckets are 0.
    ///         This is the exact same fixed/percentage/cap math used by executeSplit.
    /// @return payees    Payee per bucket (also for inactive buckets).
    /// @return amounts   Amount that would be paid per bucket.
    /// @return retained  Amount that would stay in the user's wallet.
    function previewWaterfall(address user_, address token_, uint256 paycheck_)
        external
        view
        returns (address[] memory payees, uint256[] memory amounts, uint256 retained)
    {
        Bucket[] storage list = _buckets[user_][token_];
        uint256 len = list.length;
        payees = new address[](len);
        amounts = new uint256[](len);
        uint256 remaining = paycheck_;

        for (uint256 i; i < len; ++i) {
            Bucket memory bucket = list[i];
            payees[i] = bucket.payee;
            if (!bucket.active) continue;

            uint256 requested = uint256(bucket.fixedAmount);
            if (bucket.bps > 0) {
                requested += Math.mulDiv(paycheck_, bucket.bps, MAX_BPS);
            }
            if (requested == 0 || remaining == 0) continue;

            uint256 amount = requested < remaining ? requested : remaining;
            amounts[i] = amount;
            remaining -= amount;
        }

        retained = remaining;
    }

    /// @notice Best-effort execution preview for standard ERC-20s using current onchain state.
    /// @dev Assumes transfers succeed; cannot predict token blacklists, fees, or state changes.
    ///      Unlike previewWaterfall, includes goals, policy, global pause, balance and allowance.
    function previewExecution(address user_, address token_, uint256 paycheck_)
        external
        view
        returns (uint256[] memory amounts, uint256 retained, uint8 blocked)
    {
        Bucket[] storage list = _buckets[user_][token_];
        amounts = new uint256[](list.length);
        retained = paycheck_;
        if (paused()) return (amounts, retained, 4);
        (uint256 balance, uint256 allowance, uint256 budget, uint8 reason) = _executionBudget(user_, token_, paycheck_);
        blocked = reason;
        if (blocked != 0) return (amounts, retained, blocked);
        uint256 version = ruleVersion[user_][token_];
        for (uint256 i; i < list.length; ++i) {
            Bucket memory bucket = list[i];
            if (!bucket.active) continue;
            uint256 requested = uint256(bucket.fixedAmount) + Math.mulDiv(paycheck_, bucket.bps, MAX_BPS);
            uint256 amount = Math.min(Math.min(requested, retained), budget);
            BucketGoal storage goal = bucketGoals[user_][token_][version][i];
            if (goal.target > 0) amount = Math.min(amount, goal.paid >= goal.target ? 0 : goal.target - goal.paid);
            if (amount == 0 || amount > balance || amount > allowance) continue;
            amounts[i] = amount;
            retained -= amount;
            budget -= amount;
            balance -= amount;
            allowance -= amount;
        }
    }

    function _executionBudget(address user_, address token_, uint256 paycheck_)
        internal
        view
        returns (uint256 balance, uint256 allowance, uint256 budget, uint8 blocked)
    {
        balance = _readUint(token_, abi.encodeCall(IERC20.balanceOf, (user_)));
        allowance = _readUint(token_, abi.encodeCall(IERC20.allowance, (user_, address(this))));
        Policy memory policy = policies[user_][token_];
        blocked = policy.paused
            ? 1
            : (policy.validUntil != 0 && block.timestamp >= policy.validUntil)
                ? 2
                : paycheck_ < policy.minIncome ? 3 : 0;
        if (blocked != 0) return (balance, allowance, 0, blocked);
        budget = paycheck_;
        if (policy.maxPerRun != 0) budget = Math.min(budget, policy.maxPerRun);
        DailySpend storage spent = dailySpend[user_][token_];
        uint256 today = spent.day == block.timestamp / 1 days ? spent.amount : 0;
        if (policy.dailyLimit != 0) {
            budget = Math.min(budget, today >= policy.dailyLimit ? 0 : policy.dailyLimit - today);
        }
        if (policy.reserve != 0) {
            uint256 spendable = balance == type(uint256).max || balance <= policy.reserve ? 0 : balance - policy.reserve;
            budget = Math.min(budget, spendable);
        }
    }

    function _storeBuckets(address token_, Bucket[] memory buckets_) internal {
        uint256 len = buckets_.length;
        uint256 totalBps = 0;

        address[] memory payees = new address[](len);
        uint96[] memory fixedAmounts = new uint96[](len);
        uint16[] memory bpsArr = new uint16[](len);
        bool[] memory activeArr = new bool[](len);

        for (uint256 i; i < len; ++i) {
            Bucket memory bucket = buckets_[i];
            if (bucket.bps > MAX_BPS) revert BpsTooHigh();

            if (bucket.active) {
                if (bucket.payee == address(0) || bucket.payee == msg.sender || bucket.payee == address(this)) {
                    revert InvalidPayee();
                }
                if (bucket.fixedAmount == 0 && bucket.bps == 0) revert EmptyBucket();
                totalBps += bucket.bps;
            }

            payees[i] = bucket.payee;
            fixedAmounts[i] = bucket.fixedAmount;
            bpsArr[i] = bucket.bps;
            activeArr[i] = bucket.active;
        }

        if (totalBps > MAX_BPS) revert TotalBpsTooHigh();

        bytes32 hash = keccak256(abi.encode(payees, fixedAmounts, bpsArr, activeArr));
        if (ruleHash[msg.sender][token_] == hash) {
            emit RuleUnchanged(msg.sender, token_, ruleVersion[msg.sender][token_]);
            return;
        }

        Bucket[] storage list = _buckets[msg.sender][token_];
        for (uint256 i = list.length; i > 0; --i) {
            list.pop();
        }
        for (uint256 i; i < len; ++i) {
            list.push(buckets_[i]);
        }

        uint256 version = ++ruleVersion[msg.sender][token_];
        ruleHash[msg.sender][token_] = hash;
        emit BucketsSet(msg.sender, token_, version, payees, fixedAmounts, bpsArr, activeArr);
    }

    // ---------------------------------------------------------------------
    // Reactive callback
    // ---------------------------------------------------------------------

    /// @notice Called by the Callback Proxy on behalf of the Reactive contract.
    /// @dev    Two independent checks: msg.sender must be the proxy, and the address injected into
    ///         the payload must be our Reactive contract. Expected no-op cases return instead of reverting.
    /// @param reactive_     Injected by the proxy, not supplied by the caller.
    /// @param user_         Paycheck recipient.
    /// @param token_        ERC-20 that was transferred.
    /// @param paycheck_     Amount of the incoming transfer, in token units.
    /// @param version_      Rule version mirrored by the Reactive contract.
    /// @param originTxHash_ Hash of the origin transaction that emitted Transfer.
    /// @param logIndex_     Log index inside that transaction.
    function executeSplit(
        address reactive_,
        address user_,
        address token_,
        uint256 paycheck_,
        uint256 version_,
        uint256 originTxHash_,
        uint256 logIndex_
    ) external nonReentrant onlyServiceProvider whenNotPaused onlyReactive(reactive_) {
        if (paycheck_ == 0) return;
        if (version_ == 0) return;

        if (version_ != ruleVersion[user_][token_]) {
            emit StaleRule(user_, token_, version_, ruleVersion[user_][token_], originTxHash_, logIndex_);
            return;
        }

        bytes32 key = keccak256(abi.encode(user_, token_, originTxHash_, logIndex_));
        if (processed[key]) return;
        processed[key] = true;

        _runWaterfall(user_, token_, paycheck_, version_, originTxHash_, logIndex_);
    }

    /// @notice Manually run the current waterfall, e.g. after a stale/dropped callback.
    /// @dev    Pulls only from msg.sender, to that user's own bucket payees. It is a recovery path,
    ///         not a second automation path: no origin tx is recorded and no callback budget is used.
    function runSplit(address token_, uint256 paycheck_) external nonReentrant whenNotPaused {
        if (paycheck_ == 0) return;
        uint256 version = ruleVersion[msg.sender][token_];
        if (version == 0) return;
        _runWaterfall(msg.sender, token_, paycheck_, version, 0, 0);
    }

    /// @notice Recover one missed income and consume its origin key so a delayed callback cannot pay twice.
    /// @dev The caller chooses the amount and can spend only their own approved funds. This is not
    ///      proof of an origin event. Use runSplit only for an intentionally separate manual payment.
    function recoverSplit(address token_, uint256 paycheck_, uint256 originTxHash_, uint256 logIndex_)
        external
        nonReentrant
        whenNotPaused
    {
        require(originTxHash_ != 0, "origin hash required");
        uint256 version = ruleVersion[msg.sender][token_];
        if (paycheck_ == 0 || version == 0) return;
        bytes32 key = keccak256(abi.encode(msg.sender, token_, originTxHash_, logIndex_));
        if (processed[key]) return;
        processed[key] = true;
        _runWaterfall(msg.sender, token_, paycheck_, version, originTxHash_, logIndex_);
    }

    function _runWaterfall(
        address user_,
        address token_,
        uint256 paycheck_,
        uint256 version_,
        uint256 originTxHash_,
        uint256 logIndex_
    ) internal {
        IERC20 token = IERC20(token_);
        Bucket[] storage list = _buckets[user_][token_];
        uint256 remaining = paycheck_;
        (uint256 balance, uint256 allowance, uint256 budget, uint8 blocked) = _executionBudget(user_, token_, paycheck_);
        if (blocked != 0) {
            emit PolicyBlocked(user_, token_, blocked);
            emit Retained(user_, token_, paycheck_, version_, originTxHash_, logIndex_);
            return;
        }
        DailySpend storage spent = dailySpend[user_][token_];
        uint256 day = block.timestamp / 1 days;
        if (spent.day != day) {
            spent.day = day;
            spent.amount = 0;
        }

        for (uint256 i; i < list.length; ++i) {
            Bucket memory bucket = list[i];
            if (!bucket.active) {
                emit BucketSkipped(user_, token_, i, paycheck_, 0, SKIP_INACTIVE, version_, originTxHash_, logIndex_);
                continue;
            }

            uint256 requested = uint256(bucket.fixedAmount);
            if (bucket.bps > 0) {
                requested += Math.mulDiv(paycheck_, bucket.bps, MAX_BPS);
            }
            if (requested == 0) continue;

            if (remaining == 0) {
                emit BucketSkipped(
                    user_, token_, i, paycheck_, requested, SKIP_NO_FUNDS, version_, originTxHash_, logIndex_
                );
                continue;
            }

            uint256 amount = requested < remaining ? requested : remaining;
            amount = Math.min(amount, budget);
            BucketGoal storage goal = bucketGoals[user_][token_][version_][i];
            if (goal.target > 0) {
                uint256 goalRemaining = goal.paid >= goal.target ? 0 : goal.target - goal.paid;
                if (goalRemaining == 0) {
                    emit BucketSkipped(
                        user_, token_, i, paycheck_, requested, SKIP_GOAL_REACHED, version_, originTxHash_, logIndex_
                    );
                    continue;
                }
                amount = Math.min(amount, goalRemaining);
            }
            if (amount == 0) {
                emit BucketSkipped(
                    user_, token_, i, paycheck_, requested, SKIP_NO_FUNDS, version_, originTxHash_, logIndex_
                );
                continue;
            }

            if (balance < amount || allowance < amount) {
                emit BucketSkipped(
                    user_,
                    token_,
                    i,
                    paycheck_,
                    requested,
                    SKIP_INSUFFICIENT_BALANCE,
                    version_,
                    originTxHash_,
                    logIndex_
                );
                continue;
            }

            if (!_tryTransferFrom(token, user_, bucket.payee, amount)) {
                emit BucketSkipped(
                    user_, token_, i, paycheck_, requested, SKIP_TRANSFER_FAILED, version_, originTxHash_, logIndex_
                );
                continue;
            }

            balance -= amount;
            allowance -= amount;
            remaining -= amount;
            budget -= amount;
            spent.amount += amount;
            if (goal.target > 0) {
                goal.paid += uint96(amount); // amount <= target - paid, both uint96
                emit GoalFunded(user_, token_, version_, i, goal.paid, goal.target, goal.cycle);
            }
            emit Split(user_, token_, bucket.payee, paycheck_, amount, i, version_, originTxHash_, logIndex_);
        }

        if (remaining > 0) {
            emit Retained(user_, token_, remaining, version_, originTxHash_, logIndex_);
        }
    }

    /// @dev Non-reverting uint read. On malformed/reverting token metadata, return max so the
    ///      actual transfer attempt decides the bucket outcome instead of reverting the callback.
    function _readUint(address target_, bytes memory data_) internal view returns (uint256) {
        (bool ok, bytes memory ret) = target_.staticcall(data_);
        if (!ok || ret.length < 32) return type(uint256).max;
        return abi.decode(ret, (uint256));
    }

    /// @dev ERC-20 transferFrom that tolerates non-standard tokens and returns false instead of reverting.
    function _tryTransferFrom(IERC20 token_, address from_, address to_, uint256 amount_) internal returns (bool) {
        // Revert the token's state changes too if it moves funds then returns false/malformed.
        try this.transferBucket(token_, from_, to_, amount_) {
            return true;
        } catch {
            return false;
        }
    }

    function transferBucket(IERC20 token_, address from_, address to_, uint256 amount_) external {
        if (msg.sender != address(this)) revert OnlySelf();
        token_.safeTransferFrom(from_, to_, amount_);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Bind the Reactive contract once. Cannot be changed: a wrong address means redeploy.
    function setReactive(address reactive_) external onlyOwner {
        if (reactive != address(0)) revert ReactiveAlreadySet();
        if (reactive_ == address(0)) revert ZeroAddress();
        reactive = reactive_;
        emit ReactiveSet(reactive_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Settle callback proxy debt from this contract's fee balance after replenishing it.
    function coverDebt() external onlyOwner {
        _coverDebt();
    }

    /// @notice Recover tokens accidentally sent to this contract. User principal is never held here.
    function rescueERC20(address token_, address to_, uint256 amount_) external onlyOwner {
        if (to_ == address(0)) revert ZeroAddress();
        IERC20(token_).safeTransfer(to_, amount_);
    }

    /// @notice Withdraw ETH that is not needed for callback fees. Keep a buffer in production.
    function rescueETH(address payable to_, uint256 amount_) external onlyOwner {
        if (to_ == address(0)) revert ZeroAddress();
        (bool ok,) = to_.call{ value: amount_ }("");
        require(ok, "ETH transfer failed");
    }
}
