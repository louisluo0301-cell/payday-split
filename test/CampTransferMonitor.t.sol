// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Test } from "forge-std/Test.sol";
import { IReactive } from "@reactive/src/interfaces/IReactive.sol";
import { CampTransferMonitor } from "../src/CampTransferMonitor.sol";
import { CampTestToken } from "../src/CampTestToken.sol";

contract CampMockSystem {
    uint256 public subscriptions;
    uint256 public unsubscriptions;
    uint256 public lastChain;
    address public lastToken;
    uint256 public lastTopic;
    uint256 public lastTopic1;

    function subscribe(uint256 chain, address token, uint256 topic, uint256 topic1, uint256, uint256) external {
        subscriptions++;
        lastChain = chain;
        lastToken = token;
        lastTopic = topic;
        lastTopic1 = topic1;
    }

    function unsubscribe(uint256 chain, address token, uint256 topic, uint256, uint256, uint256) external {
        require(chain == lastChain && token == lastToken && topic == lastTopic);
        unsubscriptions++;
    }

    function debt(address) external pure returns (uint256) {
        return 0;
    }
}

contract CampTransferMonitorTest is Test {
    address constant SYSTEM = 0x8888888888888888888888888888888888888888;
    address constant TOKEN = address(0x1234);
    CampMockSystem system;
    CampTransferMonitor monitor;

    function setUp() public {
        CampMockSystem implementation = new CampMockSystem();
        vm.etch(SYSTEM, address(implementation).code);
        system = CampMockSystem(SYSTEM);
        monitor = new CampTransferMonitor(TOKEN, 500_000, 1);
    }

    function record(uint256 amount) internal view returns (IReactive.LogRecord memory log_) {
        log_.chainId = 11155111;
        log_.contractAddress = TOKEN;
        log_.topic0 = monitor.TRANSFER_TOPIC_0();
        log_.topic1 = uint256(uint160(address(this)));
        log_.topic2 = uint256(uint160(address(0xbeef)));
        log_.opCode = 3;
        log_.data = abi.encode(amount);
        log_.txHash = 0xabc;
        log_.logIndex = 7;
        log_.blockNumber = 123;
    }

    function deliver(IReactive.LogRecord memory log_) internal {
        vm.prank(SYSTEM);
        monitor.react(log_);
    }

    function test_constructorSubscribesToOneSepoliaToken() public view {
        assertEq(system.subscriptions(), 1);
        assertEq(system.lastChain(), 11155111);
        assertEq(system.lastToken(), TOKEN);
        assertEq(system.lastTopic(), monitor.TRANSFER_TOPIC_0());
        assertEq(system.lastTopic1(), 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad);
        assertTrue(monitor.subscribed());
    }

    function test_validTransferRecordsAndUnsubscribesExactlyOnce() public {
        deliver(record(1e6));
        assertEq(monitor.count(), 1);
        assertEq(monitor.totalVolume(), 1e6);
        assertEq(monitor.remaining(), 0);
        assertEq(monitor.lastOriginTxHash(), 0xabc);
        assertEq(monitor.lastOriginLogIndex(), 7);
        assertEq(monitor.lastOriginBlock(), 123);
        assertEq(monitor.lastReactBlock(), block.number);
        assertFalse(monitor.subscribed());
        deliver(record(1e6));
        monitor.stop();
        assertEq(system.unsubscriptions(), 1);
        assertEq(monitor.count(), 1);
    }

    function test_onlySystemMaySubmitLogs() public {
        IReactive.LogRecord memory log_ = record(1e6);
        vm.expectRevert();
        monitor.react(log_);
        assertEq(monitor.count(), 0);
    }

    function test_thresholdIsStrictAndDoesNotConsumeCount() public {
        deliver(record(0));
        deliver(record(499_999));
        deliver(record(500_000));
        assertEq(monitor.count(), 0);
        assertEq(monitor.remaining(), 1);
        assertEq(system.unsubscriptions(), 0);
        deliver(record(500_001));
        assertEq(monitor.count(), 1);
    }

    function test_wrongChainContractTopicOpcodeAndMalformedDataReturn() public {
        IReactive.LogRecord memory log_ = record(1e6);
        log_.chainId = 1;
        deliver(log_);
        log_ = record(1e6);
        log_.contractAddress = address(9);
        deliver(log_);
        log_ = record(1e6);
        log_.topic0 = 0;
        deliver(log_);
        log_ = record(1e6);
        log_.opCode = 4;
        deliver(log_);
        log_ = record(1e6);
        log_.data = hex"ff";
        deliver(log_);
        log_.data = abi.encode(uint256(1e6), uint256(2));
        deliver(log_);
        assertEq(monitor.count(), 0);
        assertEq(monitor.remaining(), 1);
    }

    function test_duplicateDeliveryDoesNotConsumeSecondSlot() public {
        monitor = new CampTransferMonitor(TOKEN, 500_000, 2);
        IReactive.LogRecord memory log_ = record(1e6);
        deliver(log_);
        deliver(log_);
        assertEq(monitor.count(), 1);
        assertEq(monitor.remaining(), 1);
        log_.logIndex++;
        deliver(log_);
        assertEq(monitor.count(), 2);
        assertEq(monitor.remaining(), 0);
    }

    function test_ownerCanStopEarly() public {
        monitor.stop();
        deliver(record(1e6));
        assertEq(monitor.count(), 0);
        assertEq(monitor.remaining(), 0);
        assertEq(system.unsubscriptions(), 1);
    }

    function test_nonOwnerCannotStopOrCoverDebt() public {
        vm.startPrank(address(0xbad));
        vm.expectRevert(CampTransferMonitor.NotOwner.selector);
        monitor.stop();
        vm.expectRevert(CampTransferMonitor.NotOwner.selector);
        monitor.coverDebt();
        vm.stopPrank();
    }

    function test_invalidConstructorArgumentsRevert() public {
        vm.expectRevert(CampTransferMonitor.InvalidConfiguration.selector);
        new CampTransferMonitor(address(0), 0, 1);
        vm.expectRevert(CampTransferMonitor.InvalidConfiguration.selector);
        new CampTransferMonitor(TOKEN, 0, 0);
        vm.expectRevert(CampTransferMonitor.InvalidConfiguration.selector);
        new CampTransferMonitor(TOKEN, 0, 11);
    }

    function test_payableDeploymentAndDebtSettlement() public {
        vm.deal(address(this), 1 ether);
        monitor = new CampTransferMonitor{ value: 0.1 ether }(TOKEN, 0, 1);
        assertEq(address(monitor).balance, 0.1 ether);
        monitor.coverDebt{ value: 0.01 ether }();
        assertEq(address(monitor).balance, 0.11 ether);
    }

    function test_tokenHasSixDecimalsAndSelfTransferEmitsIncome() public {
        CampTestToken token = new CampTestToken();
        assertEq(token.decimals(), 6);
        uint256 balance = token.balanceOf(address(this));
        vm.recordLogs();
        token.transfer(address(this), 1e6);
        assertEq(token.balanceOf(address(this)), balance);
        assertEq(vm.getRecordedLogs().length, 1);
    }
}
