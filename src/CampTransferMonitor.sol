// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { AbstractReactive } from "@reactive/src/base/AbstractReactive.sol";

/// @notice Omni transfer observer for the builder-camp first-deployment task.
/// @dev Independently implemented from the patterns in the Omni Xfers and CampReactive examples.
contract CampTransferMonitor is AbstractReactive {
    uint256 public constant SEPOLIA_CHAIN_ID = 11155111;
    uint256 public constant TRANSFER_TOPIC_0 = uint256(keccak256("Transfer(address,address,uint256)"));
    address public immutable OWNER;
    address public immutable TOKEN;
    uint256 public immutable THRESHOLD;
    uint256 public remaining;
    uint256 public count;
    uint256 public totalVolume;
    uint256 public lastOriginTxHash;
    uint256 public lastOriginLogIndex;
    uint256 public lastOriginBlock;
    uint256 public lastReactBlock;
    bool public subscribed;
    mapping(bytes32 => bool) public seen;

    error InvalidConfiguration();
    error NotOwner();

    event TransferObserved(
        address indexed token,
        uint256 indexed originTxHash,
        uint256 indexed originLogIndex,
        address from,
        address to,
        uint256 amount,
        uint256 originBlock,
        uint256 reactBlock
    );
    event SubscriptionStopped(uint256 count);

    /// @param token_ Token on Sepolia, not on Lasna. Its code cannot be checked locally across chains.
    /// @param threshold_ Only amounts strictly greater than this base-unit threshold count.
    /// @param limit_ Successful observations before automatic unsubscription (1–10).
    constructor(address token_, uint256 threshold_, uint256 limit_) payable {
        if (token_ == address(0) || limit_ == 0 || limit_ > 10) revert InvalidConfiguration();
        OWNER = msg.sender;
        TOKEN = token_;
        THRESHOLD = threshold_;
        remaining = limit_;
        SYSTEM.subscribe(SEPOLIA_CHAIN_ID, token_, TRANSFER_TOPIC_0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        subscribed = true;
    }

    /// @inheritdoc IReactive
    function react(LogRecord calldata log_) external onlySystem {
        if (
            remaining == 0 || log_.chainId != SEPOLIA_CHAIN_ID || log_.contractAddress != TOKEN
                || log_.topic0 != TRANSFER_TOPIC_0 || log_.opCode != 3 || log_.data.length != 32
        ) return;
        uint256 amount = abi.decode(log_.data, (uint256));
        if (amount <= THRESHOLD) return;
        bytes32 key = keccak256(abi.encode(log_.chainId, log_.contractAddress, log_.txHash, log_.logIndex));
        if (seen[key]) return;
        seen[key] = true;
        count += 1;
        totalVolume += amount;
        lastOriginTxHash = log_.txHash;
        lastOriginLogIndex = log_.logIndex;
        lastOriginBlock = log_.blockNumber;
        lastReactBlock = block.number;
        remaining -= 1;
        // Only the low 160 bits of indexed address topics are meaningful.
        emit TransferObserved(
            TOKEN,
            log_.txHash,
            log_.logIndex,
            address(uint160(log_.topic1)),
            address(uint160(log_.topic2)),
            amount,
            log_.blockNumber,
            block.number
        );
        if (remaining == 0) _stop();
    }

    function stop() external {
        if (msg.sender != OWNER) revert NotOwner();
        remaining = 0;
        _stop();
    }

    /// @notice Replenish inherited receive() first if needed, then settle network execution debt.
    function coverDebt() external payable {
        if (msg.sender != OWNER) revert NotOwner();
        _coverDebt();
    }

    function _stop() private {
        if (!subscribed) return;
        subscribed = false;
        SYSTEM.unsubscribe(SEPOLIA_CHAIN_ID, TOKEN, TRANSFER_TOPIC_0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        emit SubscriptionStopped(count);
    }
}
