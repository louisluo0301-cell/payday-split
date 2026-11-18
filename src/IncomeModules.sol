// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWrappedEther is IERC20 {
    function deposit() external payable;
}

interface IAaveIncomePool {
    function getReserveAToken(address asset) external view returns (address);
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
}

error InvalidModuleConfiguration();
error BeneficiaryRequired();
error NoFunds();

abstract contract IncomeModule is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    address public immutable beneficiary;

    constructor(IERC20 asset_, address beneficiary_) {
        if (address(asset_).code.length == 0 || beneficiary_ == address(0) || beneficiary_ == address(this)) {
            revert InvalidModuleConfiguration();
        }
        asset = asset_;
        beneficiary = beneficiary_;
    }

    modifier onlyBeneficiary() {
        if (msg.sender != beneficiary) revert BeneficiaryRequired();
        _;
    }
}

/// @notice Converts native ETH into a regular ERC-20 Transfer to the wallet with a WETH rule.
contract NativeIncomeReceiver is IncomeModule {
    using SafeERC20 for IERC20;
    event NativeIncome(address indexed payer, address indexed beneficiary, uint256 wrapped, uint256 forwarded);

    constructor(IWrappedEther asset_, address beneficiary_) IncomeModule(asset_, beneficiary_) { }

    receive() external payable nonReentrant {
        _forward();
    }

    /// @notice Flush forced ETH or WETH already at the receiver. Only the immutable wallet receives it.
    function flush() external nonReentrant {
        _forward();
    }

    function _forward() private {
        uint256 amount = address(this).balance;
        if (amount != 0) IWrappedEther(address(asset)).deposit{ value: amount }();
        uint256 forwarded = asset.balanceOf(address(this));
        if (forwarded == 0) revert NoFunds();
        asset.safeTransfer(beneficiary, forwarded);
        emit NativeIncome(msg.sender, beneficiary, amount, forwarded);
    }
}

/// @notice Supplies a waterfall allocation into an Aave V3 reserve, sending aTokens to the beneficiary.
contract AaveSavingsBucket is IncomeModule {
    using SafeERC20 for IERC20;

    IAaveIncomePool public immutable pool;
    IERC20 public immutable aToken;
    address public immutable depositor;
    event Supplied(uint256 assets, uint256 aTokensReceived);
    error SplitRequired();
    error UnexpectedSupplyResult();

    constructor(IERC20 asset_, address beneficiary_, IAaveIncomePool pool_, address depositor_)
        IncomeModule(asset_, beneficiary_)
    {
        if (address(pool_).code.length == 0 || depositor_.code.length == 0) revert InvalidModuleConfiguration();
        address reserve = pool_.getReserveAToken(address(asset_));
        if (reserve.code.length == 0 || reserve == address(asset_)) revert InvalidModuleConfiguration();
        pool = pool_;
        aToken = IERC20(reserve);
        depositor = depositor_;
    }

    function invest(uint256 amount) external nonReentrant {
        if (msg.sender != depositor) revert SplitRequired();
        uint256 assetsBefore = asset.balanceOf(address(this));
        if (amount == 0 || assetsBefore < amount) revert NoFunds();
        uint256 balanceBefore = aToken.balanceOf(beneficiary);
        asset.forceApprove(address(pool), amount);
        pool.supply(address(asset), amount, beneficiary, 0);
        asset.forceApprove(address(pool), 0);
        uint256 received = aToken.balanceOf(beneficiary) - balanceBefore;
        // The indexed aToken balance rounds at wei precision.
        if (received == 0 || received < amount - 1 || asset.balanceOf(address(this)) != assetsBefore - amount) {
            revert UnexpectedSupplyResult();
        }
        emit Supplied(amount, received);
    }

    /// @notice Return underlying accidentally transferred directly to the module.
    function withdrawIdle() external onlyBeneficiary nonReentrant {
        uint256 amount = asset.balanceOf(address(this));
        if (amount == 0) revert NoFunds();
        asset.safeTransfer(beneficiary, amount);
    }
}

/// @notice A dedicated bucket with a waiting period for each withdrawal request.
contract CooldownBucket is IncomeModule {
    using SafeERC20 for IERC20;
    uint256 public immutable delay;
    uint256 public pendingAmount;
    uint256 public releaseAt;
    event WithdrawalRequested(uint256 amount, uint256 availableAt);
    event WithdrawalCancelled(uint256 amount);
    event WithdrawalReleased(uint256 amount);
    error WithdrawalPending();
    error CoolingDown();

    constructor(IERC20 asset_, address beneficiary_, uint256 delay_) IncomeModule(asset_, beneficiary_) {
        if (delay_ < 1 hours || delay_ > 30 days) revert InvalidModuleConfiguration();
        delay = delay_;
    }

    function requestWithdrawal(uint256 amount) external onlyBeneficiary nonReentrant {
        if (pendingAmount != 0) revert WithdrawalPending();
        if (amount == 0 || amount > asset.balanceOf(address(this))) revert NoFunds();
        pendingAmount = amount;
        releaseAt = block.timestamp + delay;
        emit WithdrawalRequested(amount, releaseAt);
    }

    function cancelWithdrawal() external onlyBeneficiary nonReentrant {
        uint256 amount = pendingAmount;
        if (amount == 0) revert NoFunds();
        delete pendingAmount;
        delete releaseAt;
        emit WithdrawalCancelled(amount);
    }

    function releaseWithdrawal() external onlyBeneficiary nonReentrant {
        uint256 amount = pendingAmount;
        if (amount == 0) revert NoFunds();
        if (block.timestamp < releaseAt) revert CoolingDown();
        delete pendingAmount;
        delete releaseAt;
        asset.safeTransfer(beneficiary, amount);
        emit WithdrawalReleased(amount);
    }
}

contract IncomeModuleFactory {
    address public immutable split;
    enum Kind {
        Native,
        Aave,
        Cooldown
    }
    mapping(address => mapping(address => mapping(Kind => address))) public latest;
    event ModuleCreated(address indexed beneficiary, address indexed asset, address indexed module, Kind kind);

    constructor(address split_) {
        if (split_.code.length == 0) revert InvalidModuleConfiguration();
        split = split_;
    }

    function createNative(IWrappedEther wrapped) external returns (address module) {
        module = address(new NativeIncomeReceiver(wrapped, msg.sender));
        _record(address(wrapped), module, Kind.Native);
    }

    function createAave(IERC20 asset, IAaveIncomePool pool) external returns (address module) {
        module = address(new AaveSavingsBucket(asset, msg.sender, pool, split));
        _record(address(asset), module, Kind.Aave);
    }

    function createCooldown(IERC20 asset, uint256 delay) external returns (address module) {
        module = address(new CooldownBucket(asset, msg.sender, delay));
        _record(address(asset), module, Kind.Cooldown);
    }

    function _record(address asset, address module, Kind kind) private {
        latest[msg.sender][asset][kind] = module;
        emit ModuleCreated(msg.sender, asset, module, kind);
    }
}
