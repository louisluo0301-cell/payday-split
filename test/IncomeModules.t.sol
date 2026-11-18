// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { PaydaySplit } from "../src/PaydaySplit.sol";
import { PaydaySplitReactive } from "../src/PaydaySplitReactive.sol";
import { PaydayRetryQueue } from "../src/PaydayRetryQueue.sol";
import { DemoUSDC } from "../src/DemoUSDC.sol";
import {
    AaveSavingsBucket,
    CooldownBucket,
    IncomeModuleFactory,
    IAaveIncomePool,
    IWrappedEther,
    NativeIncomeReceiver
} from "../src/IncomeModules.sol";
import { MockProxy, MockSystem } from "./PaydaySplit.t.sol";

contract WrappedEtherForModules is ERC20 {
    constructor() ERC20("Local wrapped ETH", "WETH") { }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }
}

contract ATokenForModules is ERC20 {
    address immutable pool = msg.sender;
    constructor() ERC20("Local aUSDC", "aUSDC") { }

    function mint(address user, uint256 amount) external {
        require(msg.sender == pool);
        _mint(user, amount);
    }
}

contract AavePoolForModules is IAaveIncomePool {
    IERC20 public immutable asset;
    ATokenForModules public immutable receipt;
    bool public unavailable;

    constructor(IERC20 asset_) {
        asset = asset_;
        receipt = new ATokenForModules();
    }

    function getReserveAToken(address asset_) external view returns (address) {
        return asset_ == address(asset) ? address(receipt) : address(0);
    }

    function setUnavailable(bool value) external {
        unavailable = value;
    }

    function supply(address asset_, uint256 amount, address onBehalfOf, uint16) external {
        require(!unavailable && asset_ == address(asset));
        require(asset.transferFrom(msg.sender, address(this), amount));
        receipt.mint(onBehalfOf, amount);
    }

    function addTestYield(address user, uint256 amount) external {
        receipt.mint(user, amount);
    }
}

contract IncomeModulesTest is Test {
    address constant SYSTEM = 0x8888888888888888888888888888888888888888;
    address constant ALICE = address(0xa11ce);
    address constant FIRST = address(0x1ee7);
    address constant SECOND = address(0xbeef);
    MockSystem system;
    MockProxy proxy;
    PaydaySplit split;
    PaydaySplitReactive reactive;
    PaydayRetryQueue queue;
    DemoUSDC token;
    IncomeModuleFactory factory;

    function setUp() public {
        vm.warp(10 days + 4 hours);
        vm.etch(SYSTEM, address(new MockSystem()).code);
        system = MockSystem(payable(SYSTEM));
        proxy = new MockProxy();
        token = new DemoUSDC(address(this));
        split = new PaydaySplit(IPayable(payable(address(proxy))), address(this));
        reactive = new PaydaySplitReactive(block.chainid, address(split), block.chainid, address(split), 100);
        split.setReactive(address(reactive));
        queue = split.retryQueue();
        factory = new IncomeModuleFactory(address(split));
    }

    function _rules(address first, uint96 fixedFirst, address second, uint96 fixedSecond) private {
        PaydaySplit.Bucket[] memory list = new PaydaySplit.Bucket[](2);
        list[0] = PaydaySplit.Bucket(first, fixedFirst, 0, true);
        list[1] = PaydaySplit.Bucket(second, fixedSecond, 0, true);
        vm.prank(ALICE);
        split.setBuckets(address(token), list);
    }

    function _approve(uint256 amount) private {
        vm.prank(ALICE);
        token.approve(address(split), amount);
    }

    function _income(uint256 hash) private {
        token.mint(ALICE, 1000e6);
        uint256 version = split.ruleVersion(ALICE, address(token));
        vm.prank(address(proxy));
        split.executeSplit(address(reactive), ALICE, address(token), 1000e6, version, hash, 2);
    }

    function _queueFailedBucket() private {
        _rules(FIRST, 700e6, SECOND, 600e6);
        vm.prank(ALICE);
        split.setRetryEnabled(address(token), true);
        _approve(600e6);
        _income(77);
        assertEq(queue.retryPending(ALICE, address(token)), 1);
        assertEq(queue.retryJob(1).amount, 400e6);
        assertEq(token.balanceOf(SECOND), 600e6);
    }

    function test_liveCronRequestPaysOnlyTheOriginalUnspentBudget() public {
        _queueFailedBucket();
        _approve(400e6);
        split.processRetries();
        assertEq(token.balanceOf(FIRST), 0);
        reactive.setRetrySchedule(1);
        vm.warp(block.timestamp + 15 minutes);
        IReactive.LogRecord memory log;
        log.chainId = block.chainid;
        log.contractAddress = FIRST;
        log.topic0 = reactive.CRON1000_TOPIC();
        log.data = abi.encode(uint256(1_000));
        log.blockNumber = 1_000;
        log.opCode = 1;
        vm.prank(SYSTEM);
        reactive.react(log);
        assertEq(system.requestCount(), 0);
        log.contractAddress = reactive.CRON_SOURCE();
        vm.prank(SYSTEM);
        reactive.react(log);
        vm.prank(SYSTEM);
        reactive.react(log);
        assertEq(system.requestCount(), 1);
        assertEq(reactive.remainingRetryCalls(), 0);
        (,,, bytes memory payload) = system.requests(0);
        (bool ok,) = proxy.deliver(address(split), address(reactive), payload);
        assertTrue(ok);
        assertEq(token.balanceOf(FIRST), 400e6);
        assertEq(token.balanceOf(SECOND), 600e6);
        assertEq(queue.retryPending(ALICE, address(token)), 0);
        (ok,) = proxy.deliver(address(split), address(reactive), payload);
        assertTrue(ok);
        assertEq(token.balanceOf(FIRST), 400e6);
        (, uint256 spent) = split.dailySpend(ALICE, address(token));
        assertEq(spent, 1000e6);
    }

    function test_retryCannotPayAfterRulesChangeOrAfterMidnight() public {
        _queueFailedBucket();
        _approve(1000e6);
        _rules(FIRST, 701e6, SECOND, 600e6);
        vm.warp(block.timestamp + 15 minutes);
        split.processRetries();
        assertEq(token.balanceOf(FIRST), 0);
        assertEq(queue.retryJob(1).amount, 0);
        _approve(600e6);
        _income(78);
        assertEq(queue.retryPending(ALICE, address(token)), 1);
        _approve(1000e6);
        vm.warp(11 days);
        split.processRetries();
        assertEq(token.balanceOf(FIRST), 0);
        assertEq(queue.retryPending(ALICE, address(token)), 0);
    }

    function test_retryStopsAtThreeAttemptsAndOwnerCanCancel() public {
        _queueFailedBucket();
        vm.expectRevert(PaydayRetryQueue.RetryOwnerRequired.selector);
        split.cancelRetry(1);
        for (uint256 i; i < 3; i++) {
            vm.warp(queue.retryJob(1).due);
            split.processRetries();
        }
        assertEq(queue.retryPending(ALICE, address(token)), 0);
        _approve(600e6);
        _income(99);
        vm.prank(ALICE);
        split.cancelRetry(2);
        assertEq(queue.retryPending(ALICE, address(token)), 0);
        _approve(1000e6);
        vm.warp(block.timestamp + 15 minutes);
        split.processRetries();
        assertEq(token.balanceOf(FIRST), 0);
    }

    function test_aavePayoutAutomaticallySuppliesAndSendsPositionToWallet() public {
        AavePoolForModules pool = new AavePoolForModules(token);
        vm.prank(ALICE);
        address bucket = factory.createAave(token, pool);
        _rules(bucket, 300e6, SECOND, 200e6);
        vm.prank(ALICE);
        split.setSavingsBucket(address(token), bucket);
        _approve(1000e6);
        _income(88);
        assertEq(token.balanceOf(bucket), 0);
        assertEq(token.balanceOf(address(pool)), 300e6);
        assertEq(token.allowance(bucket, address(pool)), 0);
        assertEq(pool.receipt().balanceOf(ALICE), 300e6);
        assertEq(token.balanceOf(SECOND), 200e6);
        pool.addTestYield(ALICE, 5e6);
        assertEq(pool.receipt().balanceOf(ALICE), 305e6);
    }

    function test_aaveFailureIsAtomicThenRetrySuppliesWithoutReplayingTheOtherBucket() public {
        AavePoolForModules pool = new AavePoolForModules(token);
        pool.setUnavailable(true);
        vm.prank(ALICE);
        address bucket = factory.createAave(token, pool);
        _rules(bucket, 300e6, SECOND, 200e6);
        vm.startPrank(ALICE);
        split.setSavingsBucket(address(token), bucket);
        split.setRetryEnabled(address(token), true);
        vm.stopPrank();
        _approve(1000e6);
        _income(88);
        assertEq(token.balanceOf(bucket), 0);
        assertEq(token.balanceOf(ALICE), 800e6);
        assertEq(token.balanceOf(SECOND), 200e6);
        assertEq(queue.retryJob(1).amount, 300e6);
        pool.setUnavailable(false);
        vm.warp(block.timestamp + 15 minutes);
        split.processRetries();
        assertEq(pool.receipt().balanceOf(ALICE), 300e6);
        assertEq(token.balanceOf(SECOND), 200e6);
        assertEq(queue.retryPending(ALICE, address(token)), 0);
    }

    function test_nativeReceiptEmitsWethTransferAndUsesTheSameWaterfall() public {
        WrappedEtherForModules wrapped = new WrappedEtherForModules();
        vm.prank(ALICE);
        address receiver = factory.createNative(IWrappedEther(address(wrapped)));
        PaydaySplit.Bucket[] memory list = new PaydaySplit.Bucket[](1);
        list[0] = PaydaySplit.Bucket(FIRST, 0.4 ether, 0, true);
        vm.startPrank(ALICE);
        vm.recordLogs();
        split.setBuckets(address(wrapped), list);
        Vm.Log[] memory configLogs = vm.getRecordedLogs();
        wrapped.approve(address(split), 1 ether);
        vm.stopPrank();
        _relay(configLogs[0], 77, 0);
        vm.deal(address(this), 1 ether);
        vm.recordLogs();
        (bool ok,) = receiver.call{ value: 1 ether }("");
        Vm.Log[] memory paymentLogs = vm.getRecordedLogs();
        assertTrue(ok);
        assertEq(receiver.balance, 0);
        assertEq(wrapped.balanceOf(ALICE), 1 ether);
        for (uint256 i; i < paymentLogs.length; ++i) {
            _relay(paymentLogs[i], 88, i);
        }
        assertEq(system.requestCount(), 1);
        (,,, bytes memory payload) = system.requests(0);
        (ok,) = proxy.deliver(address(split), address(reactive), payload);
        assertTrue(ok);
        assertEq(wrapped.balanceOf(FIRST), 0.4 ether);
        assertEq(wrapped.balanceOf(ALICE), 0.6 ether);
    }

    function _relay(Vm.Log memory entry, uint256 hash, uint256 index) private {
        uint256 count = entry.topics.length;
        IReactive.LogRecord memory log = IReactive.LogRecord({
            chainId: block.chainid,
            contractAddress: entry.emitter,
            topic0: uint256(entry.topics[0]),
            topic1: count > 1 ? uint256(entry.topics[1]) : 0,
            topic2: count > 2 ? uint256(entry.topics[2]) : 0,
            topic3: count > 3 ? uint256(entry.topics[3]) : 0,
            data: entry.data,
            blockNumber: block.number,
            opCode: count,
            blockHash: 0,
            txHash: hash,
            logIndex: index
        });
        vm.prank(SYSTEM);
        reactive.react(log);
    }

    function testFuzz_queuedAndImmediatePaymentsNeverExceedTheOriginalCap(uint96 a, uint96 b, uint96 allowed) public {
        _rules(FIRST, uint96(bound(a, 1, 1000e6)), SECOND, uint96(bound(b, 1, 1000e6)));
        vm.startPrank(ALICE);
        split.setPolicy(address(token), PaydaySplit.Policy(0, 720e6, 800e6, 0, 0, false));
        split.setRetryEnabled(address(token), true);
        vm.stopPrank();
        _approve(bound(allowed, 0, 1000e6));
        _income(88);
        _approve(1000e6);
        vm.warp(vm.getBlockTimestamp() + 15 minutes);
        split.processRetries();
        assertLe(token.balanceOf(FIRST) + token.balanceOf(SECOND), 720e6);
    }

    function test_cooldownReleasesOnlyAfterDelayAndCancellationCannotReuseOldClock() public {
        vm.prank(ALICE);
        address bucket = factory.createCooldown(token, 24 hours);
        CooldownBucket vault = CooldownBucket(bucket);
        _rules(bucket, 300e6, SECOND, 200e6);
        _approve(1000e6);
        _income(11);
        vm.prank(ALICE);
        vault.requestWithdrawal(100e6);
        vm.warp(vault.releaseAt() - 12 hours);
        vm.startPrank(ALICE);
        vault.cancelWithdrawal();
        vault.requestWithdrawal(100e6);
        uint256 ready = vault.releaseAt();
        vm.warp(ready - 1);
        vm.expectRevert(CooldownBucket.CoolingDown.selector);
        vault.releaseWithdrawal();
        vm.warp(ready);
        vault.releaseWithdrawal();
        vm.stopPrank();
        assertEq(token.balanceOf(bucket), 200e6);
        assertEq(token.balanceOf(ALICE), 600e6);
        assertEq(vault.pendingAmount(), 0);
    }
}
