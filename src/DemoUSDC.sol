// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title DemoUSDC
/// @notice Six-decimal test stablecoin used by the demo. It is intentionally labeled Demo USD Coin.
///         `faucet()` mints a paycheck-sized amount to the caller, which emits a real ERC-20 Transfer
///         and therefore exercises the exact same Reactive path as a real employer payment.
contract DemoUSDC is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 1_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastFaucetAt;

    event Faucet(address indexed to, uint256 amount);

    constructor(address owner_) ERC20("Demo USD Coin", "dUSDC") Ownable(owner_) { }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint a paycheck-sized amount. One claim per address per cooldown.
    function faucet() external {
        // Testnet-only faucet; timestamp manipulation only affects the demo cooldown.
        // forge-lint: disable-next-line(block-timestamp)
        require(block.timestamp >= lastFaucetAt[msg.sender] + FAUCET_COOLDOWN, "faucet: cooldown");
        // forge-lint: disable-next-line(missing-events-access-control)
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Faucet(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Owner mint for demos and tests (e.g. funding an employer account).
    function mint(address to_, uint256 amount_) external onlyOwner {
        _mint(to_, amount_);
    }
}
