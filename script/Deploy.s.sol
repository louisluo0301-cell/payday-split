// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IPayable } from "@reactive/src/interfaces/IPayable.sol";
import { PaydaySplit } from "../src/PaydaySplit.sol";
import { PaydaySplitReactive } from "../src/PaydaySplitReactive.sol";
import { DemoUSDC } from "../src/DemoUSDC.sol";

/// @notice Step 1 (destination chain): deploy DemoUSDC if TOKEN_ADDR is empty, then PaydaySplit.
/// forge script script/Deploy.s.sol:DeployDest --rpc-url $SEPOLIA_RPC_URL --broadcast --non-interactive
contract DeployDest is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address proxy = vm.envAddress("CALLBACK_PROXY");
        address token = vm.envOr("TOKEN_ADDR", address(0));

        vm.startBroadcast(pk);
        if (token == address(0)) {
            token = address(new DemoUSDC(deployer));
        }
        PaydaySplit split = new PaydaySplit(IPayable(payable(proxy)), deployer);
        vm.stopBroadcast();

        console.log("TOKEN_ADDR=", token);
        console.log("SPLIT_ADDR=", address(split));
        console.log("DEST_CHAIN_ID=", block.chainid);
    }
}

/// @notice Step 2 (Lasna): deploy the Reactive contract and subscribe to RuleSet.
/// forge script script/Deploy.s.sol:DeployReactive --rpc-url $LASNA_RPC_URL --broadcast --non-interactive
contract DeployReactive is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint256 chainId = vm.envUint("DEST_CHAIN_ID");
        address split = vm.envAddress("SPLIT_ADDR");
        uint256 limit = vm.envOr("MAX_CALLBACKS", uint256(100));
        uint256 fund = vm.envOr("REACTIVE_FUND_WEI", uint256(0.5 ether));
        uint256 minPaycheck = vm.envOr("MIN_PAYCHECK", uint256(1e6));

        vm.startBroadcast(pk);
        PaydaySplitReactive reactive = new PaydaySplitReactive{ value: fund }(chainId, split, chainId, split, limit);
        reactive.setMinPaycheck(minPaycheck);
        vm.stopBroadcast();

        console.log("REACTIVE_ADDR=", address(reactive));
        console.log("MAX_CALLBACKS=", limit);
        console.log("MIN_PAYCHECK=", minPaycheck);
    }
}

/// @notice Step 3 (destination chain): bind Reactive, create a demo waterfall, approve, and fund callbacks.
/// forge script script/Deploy.s.sol:Configure --rpc-url $SEPOLIA_RPC_URL --broadcast --non-interactive
contract Configure is Script {
    using SafeERC20 for IERC20;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address splitAddr = vm.envAddress("SPLIT_ADDR");
        address reactive = vm.envAddress("REACTIVE_ADDR");
        address token = vm.envAddress("TOKEN_ADDR");
        address rentPayee = vm.envOr("RENT_PAYEE", address(0x000000000000000000000000000000000000dEaD));
        address taxPayee = vm.envOr("TAX_PAYEE", address(0x000000000000000000000000000000000000bEEF));
        address savingsPayee = vm.envOr("SAVINGS_PAYEE", address(0));
        if (savingsPayee == address(0)) {
            savingsPayee = vm.envOr("SAVINGS_ADDR", address(0x000000000000000000000000000000000000cafE));
        }
        uint256 rentRaw = vm.envOr("RENT_FIXED", uint256(300e6));
        uint256 taxRaw = vm.envOr("TAX_BPS", uint256(2_500));
        uint256 savingsRaw = vm.envOr("SAVINGS_BPS", uint256(1_500));
        require(
            rentRaw <= type(uint96).max && taxRaw <= 10_000 && savingsRaw <= 10_000 && taxRaw + savingsRaw <= 10_000,
            "invalid demo allocation"
        );
        uint96 rentFixed = uint96(rentRaw);
        uint16 taxBps = uint16(taxRaw);
        uint16 savingsBps = uint16(savingsRaw);
        uint256 approvalAmount = vm.envOr("APPROVAL_AMOUNT", uint256(1_000e6));
        uint256 callbackFund = vm.envOr("CALLBACK_FUND_WEI", uint256(0.02 ether));

        require(rentPayee != deployer && taxPayee != deployer && savingsPayee != deployer, "payee is deployer");
        require(rentPayee != address(0) && taxPayee != address(0) && savingsPayee != address(0), "payee is zero");

        PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](3);
        buckets[0] = PaydaySplit.Bucket({ payee: rentPayee, fixedAmount: rentFixed, bps: 0, active: true });
        buckets[1] = PaydaySplit.Bucket({ payee: taxPayee, fixedAmount: 0, bps: taxBps, active: true });
        buckets[2] = PaydaySplit.Bucket({ payee: savingsPayee, fixedAmount: 0, bps: savingsBps, active: true });

        PaydaySplit split = PaydaySplit(payable(splitAddr));

        vm.startBroadcast(pk);
        split.setReactive(reactive);
        split.setBuckets(token, buckets);
        IERC20(token).forceApprove(splitAddr, approvalAmount);
        if (callbackFund > 0) {
            (bool ok,) = splitAddr.call{ value: callbackFund }("");
            require(ok, "callback funding failed");
        }
        vm.stopBroadcast();

        console.log("Waterfall set for", deployer);
        console.log("rent payee", rentPayee);
        console.log("tax payee", taxPayee);
        console.log("savings payee", savingsPayee);
        console.log("rent fixed", rentFixed);
        console.log("tax bps", taxBps);
        console.log("savings bps", savingsBps);
    }
}

/// @notice Step 4 (destination chain): emit a real ERC-20 Transfer to the deployer.
///         Works with DemoUSDC's faucet; with a real token, send yourself a transfer from another wallet.
/// forge script script/Deploy.s.sol:SimulatePaycheck --rpc-url $SEPOLIA_RPC_URL --broadcast --non-interactive
contract SimulatePaycheck is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address token = vm.envAddress("TOKEN_ADDR");

        vm.startBroadcast(pk);
        try DemoUSDC(token).faucet() {
            console.log("DemoUSDC faucet claimed");
        } catch {
            console.log("Faucet unavailable (real token?). Send a transfer from a second wallet instead.");
        }
        vm.stopBroadcast();
    }
}

/// @notice Optional: top up the Reactive callback budget and pay debt.
/// forge script script/Deploy.s.sol:TopUpReactive --rpc-url $LASNA_RPC_URL --broadcast --non-interactive
contract TopUpReactive is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        PaydaySplitReactive reactive = PaydaySplitReactive(payable(vm.envAddress("REACTIVE_ADDR")));
        uint256 limit = vm.envOr("MAX_CALLBACKS", uint256(100));
        uint256 fund = vm.envOr("REACTIVE_FUND_WEI", uint256(0));

        vm.startBroadcast(pk);
        if (fund > 0) {
            reactive.topUp{ value: fund }(limit);
        } else {
            reactive.topUp(limit);
        }
        reactive.coverDebt();
        vm.stopBroadcast();

        console.log("Reactive budget added", limit);
    }
}
