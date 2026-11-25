// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test, Vm } from "forge-std/Test.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";
import { PaydaySplit } from "../src/PaydaySplit.sol";
import { PaydaySplitReactive } from "../src/PaydaySplitReactive.sol";
import { DemoUSDC } from "../src/DemoUSDC.sol";

/// @dev Local stand-in for the Reactive system contract at 0x8888…8888.
contract MockSystem {
    struct Sub {
        uint256 chainId;
        address contract_;
        uint256 topic0;
        uint256 topic1;
        uint256 topic2;
        uint256 topic3;
    }

    Sub[] public subs;
    uint256 public unsubscribeCount;
    ISystemContract.CallbackConfiguration_V_1_0[] public requests;

    function subscribe(
        uint256 chainId_,
        address contract_,
        uint256 topic0_,
        uint256 topic1_,
        uint256 topic2_,
        uint256 topic3_
    ) external {
        subs.push(Sub(chainId_, contract_, topic0_, topic1_, topic2_, topic3_));
    }

    function unsubscribe(uint256, address, uint256, uint256, uint256, uint256) external {
        unsubscribeCount++;
    }

    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory cfg) external {
        requests.push(cfg);
    }

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    function reserves(address) external pure returns (uint256) {
        return 0;
    }

    function subCount() external view returns (uint256) {
        return subs.length;
    }

    function requestCount() external view returns (uint256) {
        return requests.length;
    }

    function lastRequest() external view returns (ISystemContract.CallbackConfiguration_V_1_0 memory) {
        return requests[requests.length - 1];
    }

    function getRequest(uint256 i) external view returns (ISystemContract.CallbackConfiguration_V_1_0 memory) {
        return requests[i];
    }

    function lastSub() external view returns (Sub memory) {
        return subs[subs.length - 1];
    }

    function getSub(uint256 i) external view returns (Sub memory) {
        return subs[i];
    }

    receive() external payable { }
}

/// @dev Mimics the Callback Proxy: injects the Reactive address into the first payload argument.
contract MockProxy {
    function debt(address) external pure returns (uint256) {
        return 0;
    }

    function reserves(address) external pure returns (uint256) {
        return 0;
    }

    function deliver(address recipient, address reactive, bytes memory payload)
        external
        returns (bool ok, bytes memory ret)
    {
        assembly {
            mstore(add(payload, 36), reactive)
        }
        (ok, ret) = recipient.call(payload);
    }

    receive() external payable { }
}

/// @dev ERC-20 that returns false instead of reverting.
contract FalseReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setBalance(address who, uint256 amount) external {
        balanceOf[who] = amount;
    }

    function setAllowance(address owner, address spender, uint256 amount) external {
        allowance[owner][spender] = amount;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

/// @dev USDT-style token: transferFrom has no return value.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setBalance(address who, uint256 amount) external {
        balanceOf[who] = amount;
    }

    function setAllowance(address owner, address spender, uint256 amount) external {
        allowance[owner][spender] = amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// @dev Returns 64 bytes whose first word is not a valid bool.
contract MalformedReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setBalance(address who, uint256 amount) external {
        balanceOf[who] = amount;
    }

    function setAllowance(address owner, address spender, uint256 amount) external {
        allowance[owner][spender] = amount;
    }

    function transferFrom(address, address, uint256) external pure returns (uint256, uint256) {
        return (2, 0);
    }
}

/// @dev transferFrom reverts; the waterfall must skip only this bucket.
contract RevertingToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setBalance(address who, uint256 amount) external {
        balanceOf[who] = amount;
    }

    function setAllowance(address owner, address spender, uint256 amount) external {
        allowance[owner][spender] = amount;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert("transfer disabled");
    }
}

/// @dev balanceOf reverts; the callback must still attempt and complete the transfer.
contract RevertingBalanceToken {
    mapping(address => uint256) internal _balances;
    mapping(address => mapping(address => uint256)) public allowance;

    function setBalance(address who, uint256 amount) external {
        _balances[who] = amount;
    }

    function setAllowance(address owner, address spender, uint256 amount) external {
        allowance[owner][spender] = amount;
    }

    function balanceOf(address) external pure returns (uint256) {
        revert("balance unavailable");
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        _balances[from] -= amount;
        _balances[to] += amount;
        return true;
    }

    function actualBalance(address who) external view returns (uint256) {
        return _balances[who];
    }
}

/// @dev Attempts to re-enter the waterfall from transferFrom; nonReentrant must block it.
contract ReentrantToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public target;
    bytes public payload;
    bool public reentryBlocked;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function setBalance(address who, uint256 amount) external {
        balanceOf[who] = amount;
    }

    function setAllowance(address owner, address spender, uint256 amount) external {
        allowance[owner][spender] = amount;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        (bool ok, bytes memory ret) = target.call(payload);
        bool delivered;
        if (ok && ret.length >= 64) {
            (delivered,) = abi.decode(ret, (bool, bytes));
        }
        reentryBlocked = !ok || !delivered;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MovesThenFailsToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function setBalance(address who, uint256 amount) external {
        balanceOf[who] = amount;
    }

    function setAllowance(address who, address spender, uint256 amount) external {
        allowance[who][spender] = amount;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return false;
    }
}

contract GasGriefToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public blocked;

    function setup(address user, address spender, address blocked_) external {
        balanceOf[user] = 1000e6;
        allowance[user][spender] = 1000e6;
        blocked = blocked_;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (to == blocked) {
            assembly { for { } 1 { } { } }
        }
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract PaydaySplitTest is Test {
    uint256 constant CHAIN = 11155111;
    uint256 constant PAYCHECK = 1_000e6;
    uint256 constant RENT = 300e6;
    uint256 constant LIMIT = 10;
    uint256 constant IGNORE = 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;

    MockSystem system;
    MockProxy proxy;
    DemoUSDC token;
    PaydaySplit split;
    PaydaySplitReactive reactive;

    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address employer = makeAddr("employer");
    address aliceRent = makeAddr("aliceRent");
    address aliceTax = makeAddr("aliceTax");
    address aliceSavings = makeAddr("aliceSavings");
    address bobSavings = makeAddr("bobSavings");

    function setUp() public {
        MockSystem impl = new MockSystem();
        vm.etch(0x8888888888888888888888888888888888888888, address(impl).code);
        system = MockSystem(payable(0x8888888888888888888888888888888888888888));

        proxy = new MockProxy();
        token = new DemoUSDC(owner);
        split = new PaydaySplit(IPayable(payable(address(proxy))), owner);
        vm.deal(owner, 100 ether);
        reactive = new PaydaySplitReactive{ value: 1 ether }(CHAIN, address(split), CHAIN, address(split), LIMIT);
        split.setReactive(address(reactive));

        token.mint(alice, 10_000e6);
        token.mint(bob, 10_000e6);
        token.mint(employer, 1_000_000e6);

        vm.prank(alice);
        token.approve(address(split), type(uint256).max);
        vm.prank(bob);
        token.approve(address(split), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function bucket(address payee, uint96 fixedAmount, uint16 bps, bool active)
        internal
        pure
        returns (PaydaySplit.Bucket memory)
    {
        return PaydaySplit.Bucket({ payee: payee, fixedAmount: fixedAmount, bps: bps, active: active });
    }

    function aliceBuckets() internal view returns (PaydaySplit.Bucket[] memory buckets) {
        buckets = new PaydaySplit.Bucket[](3);
        buckets[0] = bucket(aliceRent, uint96(RENT), 0, true);
        buckets[1] = bucket(aliceTax, 0, 2_500, true);
        buckets[2] = bucket(aliceSavings, 0, 1_500, true);
    }

    function _setBuckets(address user, PaydaySplit.Bucket[] memory buckets, uint256 txHash)
        internal
        returns (IReactive.LogRecord memory rec)
    {
        vm.recordLogs();
        vm.prank(user);
        split.setBuckets(address(token), buckets);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (uint256(logs[i].topics[0]) == reactive.BUCKETS_SET_TOPIC_0()) {
                return _toRecord(logs[i], address(split), txHash, i);
            }
        }
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], keccak256("RuleUnchanged(address,address,uint256)"));
        return _toRecord(logs[0], address(split), txHash, 0);
    }

    function _setAliceBuckets() internal returns (IReactive.LogRecord memory) {
        return _setBuckets(alice, aliceBuckets(), uint256(keccak256("alice-rule")));
    }

    function _transferLog(address from, address to, uint256 amount, uint256 txHash, uint256 logIndex)
        internal
        returns (IReactive.LogRecord memory rec)
    {
        vm.recordLogs();
        vm.prank(from);
        token.transfer(to, amount);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        return _toRecord(logs[0], address(token), txHash, logIndex);
    }

    function _toRecord(Vm.Log memory log_, address emitter, uint256 txHash, uint256 logIndex)
        internal
        view
        returns (IReactive.LogRecord memory rec)
    {
        rec.chainId = CHAIN;
        rec.contractAddress = emitter;
        rec.topic0 = uint256(log_.topics[0]);
        if (log_.topics.length > 1) rec.topic1 = uint256(log_.topics[1]);
        if (log_.topics.length > 2) rec.topic2 = uint256(log_.topics[2]);
        if (log_.topics.length > 3) rec.topic3 = uint256(log_.topics[3]);
        rec.data = log_.data;
        rec.opCode = log_.topics.length;
        rec.blockNumber = block.number;
        rec.txHash = txHash;
        rec.logIndex = logIndex;
    }

    function _react(IReactive.LogRecord memory rec) internal {
        vm.prank(address(system));
        reactive.react(rec);
    }

    function _armAlice() internal {
        _react(_setAliceBuckets());
    }

    function _deliverLast() internal returns (bool ok) {
        ISystemContract.CallbackConfiguration_V_1_0 memory req = system.lastRequest();
        bytes memory ret;
        (ok, ret) = proxy.deliver(address(split), address(reactive), req.payload);
        ret;
    }

    // ------------------------------------------------------------------
    // Configuration + subscriptions
    // ------------------------------------------------------------------

    function test_constructorSubscribesToBucketsSet() public view {
        assertEq(system.subCount(), 1);
        MockSystem.Sub memory sub = system.getSub(0);
        assertEq(sub.chainId, CHAIN);
        assertEq(sub.contract_, address(split));
        assertEq(sub.topic0, reactive.BUCKETS_SET_TOPIC_0());
    }

    function test_bucketsAreMirroredAndSubscribeTransfer() public {
        _react(_setAliceBuckets());

        (
            address[] memory payees,
            uint96[] memory fixedAmounts,
            uint16[] memory bps,
            bool[] memory active,
            uint256 version,
            bool subscribed
        ) = reactive.getRule(alice, address(token));
        assertEq(payees.length, 3);
        assertEq(payees[0], aliceRent);
        assertEq(fixedAmounts[0], RENT);
        assertEq(bps[1], 2_500);
        assertTrue(active[2]);
        assertEq(version, 1);
        assertTrue(subscribed);

        assertEq(system.subCount(), 2);
        MockSystem.Sub memory sub = system.lastSub();
        assertEq(sub.contract_, address(token));
        assertEq(sub.topic0, reactive.TRANSFER_TOPIC_0());
        assertEq(sub.topic1, IGNORE);
        assertEq(sub.topic2, uint256(uint160(alice)));
        assertEq(sub.topic3, IGNORE);
    }

    function test_ruleVersionIncrementsAndReplacesBuckets() public {
        _react(_setAliceBuckets());
        assertEq(split.ruleVersion(alice, address(token)), 1);

        PaydaySplit.Bucket[] memory next = new PaydaySplit.Bucket[](1);
        next[0] = bucket(aliceSavings, 0, 2_000, true);
        _react(_setBuckets(alice, next, 99));

        assertEq(split.ruleVersion(alice, address(token)), 2);
        assertEq(split.bucketCount(alice, address(token)), 1);
        PaydaySplit.Bucket[] memory stored = split.getBuckets(alice, address(token));
        assertEq(stored.length, 1);
        assertEq(stored[0].payee, aliceSavings);
        assertEq(stored[0].bps, 2_000);
    }

    function test_disableAllUnsubscribes() public {
        _armAlice();
        PaydaySplit.Bucket[] memory empty = new PaydaySplit.Bucket[](0);
        _react(_setBuckets(alice, empty, 7));

        bool subscribed = _lastBool();
        assertFalse(subscribed);
        assertEq(system.unsubscribeCount(), 1);
        assertEq(split.bucketCount(alice, address(token)), 0);
    }

    function _lastBool() internal view returns (bool) {
        (,,,,, bool subscribed) = reactive.getRule(alice, address(token));
        return subscribed;
    }

    // ------------------------------------------------------------------
    // Waterfall
    // ------------------------------------------------------------------

    function test_fullWaterfall() public {
        _armAlice();
        uint256 txHash = uint256(keccak256("paycheck-1"));
        _react(_transferLog(employer, alice, PAYCHECK, txHash, 0));

        assertEq(system.requestCount(), 1);
        ISystemContract.CallbackConfiguration_V_1_0 memory req = system.lastRequest();
        bytes memory expected = abi.encodeWithSignature(
            "executeSplit(address,address,address,uint256,uint256,uint256,uint256)",
            address(0),
            alice,
            address(token),
            PAYCHECK,
            uint256(1),
            txHash,
            uint256(0)
        );
        assertEq(req.payload, expected);
        assertEq(reactive.remaining(), LIMIT - 1);

        uint256 before = token.balanceOf(alice);
        assertTrue(_deliverLast());
        assertEq(token.balanceOf(aliceRent), RENT);
        assertEq(token.balanceOf(aliceTax), 250e6);
        assertEq(token.balanceOf(aliceSavings), 150e6);
        assertEq(token.balanceOf(alice), before - 700e6);
        assertTrue(split.processed(keccak256(abi.encode(alice, address(token), txHash, uint256(0)))));
    }

    function test_retainedEmitsWhenSpendingLeft() public {
        _armAlice();
        _react(_transferLog(employer, alice, PAYCHECK, 0xabc, 0));
        vm.recordLogs();
        assertTrue(_deliverLast());
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool retained;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == keccak256("Retained(address,address,uint256,uint256,uint256,uint256)")) {
                retained = true;
                (uint256 amount,,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
                assertEq(amount, 300e6);
            }
        }
        assertTrue(retained);
    }

    function test_priorityPartiallyFundsFixedBucket() public {
        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](3);
        buckets[0] = bucket(aliceRent, 800e6, 0, true);
        buckets[1] = bucket(aliceTax, 0, 5_000, true);
        buckets[2] = bucket(aliceSavings, 0, 2_000, true);
        _react(_setBuckets(alice, buckets, 1));

        _react(_transferLog(employer, alice, PAYCHECK, 2, 0));
        assertTrue(_deliverLast());

        assertEq(token.balanceOf(aliceRent), 800e6);
        assertEq(token.balanceOf(aliceTax), 200e6);
        assertEq(token.balanceOf(aliceSavings), 0);
    }

    function test_fixedPlusPercentInOneBucket() public {
        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](1);
        buckets[0] = bucket(aliceRent, 100e6, 2_000, true);
        _react(_setBuckets(alice, buckets, 1));
        _react(_transferLog(employer, alice, PAYCHECK, 3, 0));
        assertTrue(_deliverLast());
        assertEq(token.balanceOf(aliceRent), 300e6); // 100 fixed + 20%
    }

    function test_inactiveBucketIsSkipped() public {
        PaydaySplit.Bucket[] memory buckets = aliceBuckets();
        buckets[2].active = false;
        _react(_setBuckets(alice, buckets, 1));
        _react(_transferLog(employer, alice, PAYCHECK, 4, 0));
        assertTrue(_deliverLast());

        assertEq(token.balanceOf(aliceRent), RENT);
        assertEq(token.balanceOf(aliceTax), 250e6);
        assertEq(token.balanceOf(aliceSavings), 0);
        assertEq(token.balanceOf(alice), 10_450e6); // 10,000 + 1,000 - 550
    }

    function test_partialAllowanceSkipsOnlyAffectedBuckets() public {
        _armAlice();
        vm.prank(alice);
        token.approve(address(split), RENT);

        _react(_transferLog(employer, alice, PAYCHECK, 5, 0));
        assertTrue(_deliverLast());

        assertEq(token.balanceOf(aliceRent), RENT);
        assertEq(token.balanceOf(aliceTax), 0);
        assertEq(token.balanceOf(aliceSavings), 0);
        assertEq(token.balanceOf(alice), 10_700e6); // 10,000 + 1,000 - 300
    }

    function test_zeroAllowanceLeavesEverythingRetained() public {
        _armAlice();
        vm.prank(alice);
        token.approve(address(split), 0);

        _react(_transferLog(employer, alice, PAYCHECK, 6, 0));
        assertTrue(_deliverLast());

        assertEq(token.balanceOf(aliceRent), 0);
        assertEq(token.balanceOf(aliceTax), 0);
        assertEq(token.balanceOf(aliceSavings), 0);
        assertEq(token.balanceOf(alice), 11_000e6);
    }

    function test_staleRuleVersionIsRejected() public {
        _armAlice();
        _react(_transferLog(employer, alice, PAYCHECK, 8, 0));

        PaydaySplit.Bucket[] memory next = new PaydaySplit.Bucket[](1);
        next[0] = bucket(bobSavings, 0, 1_000, true);
        _react(_setBuckets(alice, next, 9));

        assertTrue(_deliverLast()); // callback succeeds, but emits StaleRule and moves nothing
        assertEq(token.balanceOf(aliceRent), 0);
        assertEq(token.balanceOf(bobSavings), 0);
    }

    function test_callbackIsIdempotent() public {
        _armAlice();
        _react(_transferLog(employer, alice, PAYCHECK, 10, 0));
        assertTrue(_deliverLast());
        assertTrue(_deliverLast());

        assertEq(token.balanceOf(aliceRent), RENT);
        assertEq(token.balanceOf(aliceTax), 250e6);
        assertEq(token.balanceOf(aliceSavings), 150e6);
        assertEq(token.balanceOf(alice), 10_300e6);
    }

    function test_budgetExhaustionStopsCallbacks() public {
        reactive.setCallbackLimit(1);
        _armAlice();
        _react(_transferLog(employer, alice, PAYCHECK, 11, 0));
        _react(_transferLog(employer, alice, PAYCHECK, 12, 1));
        assertEq(system.requestCount(), 1);
        assertEq(reactive.remaining(), 0);
    }

    function test_reactivePauseStopsCallbacks() public {
        _armAlice();
        reactive.setPaused(true);
        _react(_transferLog(employer, alice, PAYCHECK, 13, 0));
        assertEq(system.requestCount(), 0);
        reactive.setPaused(false);
        _react(_transferLog(employer, alice, PAYCHECK, 14, 0));
        assertEq(system.requestCount(), 1);
    }

    // ------------------------------------------------------------------
    // Validation
    // ------------------------------------------------------------------

    function test_totalBpsCap() public {
        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](2);
        buckets[0] = bucket(aliceRent, 0, 6_000, true);
        buckets[1] = bucket(aliceTax, 0, 5_000, true);
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.TotalBpsTooHigh.selector);
        split.setBuckets(address(token), buckets);

        buckets[1].bps = 4_000;
        vm.prank(alice);
        split.setBuckets(address(token), buckets);
        assertEq(split.bucketCount(alice, address(token)), 2);
    }

    function test_maxBuckets() public {
        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](9);
        for (uint256 i; i < 9; ++i) {
            buckets[i] = bucket(address(uint160(1_000 + i)), 1e6, 0, true);
        }
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.TooManyBuckets.selector);
        split.setBuckets(address(token), buckets);
    }

    function test_invalidPayeeIsRejected() public {
        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](1);
        buckets[0] = bucket(address(0), 1e6, 0, true);
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.InvalidPayee.selector);
        split.setBuckets(address(token), buckets);

        buckets[0] = bucket(alice, 1e6, 0, true);
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.InvalidPayee.selector);
        split.setBuckets(address(token), buckets);

        buckets[0] = bucket(address(split), 1e6, 0, true);
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.InvalidPayee.selector);
        split.setBuckets(address(token), buckets);
    }

    function test_emptyBucketIsRejected() public {
        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](1);
        buckets[0] = bucket(aliceRent, 0, 0, true);
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.EmptyBucket.selector);
        split.setBuckets(address(token), buckets);
    }

    function test_bpsCapPerBucket() public {
        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](1);
        buckets[0] = bucket(aliceRent, 0, 10_001, true);
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.BpsTooHigh.selector);
        split.setBuckets(address(token), buckets);
    }

    function test_setReactiveOnlyOnce() public {
        vm.expectRevert(PaydaySplit.ReactiveAlreadySet.selector);
        split.setReactive(address(0x1234));
    }

    function test_setReactiveOnlyOwner() public {
        PaydaySplit fresh = new PaydaySplit(IPayable(payable(address(proxy))), owner);
        vm.prank(alice);
        vm.expectRevert();
        fresh.setReactive(address(reactive));
        fresh.setReactive(address(reactive));
        assertEq(fresh.reactive(), address(reactive));
    }

    // ------------------------------------------------------------------
    // Authorization
    // ------------------------------------------------------------------

    function test_onlySystemCanReact() public {
        IReactive.LogRecord memory rec;
        vm.expectRevert();
        reactive.react(rec);
    }

    function test_onlyProxyCanExecuteSplit() public {
        vm.expectRevert();
        split.executeSplit(address(reactive), alice, address(token), PAYCHECK, 1, 1, 0);
    }

    function test_wrongReactiveIsRejected() public {
        _armAlice();
        _react(_transferLog(employer, alice, PAYCHECK, 20, 0));
        vm.prank(address(proxy));
        vm.expectRevert();
        split.executeSplit(address(0xBEEF), alice, address(token), PAYCHECK, 1, 20, 0);
    }

    function test_pausedSplitRejectsCallback() public {
        _armAlice();
        _react(_transferLog(employer, alice, PAYCHECK, 21, 0));
        split.pause();
        assertFalse(_deliverLast());
    }

    // ------------------------------------------------------------------
    // Fuzz
    // ------------------------------------------------------------------

    function testFuzz_waterfallNeverOverdraws(uint96 paycheck, uint16 bpsA, uint16 bpsB) public {
        bpsA = uint16(bound(bpsA, 1, 5_000));
        bpsB = uint16(bound(bpsB, 1, 10_000 - bpsA));
        paycheck = uint96(bound(paycheck, 1e6, 500_000e6));

        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](2);
        buckets[0] = bucket(aliceTax, 0, bpsA, true);
        buckets[1] = bucket(aliceSavings, 0, bpsB, true);
        _react(_setBuckets(alice, buckets, 1));

        uint256 initial = token.balanceOf(alice);
        _react(_transferLog(employer, alice, paycheck, uint256(keccak256(abi.encode(paycheck, bpsA, bpsB))), 0));
        if (system.requestCount() == 0) return;
        assertTrue(_deliverLast());

        uint256 routed = token.balanceOf(aliceTax) + token.balanceOf(aliceSavings);
        assertLe(routed, paycheck);
        assertEq(token.balanceOf(alice), initial + paycheck - routed);
    }

    // ------------------------------------------------------------------
    // Preview
    // ------------------------------------------------------------------

    function test_previewWaterfallMatchesFormula() public {
        _armAlice();
        (address[] memory payees, uint256[] memory amounts, uint256 retained) =
            split.previewWaterfall(alice, address(token), PAYCHECK);

        assertEq(payees.length, 3);
        assertEq(payees[0], aliceRent);
        assertEq(amounts[0], RENT);
        assertEq(amounts[1], 250e6);
        assertEq(amounts[2], 150e6);
        assertEq(retained, 300e6);
    }

    function testFuzz_previewMatchesExecution(uint96 fixedAmount, uint16 bps) public {
        fixedAmount = uint96(bound(fixedAmount, 0, PAYCHECK));
        bps = uint16(bound(bps, 0, 10_000));
        if (fixedAmount == 0 && bps == 0) fixedAmount = 1;

        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](1);
        buckets[0] = bucket(aliceSavings, fixedAmount, bps, true);
        _react(_setBuckets(alice, buckets, 1));

        (uint256[] memory amounts, uint256 retained) = _previewOne(address(token));
        uint256 previewAmount = amounts[0];
        uint256 initial = token.balanceOf(alice);

        _react(_transferLog(employer, alice, PAYCHECK, uint256(keccak256(abi.encode(fixedAmount, bps))), 0));
        if (system.requestCount() > 0) assertTrue(_deliverLast());

        assertEq(token.balanceOf(aliceSavings), previewAmount);
        assertEq(token.balanceOf(alice), initial + PAYCHECK - previewAmount);
        assertEq(retained, PAYCHECK - previewAmount);
    }

    function _previewOne(address token_) internal view returns (uint256[] memory amounts, uint256 retained) {
        (address[] memory payees, uint256[] memory values, uint256 left) =
            split.previewWaterfall(alice, token_, PAYCHECK);
        assertEq(payees.length, 1);
        return (values, left);
    }

    // ------------------------------------------------------------------
    // Non-standard ERC-20 behavior
    // ------------------------------------------------------------------

    function _setSingleBucketFor(address token_, address payee, uint96 fixedAmount) internal {
        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](1);
        buckets[0] = bucket(payee, fixedAmount, 0, true);
        vm.prank(alice);
        split.setBuckets(token_, buckets);
    }

    function _deliverFor(address token_, uint256 txHash) internal returns (bool ok) {
        bytes memory payload = abi.encodeWithSignature(
            "executeSplit(address,address,address,uint256,uint256,uint256,uint256)",
            address(0),
            alice,
            token_,
            PAYCHECK,
            uint256(1),
            txHash,
            uint256(0)
        );
        bytes memory ret;
        (ok, ret) = proxy.deliver(address(split), address(reactive), payload);
        ret;
    }

    function test_falseReturnTokenSkipsBucket() public {
        FalseReturnToken bad = new FalseReturnToken();
        bad.setBalance(alice, PAYCHECK);
        bad.setAllowance(alice, address(split), PAYCHECK);
        _setSingleBucketFor(address(bad), aliceSavings, 100e6);

        assertTrue(_deliverFor(address(bad), 1));
        assertEq(bad.balanceOf(alice), PAYCHECK);
        assertEq(bad.balanceOf(aliceSavings), 0);
    }

    function test_noReturnTokenPaysBucket() public {
        NoReturnToken usdtLike = new NoReturnToken();
        usdtLike.setBalance(alice, PAYCHECK);
        usdtLike.setAllowance(alice, address(split), PAYCHECK);
        _setSingleBucketFor(address(usdtLike), aliceSavings, 100e6);

        assertTrue(_deliverFor(address(usdtLike), 2));
        assertEq(usdtLike.balanceOf(alice), PAYCHECK - 100e6);
        assertEq(usdtLike.balanceOf(aliceSavings), 100e6);
    }

    function test_malformedReturnTokenSkipsBucket() public {
        MalformedReturnToken malformed = new MalformedReturnToken();
        malformed.setBalance(alice, PAYCHECK);
        malformed.setAllowance(alice, address(split), PAYCHECK);
        _setSingleBucketFor(address(malformed), aliceSavings, 100e6);

        assertTrue(_deliverFor(address(malformed), 3));
        assertEq(malformed.balanceOf(alice), PAYCHECK);
        assertEq(malformed.balanceOf(aliceSavings), 0);
    }

    // ------------------------------------------------------------------
    // Admin / views
    // ------------------------------------------------------------------

    function test_rescueAndPauseAdmin() public {
        token.mint(address(split), 5e6);
        split.rescueERC20(address(token), owner, 5e6);
        assertEq(token.balanceOf(owner), 5e6);

        vm.deal(address(split), 1 ether);
        address payable ethRecipient = payable(address(0xBEEF));
        split.rescueETH(ethRecipient, 0.5 ether);
        assertEq(address(split).balance, 0.5 ether);
        assertEq(ethRecipient.balance, 0.5 ether);

        split.pause();
        assertTrue(split.paused());
        split.unpause();
        assertFalse(split.paused());
    }

    function test_getBucketsAndCount() public {
        _armAlice();
        PaydaySplit.Bucket[] memory stored = split.getBuckets(alice, address(token));
        assertEq(stored.length, 3);
        assertEq(split.bucketCount(alice, address(token)), 3);
        assertEq(stored[1].bps, 2_500);
    }

    // ------------------------------------------------------------------
    // Reactive edge cases
    // ------------------------------------------------------------------

    function _mirrorRecord(
        address user,
        address token_,
        uint256 version,
        address[] memory payees,
        uint96[] memory fixedAmounts,
        uint16[] memory bps,
        bool[] memory active
    ) internal view returns (IReactive.LogRecord memory rec) {
        rec.chainId = CHAIN;
        rec.contractAddress = address(split);
        rec.topic0 = reactive.BUCKETS_SET_TOPIC_0();
        rec.topic1 = uint256(uint160(user));
        rec.topic2 = uint256(uint160(token_));
        rec.topic3 = version;
        rec.data = abi.encode(payees, fixedAmounts, bps, active);
        rec.opCode = 4;
        rec.txHash = uint256(keccak256(abi.encode(user, version)));
    }

    function _assertNoRule(address user) internal view {
        (address[] memory payees,,,,,) = reactive.getRule(user, address(token));
        assertEq(payees.length, 0);
    }

    function test_reactiveRejectsMalformedBuckets() public {
        address carol = makeAddr("carol");
        uint256 subsBefore = system.subCount();

        address[] memory payees = new address[](1);
        uint96[] memory fixedAmounts = new uint96[](1);
        uint16[] memory bps = new uint16[](1);
        bool[] memory active = new bool[](1);
        payees[0] = aliceSavings;
        fixedAmounts[0] = 1e6;
        bps[0] = 0;
        active[0] = true;

        IReactive.LogRecord memory rec = _mirrorRecord(carol, address(token), 1, payees, fixedAmounts, bps, active);
        rec.chainId = 1;
        _react(rec);

        rec = _mirrorRecord(carol, address(token), 1, payees, fixedAmounts, bps, active);
        rec.contractAddress = address(0xBEEF);
        _react(rec);

        rec = _mirrorRecord(carol, address(token), 0, payees, fixedAmounts, bps, active);
        _react(rec);

        rec = _mirrorRecord(carol, address(token), 1, payees, fixedAmounts, bps, active);
        rec.topic1 = 0;
        _react(rec);

        rec = _mirrorRecord(carol, address(token), 1, payees, fixedAmounts, bps, active);
        payees[0] = address(0);
        rec.data = abi.encode(payees, fixedAmounts, bps, active);
        _react(rec);

        payees[0] = carol;
        rec.data = abi.encode(payees, fixedAmounts, bps, active);
        _react(rec);

        payees[0] = address(split);
        rec.data = abi.encode(payees, fixedAmounts, bps, active);
        _react(rec);

        payees[0] = aliceSavings;
        bps[0] = 10_001;
        rec.data = abi.encode(payees, fixedAmounts, bps, active);
        _react(rec);

        bps[0] = 0;
        fixedAmounts[0] = 0;
        rec.data = abi.encode(payees, fixedAmounts, bps, active);
        _react(rec);

        fixedAmounts[0] = 1e6;
        rec.data = abi.encode(payees, fixedAmounts, new uint16[](0), active);
        _react(rec);

        _assertNoRule(carol);
        assertEq(system.subCount(), subsBefore);
    }

    function test_reactiveTransferFilters() public {
        _armAlice();
        uint256 before = system.requestCount();

        // Zero amount.
        IReactive.LogRecord memory rec = _transferLog(employer, alice, 0, 30, 0);
        _react(rec);

        // Wrong opCode (not a standard LOG3 Transfer).
        rec = _transferLog(employer, alice, PAYCHECK, 31, 0);
        rec.opCode = 2;
        _react(rec);

        // Self transfer.
        rec = _transferLog(alice, alice, PAYCHECK, 32, 0);
        _react(rec);

        // Refund from one of the user's own payees.
        token.mint(aliceRent, PAYCHECK);
        rec = _transferLog(aliceRent, alice, PAYCHECK, 33, 0);
        _react(rec);

        // Short data.
        rec = _transferLog(employer, alice, PAYCHECK, 34, 0);
        rec.data = "";
        _react(rec);

        assertEq(system.requestCount(), before);

        // A valid transfer after all filters.
        _react(_transferLog(employer, alice, PAYCHECK, 35, 0));
        assertEq(system.requestCount(), before + 1);
    }

    function test_reactiveDuplicatesAndPause() public {
        _armAlice();
        _react(_transferLog(employer, alice, PAYCHECK, 40, 7));
        uint256 count = system.requestCount();
        assertEq(count, 1);

        // Same (txHash, logIndex) is skipped.
        _react(_transferLog(employer, alice, PAYCHECK, 40, 7));
        assertEq(system.requestCount(), count);

        reactive.setPaused(true);
        _react(_transferLog(employer, alice, PAYCHECK, 41, 0));
        assertEq(system.requestCount(), count);
        reactive.setPaused(false);
    }

    function test_reactiveAdminAndEmptyView() public {
        vm.deal(address(reactive), 2 ether);
        reactive.setCallbackLimit(7);
        assertEq(reactive.remaining(), 7);
        reactive.coverDebt();
        reactive.setPaused(true);
        assertTrue(reactive.paused());

        address payable recipient = payable(address(0xBEEF));
        uint256 before = recipient.balance;
        reactive.rescueETH(recipient, 0.5 ether);
        assertEq(recipient.balance, before + 0.5 ether);

        vm.prank(alice);
        vm.expectRevert();
        reactive.topUp(1);

        (address[] memory payees,,,,, bool subscribed) = reactive.getRule(bob, address(token));
        assertEq(payees.length, 0);
        assertFalse(subscribed);
    }

    // ------------------------------------------------------------------
    // Liveness / replay hardening
    // ------------------------------------------------------------------

    function test_reactiveMinPaycheck() public {
        _armAlice();
        reactive.setMinPaycheck(2e6);

        _react(_transferLog(employer, alice, 1e6, 50, 0));
        assertEq(system.requestCount(), 0);

        _react(_transferLog(employer, alice, 2e6, 51, 0));
        assertEq(system.requestCount(), 1);
    }

    function test_reactiveIgnoresOlderMirrorVersion() public {
        address carol = makeAddr("carol");
        address[] memory payees = new address[](1);
        uint96[] memory fixedAmounts = new uint96[](1);
        uint16[] memory bps = new uint16[](1);
        bool[] memory active = new bool[](1);
        payees[0] = aliceSavings;
        fixedAmounts[0] = 1e6;
        active[0] = true;

        _react(_mirrorRecord(carol, address(token), 2, payees, fixedAmounts, bps, active));
        (,,,,, bool subscribed) = reactive.getRule(carol, address(token));
        assertTrue(subscribed);

        _react(_mirrorRecord(carol, address(token), 1, payees, fixedAmounts, bps, active));
        (address[] memory stored,,,, uint256 version,) = reactive.getRule(carol, address(token));
        assertEq(stored.length, 1);
        assertEq(version, 2);
    }

    function test_reactiveUserBudget() public {
        _armAlice();
        reactive.setUserBudget(alice, address(token), 1);

        _react(_transferLog(employer, alice, PAYCHECK, 60, 0));
        _react(_transferLog(employer, alice, PAYCHECK, 61, 0));
        assertEq(system.requestCount(), 1);

        reactive.topUpUser(alice, address(token), 1);
        _react(_transferLog(employer, alice, PAYCHECK, 62, 0));
        assertEq(system.requestCount(), 2);
    }

    function test_resavingIdenticalRuleDoesNotBumpVersion() public {
        _armAlice();
        assertEq(split.ruleVersion(alice, address(token)), 1);

        _react(_setBuckets(alice, aliceBuckets(), 100));
        assertEq(split.ruleVersion(alice, address(token)), 1);
        assertEq(split.bucketCount(alice, address(token)), 3);
    }

    function test_manualRunSplitRecoversWithoutCallback() public {
        _armAlice();
        uint256 initial = token.balanceOf(alice);

        vm.prank(alice);
        split.runSplit(address(token), PAYCHECK);

        assertEq(token.balanceOf(alice), initial - 700e6);
        assertEq(token.balanceOf(aliceRent), 300e6);
        assertEq(token.balanceOf(aliceTax), 250e6);
        assertEq(token.balanceOf(aliceSavings), 150e6);
    }

    function test_setBucketsRejectsEOAToken() public {
        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](1);
        buckets[0] = bucket(aliceSavings, 100e6, 0, true);
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.InvalidToken.selector);
        split.setBuckets(address(0xBEEF), buckets);
    }

    function test_revertingTokenSkipsBucket() public {
        RevertingToken bad = new RevertingToken();
        bad.setBalance(alice, PAYCHECK);
        bad.setAllowance(alice, address(split), PAYCHECK);
        _setSingleBucketFor(address(bad), aliceSavings, 100e6);

        assertTrue(_deliverFor(address(bad), 5));
        assertEq(bad.balanceOf(alice), PAYCHECK);
        assertEq(bad.balanceOf(aliceSavings), 0);
    }

    function test_revertingBalanceReadFailsClosedWithoutRevertingCallback() public {
        RevertingBalanceToken tokenWithBadView = new RevertingBalanceToken();
        tokenWithBadView.setBalance(alice, PAYCHECK);
        tokenWithBadView.setAllowance(alice, address(split), PAYCHECK);
        _setSingleBucketFor(address(tokenWithBadView), aliceSavings, 100e6);

        assertTrue(_deliverFor(address(tokenWithBadView), 6));
        assertEq(tokenWithBadView.actualBalance(alice), PAYCHECK);
        assertEq(tokenWithBadView.actualBalance(aliceSavings), 0);
    }

    function _goal(uint256 index, uint96 target, bool reset) internal {
        uint256 version = split.ruleVersion(alice, address(token));
        vm.prank(alice);
        split.setBucketGoal(address(token), index, version, target, reset);
    }

    function test_goalStopsRepeatedFixedBillsAndLeavesLaterBucketsActive() public {
        _armAlice();
        _goal(0, 350e6, false);
        _manual();
        _manual();
        _manual();
        assertEq(token.balanceOf(aliceRent), 350e6);
        assertEq(token.balanceOf(aliceTax), 750e6);
        (uint96 target, uint96 paid, uint64 cycle) = split.bucketGoals(alice, address(token), 1, 0);
        assertEq(target, 350e6);
        assertEq(paid, target);
        assertEq(cycle, 1);
    }

    function test_goalEditPreservesPaidAndExplicitNewCycleResets() public {
        _armAlice();
        _goal(0, 300e6, false);
        _manual();
        _goal(0, 300e6, false);
        _manual();
        assertEq(token.balanceOf(aliceRent), 300e6);
        _goal(0, 500e6, false);
        _manual();
        assertEq(token.balanceOf(aliceRent), 500e6);
        _goal(0, 100e6, false);
        _manual();
        assertEq(token.balanceOf(aliceRent), 500e6);
        _goal(0, 100e6, true);
        _manual();
        assertEq(token.balanceOf(aliceRent), 600e6);
        (, uint96 paid, uint64 cycle) = split.bucketGoals(alice, address(token), 1, 0);
        assertEq(paid, 100e6);
        assertEq(cycle, 2);
    }

    function test_goalDisablePreservesHistoricalProgress() public {
        _armAlice();
        _goal(0, 500e6, false);
        _manual();
        _goal(0, 0, false);
        _manual();
        (, uint96 paid,) = split.bucketGoals(alice, address(token), 1, 0);
        assertEq(paid, 300e6);
        _goal(0, 500e6, false);
        _manual();
        assertEq(token.balanceOf(aliceRent), 800e6);
    }

    function test_goalFollowsRuleVersionAndRejectsStaleConfiguration() public {
        _armAlice();
        _goal(0, 300e6, false);
        _manual();
        vm.prank(alice);
        split.setBuckets(address(token), aliceBuckets());
        _manual(); // identical rule save preserves goal
        assertEq(token.balanceOf(aliceRent), 300e6);
        PaydaySplit.Bucket[] memory list = aliceBuckets();
        list[0].fixedAmount = 301e6;
        vm.prank(alice);
        split.setBuckets(address(token), list);
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.GoalVersionMismatch.selector);
        split.setBucketGoal(address(token), 0, 1, 100e6, false);
        _manual(); // stable identity keeps the existing goal even when its amount changes
        assertEq(token.balanceOf(aliceRent), 300e6);
    }

    function test_goalIsUserScopedAndRejectsMissingBucket() public {
        _armAlice();
        vm.prank(bob);
        vm.expectRevert(PaydaySplit.InvalidBucket.selector);
        split.setBucketGoal(address(token), 0, 1, 100e6, false);
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.InvalidBucket.selector);
        split.setBucketGoal(address(token), 3, 1, 100e6, false);
        _manual();
        assertEq(token.balanceOf(aliceRent), RENT);
    }

    function test_failedPaymentDoesNotAdvanceGoal() public {
        _armAlice();
        _goal(0, 350e6, false);
        vm.prank(alice);
        token.approve(address(split), 0);
        _manual();
        (, uint96 paid,) = split.bucketGoals(alice, address(token), 1, 0);
        assertEq(paid, 0);
        vm.prank(alice);
        token.approve(address(split), PAYCHECK);
        _manual();
        (, paid,) = split.bucketGoals(alice, address(token), 1, 0);
        assertEq(paid, RENT);
    }

    function test_executionPreviewIncludesPolicyGoalsAndDailySpend() public {
        _armAlice();
        _goal(0, 350e6, false);
        _policy(0, 600e6, 900e6, 0, 0, false);
        _manual(); // rent 300, tax 250, savings 50
        (uint256[] memory amounts, uint256 retained, uint8 blocked) =
            split.previewExecution(alice, address(token), PAYCHECK);
        assertEq(amounts[0], 50e6);
        assertEq(amounts[1], 250e6);
        assertEq(amounts[2], 0);
        assertEq(retained, 700e6);
        assertEq(blocked, 0);
        _manual();
        assertEq(token.balanceOf(aliceRent), 350e6);
        assertEq(token.balanceOf(aliceTax), 500e6);
    }

    function test_executionPreviewReportsPauseExpiryAndMinimum() public {
        _armAlice();
        _policy(0, 0, 0, 0, 0, true);
        (,, uint8 reason) = split.previewExecution(alice, address(token), PAYCHECK);
        assertEq(reason, 1);
        _policy(0, 0, 0, 0, uint64(block.timestamp), false);
        (,, reason) = split.previewExecution(alice, address(token), PAYCHECK);
        assertEq(reason, 2);
        _policy(0, 0, 0, uint96(PAYCHECK + 1), 0, false);
        (,, reason) = split.previewExecution(alice, address(token), PAYCHECK);
        assertEq(reason, 3);
        split.pause();
        (,, reason) = split.previewExecution(alice, address(token), PAYCHECK);
        assertEq(reason, 4);
    }

    function testFuzz_executionPreviewMatchesGoalAndPolicy(uint96 goal, uint96 cap) public {
        goal = uint96(bound(goal, 1, PAYCHECK));
        cap = uint96(bound(cap, 1, PAYCHECK));
        _armAlice();
        _goal(0, goal, false);
        _policy(0, cap, 0, 0, 0, false);
        (uint256[] memory amounts, uint256 retained,) = split.previewExecution(alice, address(token), PAYCHECK);
        _manual();
        assertEq(token.balanceOf(aliceRent), amounts[0]);
        assertEq(token.balanceOf(aliceTax), amounts[1]);
        assertEq(token.balanceOf(aliceSavings), amounts[2]);
        assertEq(retained + amounts[0] + amounts[1] + amounts[2], PAYCHECK);
    }

    function test_eightActiveGoalsFitCallbackGas() public {
        PaydaySplit.Bucket[] memory list = new PaydaySplit.Bucket[](8);
        for (uint256 i; i < 8; ++i) {
            list[i] = bucket(address(uint160(0x2000 + i)), 10e6, 0, true);
        }
        _react(_setBuckets(alice, list, 998));
        for (uint256 i; i < 8; ++i) {
            _goal(i, 100e6, false);
        }
        _react(_transferLog(employer, alice, PAYCHECK, 999, 0));
        ISystemContract.CallbackConfiguration_V_1_0 memory req = system.lastRequest();
        (bool ok,) = proxy.deliver{ gas: 900_000 }(address(split), address(reactive), req.payload);
        assertTrue(ok);
        for (uint256 i; i < 8; ++i) {
            assertEq(token.balanceOf(address(uint160(0x2000 + i))), 10e6);
        }
    }

    function _policy(uint96 reserve, uint96 perRun, uint96 daily, uint96 minimum, uint64 expiry, bool stop) internal {
        vm.prank(alice);
        split.setPolicy(address(token), PaydaySplit.Policy(reserve, perRun, daily, minimum, expiry, stop));
    }

    function test_transferStateRollsBackWhenTokenReturnsFalse() public {
        MovesThenFailsToken bad = new MovesThenFailsToken();
        bad.setBalance(alice, PAYCHECK);
        bad.setAllowance(alice, address(split), PAYCHECK);
        _setSingleBucketFor(address(bad), aliceSavings, 100e6);
        assertTrue(_deliverFor(address(bad), 991));
        assertEq(bad.balanceOf(alice), PAYCHECK);
        assertEq(bad.balanceOf(aliceSavings), 0);
        assertEq(bad.allowance(alice, address(split)), PAYCHECK);
    }

    function test_recoverConsumesDelayedCallbackAndCannotReplay() public {
        _armAlice();
        _react(_transferLog(employer, alice, PAYCHECK, 992, 3));
        vm.prank(alice);
        split.recoverSplit(address(token), PAYCHECK, 992, 3);
        assertEq(token.balanceOf(aliceRent), RENT);
        assertTrue(_deliverLast());
        vm.prank(alice);
        split.recoverSplit(address(token), PAYCHECK, 992, 3);
        assertEq(token.balanceOf(aliceRent), RENT);
    }

    function test_recoveryKeyIsIsolatedByUser() public {
        _armAlice();
        PaydaySplit.Bucket[] memory list = new PaydaySplit.Bucket[](1);
        list[0] = bucket(bobSavings, 0, 1000, true);
        vm.prank(bob);
        split.setBuckets(address(token), list);
        vm.prank(bob);
        split.recoverSplit(address(token), PAYCHECK, 993, 0);
        _react(_transferLog(employer, alice, PAYCHECK, 993, 0));
        assertTrue(_deliverLast());
        assertEq(token.balanceOf(aliceRent), RENT);
    }

    function test_ownershipRequiresAcceptance() public {
        split.coverDebt(); // zero debt is a no-op
        vm.prank(alice);
        vm.expectRevert();
        split.coverDebt();
        split.transferOwnership(bob);
        assertEq(split.owner(), owner);
        vm.prank(alice);
        vm.expectRevert();
        split.acceptOwnership();
        vm.prank(bob);
        split.acceptOwnership();
        assertEq(split.owner(), bob);
    }

    function test_eightBucketsFitCallbackGasWithPolicy() public {
        PaydaySplit.Bucket[] memory list = new PaydaySplit.Bucket[](8);
        for (uint256 i; i < 8; ++i) {
            list[i] = bucket(address(uint160(0x1000 + i)), 10e6, 0, true);
        }
        _react(_setBuckets(alice, list, 994));
        _policy(1e6, 900e6, 900e6, 1, 0, false);
        _react(_transferLog(employer, alice, PAYCHECK, 995, 0));
        ISystemContract.CallbackConfiguration_V_1_0 memory req = system.lastRequest();
        (bool ok,) = proxy.deliver{ gas: 900_000 }(address(split), address(reactive), req.payload);
        assertTrue(ok);
        for (uint256 i; i < 8; ++i) {
            assertEq(token.balanceOf(address(uint160(0x1000 + i))), 10e6);
        }
    }

    function _manual() internal {
        vm.prank(alice);
        split.runSplit(address(token), PAYCHECK);
    }

    function test_policyReserveProtectsWallet() public {
        _armAlice();
        _policy(9_800e6, 0, 0, 0, 0, false);
        _manual();
        assertEq(token.balanceOf(alice), 9_800e6);
        assertEq(token.balanceOf(aliceRent), 200e6);
    }

    function test_policyReserveAboveBalanceBlocks() public {
        _armAlice();
        _policy(11_000e6, 0, 0, 0, 0, false);
        _manual();
        assertEq(token.balanceOf(alice), 10_000e6);
    }

    function test_policyRunCapPreservesPriority() public {
        _armAlice();
        _policy(0, 400e6, 0, 0, 0, false);
        _manual();
        assertEq(token.balanceOf(aliceRent), 300e6);
        assertEq(token.balanceOf(aliceTax), 100e6);
        assertEq(token.balanceOf(aliceSavings), 0);
    }

    function test_policyDailyCapIncludesManualAndCallback() public {
        _armAlice();
        _policy(0, 0, 900e6, 0, 0, false);
        _manual(); // spends 700
        _react(_transferLog(employer, alice, PAYCHECK, 123, 0));
        assertTrue(_deliverLast()); // only 200 remains today
        assertEq(token.balanceOf(aliceRent), 500e6);
        (, uint256 spent) = split.dailySpend(alice, address(token));
        assertEq(spent, 900e6);
        _manual();
        assertEq(token.balanceOf(aliceRent), 500e6);
    }

    function test_policyDailyRolloverAndNoResetByEditing() public {
        _armAlice();
        _policy(0, 0, 400e6, 0, 0, false);
        _manual();
        _policy(0, 0, 400e6, 0, 0, false);
        _manual();
        assertEq(token.balanceOf(aliceRent), 300e6);
        vm.warp((block.timestamp / 1 days + 1) * 1 days);
        _manual();
        assertEq(token.balanceOf(aliceRent), 600e6);
    }

    function test_policyPauseBlocksQueuedCallback() public {
        _armAlice();
        _react(_transferLog(employer, alice, PAYCHECK, 124, 0));
        _policy(0, 0, 0, 0, 0, true);
        assertTrue(_deliverLast());
        _manual();
        assertEq(token.balanceOf(aliceRent), 0);
        _policy(0, 0, 0, 0, 0, false);
        assertTrue(_deliverLast()); // consumed while paused: no deferred spending
        assertEq(token.balanceOf(aliceRent), 0);
        _manual();
        assertEq(token.balanceOf(aliceRent), RENT);
    }

    function test_policyExpiryAndMinimum() public {
        _armAlice();
        _policy(0, 0, 0, uint96(PAYCHECK + 1), 0, false);
        _manual();
        assertEq(token.balanceOf(aliceRent), 0);
        _policy(0, 0, 0, 0, uint64(block.timestamp + 20), false);
        vm.warp(block.timestamp + 20);
        _manual();
        assertEq(token.balanceOf(aliceRent), 0);
    }

    function test_policyCannotChangeAnotherUser() public {
        _armAlice();
        vm.prank(bob);
        split.setPolicy(address(token), PaydaySplit.Policy(0, 0, 0, 0, 0, true));
        _manual();
        assertEq(token.balanceOf(aliceRent), RENT);
    }

    function test_transferBucketCannotBeCalledExternally() public {
        vm.expectRevert(PaydaySplit.OnlySelf.selector);
        split.transferBucket(token, alice, bob, PAYCHECK);
    }

    function testFuzz_policyNeverExceedsCaps(uint96 runCap, uint96 dailyCap) public {
        runCap = uint96(bound(runCap, 1, PAYCHECK));
        dailyCap = uint96(bound(dailyCap, 1, PAYCHECK));
        _armAlice();
        _policy(0, runCap, dailyCap, 0, 0, false);
        _manual();
        uint256 paid = 10_000e6 - token.balanceOf(alice);
        assertLe(paid, runCap);
        assertLe(paid, dailyCap);
    }

    function _ratioRule() internal {
        PaydaySplit.Bucket[] memory list = new PaydaySplit.Bucket[](3);
        list[0] = bucket(aliceRent, 0, 5000, true);
        list[1] = bucket(aliceTax, 0, 3000, true);
        list[2] = bucket(aliceSavings, 0, 2000, true);
        _react(_setBuckets(alice, list, 10001));
        vm.prank(alice);
        split.setAllocationMode(address(token), PaydaySplit.AllocationMode.ProRata);
    }

    function test_proRataUsesFixedBudgetForAllRecipients() public {
        _ratioRule();
        _policy(0, 600e6, 0, 0, 0, false);
        (uint256[] memory amounts, uint256 retained,) = split.previewExecution(alice, address(token), PAYCHECK);
        assertEq(amounts[0], 300e6);
        assertEq(amounts[1], 180e6);
        assertEq(amounts[2], 120e6);
        assertEq(retained, 400e6);
        _manual();
        assertEq(token.balanceOf(aliceRent), amounts[0]);
        assertEq(token.balanceOf(aliceTax), amounts[1]);
        assertEq(token.balanceOf(aliceSavings), amounts[2]);
    }

    function test_proRataAllowanceLimitsBaseRatherThanSkippingLargerShares() public {
        _ratioRule();
        vm.prank(alice);
        token.approve(address(split), 100e6);
        _manual();
        assertEq(token.balanceOf(aliceRent), 50e6);
        assertEq(token.balanceOf(aliceTax), 30e6);
        assertEq(token.balanceOf(aliceSavings), 20e6);
    }

    function test_proRataGoalDoesNotRedistributeUnusedShare() public {
        _ratioRule();
        _goal(0, 100e6, false);
        _manual();
        assertEq(token.balanceOf(aliceRent), 100e6);
        assertEq(token.balanceOf(aliceTax), 300e6);
        assertEq(token.balanceOf(aliceSavings), 200e6);
        assertEq(token.balanceOf(alice), 9_400e6);
    }

    function test_modeRejectsFixedAmountsAtomically() public {
        _armAlice();
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.FixedAmountInProRata.selector);
        split.setAllocationMode(address(token), PaydaySplit.AllocationMode.ProRata);
        assertEq(uint256(split.allocationModes(alice, address(token))), 0);
        assertEq(split.ruleVersion(alice, address(token)), 1);
    }

    function test_modeSaveIsNoOpAndSwitchInvalidatesOldCallback() public {
        _ratioRule();
        uint256 version = split.ruleVersion(alice, address(token));
        vm.prank(alice);
        split.setAllocationMode(address(token), PaydaySplit.AllocationMode.ProRata);
        assertEq(split.ruleVersion(alice, address(token)), version);
        bytes memory payload = abi.encodeWithSelector(
            split.executeSplit.selector, address(0), alice, address(token), PAYCHECK, version - 1, 20001, 0
        );
        (bool ok,) = proxy.deliver(address(split), address(reactive), payload);
        assertTrue(ok);
        assertEq(token.balanceOf(aliceRent), 0);
    }

    function test_bucketIdentitySurvivesReorderAndRetainsGoal() public {
        _armAlice();
        _goal(0, 300e6, false);
        _manual();
        uint64[] memory ids = split.getBucketIds(alice, address(token));
        PaydaySplit.Bucket[] memory list = aliceBuckets();
        (list[0], list[2]) = (list[2], list[0]);
        (ids[0], ids[2]) = (ids[2], ids[0]);
        vm.prank(alice);
        split.setBucketsWithIds(address(token), list, ids);
        (uint96 target, uint96 paid,) = split.bucketGoals(alice, address(token), 2, 2);
        assertEq(target, 300e6);
        assertEq(paid, 300e6);
        _manual();
        assertEq(token.balanceOf(aliceRent), 300e6);
    }

    function test_bucketIdentityRejectsDuplicatesUnknownAndPayeeReplacement() public {
        _armAlice();
        uint64[] memory ids = split.getBucketIds(alice, address(token));
        PaydaySplit.Bucket[] memory list = aliceBuckets();
        ids[1] = ids[0];
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.InvalidBucketIdentity.selector);
        split.setBucketsWithIds(address(token), list, ids);
        ids[1] = 99;
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.InvalidBucketIdentity.selector);
        split.setBucketsWithIds(address(token), list, ids);
        ids[1] = 2;
        list[0].payee = bob;
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.InvalidBucketIdentity.selector);
        split.setBucketsWithIds(address(token), list, ids);
    }

    function test_newIdentityDoesNotInheritPreviousPayeeGoal() public {
        _armAlice();
        _goal(0, 300e6, false);
        _manual();
        uint64[] memory ids = split.getBucketIds(alice, address(token));
        PaydaySplit.Bucket[] memory list = aliceBuckets();
        list[0].payee = bob;
        ids[0] = 0;
        vm.prank(alice);
        split.setBucketsWithIds(address(token), list, ids);
        (uint96 target,,) = split.bucketGoals(alice, address(token), 2, 0);
        assertEq(target, 0);
        uint256 before = token.balanceOf(bob);
        _manual();
        assertEq(token.balanceOf(bob) - before, 300e6);
    }

    function test_automaticWeeklyGoalResetsAtExactBoundaryWithoutResettingDailyPolicy() public {
        _armAlice();
        uint64 anchor = uint64(block.timestamp);
        vm.prank(alice);
        split.setCycleConfig(address(token), anchor, 7 days);
        _goal(0, 350e6, false);
        _manual();
        _manual();
        _manual();
        assertEq(token.balanceOf(aliceRent), 350e6);
        vm.warp(uint256(anchor) + 7 days - 1);
        _manual();
        assertEq(token.balanceOf(aliceRent), 350e6);
        vm.warp(uint256(anchor) + 7 days);
        (, uint96 paid, uint64 cycle) = split.bucketGoals(alice, address(token), 1, 0);
        assertEq(paid, 0);
        assertEq(cycle, 2);
        _policy(0, 0, 200e6, 0, 0, false);
        _manual();
        _manual();
        assertEq(token.balanceOf(aliceRent), 350e6); // earlier execution on this UTC day already spent 400
        vm.warp((block.timestamp / 1 days + 1) * 1 days);
        _manual();
        assertEq(token.balanceOf(aliceRent), 550e6);
    }

    function test_cycleFutureAnchorBlocksAndInvalidConfigCannotReset() public {
        _armAlice();
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.InvalidCycle.selector);
        split.setCycleConfig(address(token), 1, 60);
        vm.prank(alice);
        split.setCycleConfig(address(token), uint64(block.timestamp + 1 days), 7 days);
        (,, uint8 blocked) = split.previewExecution(alice, address(token), PAYCHECK);
        assertEq(blocked, 5);
        _manual();
        assertEq(token.balanceOf(aliceRent), 0);
        _goal(0, 350e6, false);
        vm.prank(alice);
        vm.expectRevert(PaydaySplit.AutomaticCycleActive.selector);
        split.setBucketGoal(address(token), 0, 1, 350e6, true);
    }

    function test_cycleIdenticalSavePreservesProgressAndScheduleEditStartsGeneration() public {
        _armAlice();
        uint64 anchor = uint64(block.timestamp);
        vm.prank(alice);
        split.setCycleConfig(address(token), anchor, 7 days);
        _goal(0, 350e6, false);
        _manual();
        vm.prank(alice);
        split.setCycleConfig(address(token), anchor, 7 days);
        (, uint96 paid,) = split.bucketGoals(alice, address(token), 1, 0);
        assertEq(paid, 300e6);
        vm.prank(alice);
        split.setCycleConfig(address(token), anchor, 14 days);
        (, paid,) = split.bucketGoals(alice, address(token), 1, 0);
        assertEq(paid, 0);
    }

    function testFuzz_proRataPreviewMatchesAndNeverOverdraws(uint96 cap, uint96 target) public {
        _ratioRule();
        cap = uint96(bound(cap, 1, PAYCHECK));
        target = uint96(bound(target, 1, PAYCHECK));
        _policy(0, cap, 0, 0, 0, false);
        _goal(0, target, false);
        (uint256[] memory amounts,,) = split.previewExecution(alice, address(token), PAYCHECK);
        _manual();
        assertEq(token.balanceOf(aliceRent), amounts[0]);
        assertEq(token.balanceOf(aliceTax), amounts[1]);
        assertEq(token.balanceOf(aliceSavings), amounts[2]);
        assertLe(amounts[0] + amounts[1] + amounts[2], cap);
        assertLe(amounts[0], target);
    }

    function test_previewMaxUintDoesNotOverflow() public {
        _armAlice();
        (,, uint256 retained) = split.previewWaterfall(alice, address(token), type(uint256).max);
        assertLe(retained, type(uint256).max);
    }

    function test_gasGriefingRecipientCannotStarveLaterBucket() public {
        GasGriefToken grief = new GasGriefToken();
        grief.setup(alice, address(split), aliceRent);
        PaydaySplit.Bucket[] memory list = new PaydaySplit.Bucket[](2);
        list[0] = bucket(aliceRent, 100e6, 0, true);
        list[1] = bucket(aliceSavings, 100e6, 0, true);
        vm.prank(alice);
        split.setBuckets(address(grief), list);
        vm.prank(alice);
        split.runSplit(address(grief), PAYCHECK);
        assertEq(grief.balanceOf(aliceRent), 0);
        assertEq(grief.balanceOf(aliceSavings), 100e6);
    }

    function test_sevenGasBurningBucketsFitRequestedCallbackGasAndLastBucketPays() public {
        GasGriefToken grief = new GasGriefToken();
        grief.setup(alice, address(split), aliceRent);
        PaydaySplit.Bucket[] memory list = new PaydaySplit.Bucket[](8);
        for (uint256 i; i < 8; ++i) {
            list[i] = bucket(i == 7 ? aliceSavings : aliceRent, 100e6, 0, true);
        }
        vm.prank(alice);
        split.setBuckets(address(grief), list);
        bytes memory payload = abi.encodeCall(
            split.executeSplit,
            (address(0), alice, address(grief), PAYCHECK, split.ruleVersion(alice, address(grief)), 123456, 0)
        );
        (bool ok,) = proxy.deliver{ gas: reactive.CALLBACK_GAS_LIMIT() }(address(split), address(reactive), payload);
        assertTrue(ok);
        assertEq(grief.balanceOf(aliceRent), 0);
        assertEq(grief.balanceOf(aliceSavings), 100e6);
        assertEq(grief.balanceOf(alice), 900e6);
        (bool replayOK,) = proxy.deliver(address(split), address(reactive), payload);
        assertTrue(replayOK);
        assertEq(grief.balanceOf(aliceSavings), 100e6);
    }

    function test_reentrantTokenCannotDoubleSplit() public {
        ReentrantToken reentrant = new ReentrantToken();
        reentrant.setBalance(alice, PAYCHECK);
        reentrant.setAllowance(alice, address(split), PAYCHECK);
        _setSingleBucketFor(address(reentrant), aliceSavings, 100e6);

        bytes memory inner = abi.encodeWithSignature(
            "executeSplit(address,address,address,uint256,uint256,uint256,uint256)",
            address(0),
            alice,
            address(reentrant),
            PAYCHECK,
            uint256(1),
            uint256(999),
            uint256(0)
        );
        bytes memory deliverCall =
            abi.encodeWithSignature("deliver(address,address,bytes)", address(split), address(reactive), inner);
        reentrant.arm(address(proxy), deliverCall);

        assertTrue(_deliverFor(address(reentrant), 7));
        assertTrue(reentrant.reentryBlocked());
        assertEq(reentrant.balanceOf(alice), PAYCHECK - 100e6);
        assertEq(reentrant.balanceOf(aliceSavings), 100e6);
    }

    function test_guardrailsOnlyMatchingTransferCanSpend() public {
        _armAlice();
        reactive.setMinPaycheck(100e6);
        uint256 available = reactive.remaining();

        _react(_transferLog(employer, bob, PAYCHECK, 501, 0));
        _react(_transferLog(employer, alice, 99e6, 502, 0));
        IReactive.LogRecord memory income = _transferLog(employer, alice, PAYCHECK, 503, 0);
        IReactive.LogRecord memory otherToken = income;
        otherToken.contractAddress = address(0xbad);
        _react(otherToken);
        income.contractAddress = address(token);
        bytes memory valid = income.data;
        income.data = bytes.concat(valid, hex"00");
        _react(income);
        assertEq(system.requestCount(), 0);
        assertEq(reactive.remaining(), available);
        assertEq(token.balanceOf(aliceRent), 0);

        income.data = valid;
        _react(income);
        assertEq(system.requestCount(), 1);
        assertTrue(_deliverLast());
        assertEq(token.balanceOf(aliceRent), 300e6);
        assertEq(token.balanceOf(aliceTax), 250e6);
        assertEq(token.balanceOf(aliceSavings), 150e6);
    }

    function test_guardrailsReplayPerRunAndTotalCapAcrossDays() public {
        _armAlice();
        _policy(0, 400e6, 800e6, 0, 0, false);
        vm.prank(alice);
        split.setTotalBudget(address(token), true, 900e6);
        vm.prank(bob);
        split.setTotalBudget(address(token), false, 0);

        IReactive.LogRecord memory income = _transferLog(employer, alice, PAYCHECK, 601, 0);
        _react(income);
        assertTrue(_deliverLast());
        uint256 beforeReplay = token.balanceOf(alice);
        _react(income);
        assertEq(system.requestCount(), 1);
        assertTrue(_deliverLast());
        assertEq(token.balanceOf(alice), beforeReplay);
        uint256 remaining = split.totalBudgetPlusOne(alice, address(token)) - 1;
        assertEq(remaining, 500e6);

        _react(_transferLog(employer, alice, PAYCHECK, 601, 1));
        assertEq(system.requestCount(), 2);
        assertTrue(_deliverLast());
        remaining = split.totalBudgetPlusOne(alice, address(token)) - 1;
        assertEq(remaining, 100e6);
        vm.warp((block.timestamp / 1 days + 1) * 1 days);

        (, uint256 retained,) = split.previewExecution(alice, address(token), PAYCHECK);
        assertEq(retained, PAYCHECK - 100e6);
        vm.prank(alice);
        split.recoverSplit(address(token), PAYCHECK, 602, 0);
        remaining = split.totalBudgetPlusOne(alice, address(token)) - 1;
        assertEq(remaining, 0);
        uint256 atCap = token.balanceOf(alice);
        _manual();
        _react(_transferLog(employer, alice, PAYCHECK, 603, 0));
        assertTrue(_deliverLast());
        assertEq(token.balanceOf(alice), atCap + PAYCHECK);
        assertEq(token.balanceOf(aliceRent), 700e6);
        assertEq(token.balanceOf(aliceTax), 200e6);
        assertEq(token.balanceOf(aliceSavings), 0);
    }
}
