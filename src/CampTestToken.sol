// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Valueless six-decimal test token deployed solely on Sepolia for a transfer subscription.
contract CampTestToken is ERC20 {
    constructor() ERC20("Reactive Camp Test", "RCT") {
        _mint(msg.sender, 1_000_000e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
