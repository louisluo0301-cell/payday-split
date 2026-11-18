// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @dev Bounded FIFO. Pending jobs rotate to its tail with a new due time.
contract PaydayRetryQueue {
    uint256 public constant RETRY_DELAY = 15 minutes;
    uint256 public constant RETRY_ATTEMPTS = 3;
    uint256 public constant RETRY_CAPACITY = 256;
    uint256 public constant RETRY_USER_CAPACITY = 12;
    uint256 internal constant RETRIES_PER_CALLBACK = 3;

    struct RetryOrigin {
        address user;
        address token;
        uint256 version;
        uint256 txHash;
        uint256 logIndex;
        uint256 gross;
    }

    struct RetryJob {
        RetryOrigin origin;
        uint256 epoch;
        uint64 period;
        uint64 due;
        uint96 amount;
        uint8 bucketIndex;
        uint8 attempts;
    }

    enum RetryResult {
        Wait,
        Paid,
        Invalid
    }

    address public immutable split;
    mapping(address => mapping(address => uint256)) public retryPending;
    mapping(uint256 => RetryJob) private _retryJobs;
    mapping(uint256 => uint256) private _retrySlots;
    uint256 private _retryHead;
    uint256 private _retryTail;
    uint256 public nextRetryId;

    event RetryQueued(
        address indexed user,
        address indexed token,
        uint256 indexed id,
        uint256 originTxHash,
        uint256 logIndex,
        uint256 bucketIndex,
        uint256 amount,
        uint256 due
    );
    event RetryAttempt(uint256 indexed id, uint256 attempts, uint256 nextDue);
    /// Result: 1 paid, 2 invalidated, 3 attempts exhausted, 4 cancelled.
    event RetryClosed(address indexed user, address indexed token, uint256 indexed id, uint8 result, uint256 amount);
    error RetryOwnerRequired();
    error SplitRequired();

    constructor() {
        split = msg.sender;
    }

    modifier onlySplit() {
        if (msg.sender != split) revert SplitRequired();
        _;
    }

    function retryJob(uint256 id) external view returns (RetryJob memory) {
        return _retryJobs[id];
    }

    function retryQueueLength() external view returns (uint256) {
        return _retryTail - _retryHead;
    }

    function enqueue(RetryOrigin calldata origin, uint256 epoch, uint64 period, uint8 index, uint256 amount)
        external
        onlySplit
        returns (bool)
    {
        if (
            _retryTail - _retryHead >= RETRY_CAPACITY || retryPending[origin.user][origin.token] >= RETRY_USER_CAPACITY
                || amount == 0 || amount > type(uint96).max
                || (block.timestamp + RETRY_DELAY) / 1 days != block.timestamp / 1 days
        ) {
            return false;
        }
        uint256 id = ++nextRetryId;
        uint64 due = uint64(block.timestamp + RETRY_DELAY);
        _retryJobs[id] = RetryJob(origin, epoch, period, due, uint96(amount), index, 0);
        _retrySlots[_retryTail++] = id;
        ++retryPending[origin.user][origin.token];
        emit RetryQueued(origin.user, origin.token, id, origin.txHash, origin.logIndex, index, amount, due);
        return true;
    }

    function cancel(uint256 id, address account) external onlySplit {
        RetryJob memory job = _retryJobs[id];
        if (job.origin.user != account) revert RetryOwnerRequired();
        _close(id, job, 4);
    }

    function _close(uint256 id, RetryJob memory job, uint8 result) private {
        delete _retryJobs[id];
        --retryPending[job.origin.user][job.origin.token];
        emit RetryClosed(job.origin.user, job.origin.token, id, result, job.amount);
    }

    function process() external onlySplit {
        for (uint256 i; i < RETRIES_PER_CALLBACK && _retryHead < _retryTail; ++i) {
            uint256 id = _retrySlots[_retryHead];
            RetryJob memory job = _retryJobs[id];
            if (job.amount != 0 && job.due > block.timestamp) break;
            delete _retrySlots[_retryHead++];
            if (job.amount == 0) continue;
            RetryResult result = IRetryExecutor(split).performRetry(job);
            if (result == RetryResult.Paid) {
                _close(id, job, 1);
            } else if (result == RetryResult.Invalid) {
                _close(id, job, 2);
            } else if (
                ++job.attempts == RETRY_ATTEMPTS || (block.timestamp + RETRY_DELAY) / 1 days != block.timestamp / 1 days
            ) {
                _close(id, job, 3);
            } else {
                job.due = uint64(block.timestamp + RETRY_DELAY);
                _retryJobs[id] = job;
                _retrySlots[_retryTail++] = id;
                emit RetryAttempt(id, job.attempts, job.due);
            }
        }
    }
}

interface IRetryExecutor {
    function performRetry(PaydayRetryQueue.RetryJob calldata job) external returns (PaydayRetryQueue.RetryResult);
}
