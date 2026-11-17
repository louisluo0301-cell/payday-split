# Deployment runbook — Reactive Income Waterfall

## 0. Chain choices

| Chain | chainId | Role | Callback Proxy |
|---|---|---|---|
| Ethereum Sepolia | 11155111 | origin + destination | `0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4` |
| Base Sepolia | 84532 | origin + destination | `0x476F44b11F5C942c58f4c8E3d0300E5710743585` |
| Unichain Sepolia | 1301 | origin + destination | `0x775c9B990ADe401060B78D0e98684eEf8d2466C1` |
| Reactive Lasna | 5318007 | Reactive side | `0x8888…8888` (system) |

The same chain is used for the token and the callback. The contracts also carry a separate `DEST_CHAIN_ID`, so a cross-chain token → callback setup only needs config changes.

## 1. Wallet and funds

1. Create a **throwaway** testnet wallet.
2. Get testnet ETH:
   - Sepolia: Google Cloud Sepolia faucet; pk910 PoW faucet as fallback.
   - Base Sepolia: Base/Coinbase/Alchemy faucets.
3. Get lREACT:
   - Sepolia ETH → `0x9b9BB25f1A81078C544C829c5EB7822d747Cf434` (1 ETH → 100 lREACT; 0.01 ETH is enough).
   - Base Sepolia ETH → `0x2afaFD298b23b62760711756088F75B7409f5967`.
   - Verify: `cast balance <your-address> --rpc-url https://lasna-rpc.rnk.dev/ -e`.
4. Keep:
   - `0.02 ETH` on the destination chain for deployment + callback gas;
   - `0.01 ETH` converted to lREACT.

## 2. `.env`

```dotenv
PRIVATE_KEY=0x...
DEST_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
DEST_CHAIN_ID=11155111
CALLBACK_PROXY=0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4
LASNA_RPC_URL=https://lasna-rpc.rnk.dev/

TOKEN_ADDR=                 # empty = deploy DemoUSDC
SPLIT_ADDR=
REACTIVE_ADDR=

# Demo waterfall: rent 300 fixed, tax 25%, savings 15%
RENT_PAYEE=0x000000000000000000000000000000000000dEaD
TAX_PAYEE=0x000000000000000000000000000000000000bEEF
SAVINGS_PAYEE=0x000000000000000000000000000000000000cafE
RENT_FIXED=300000000
TAX_BPS=2500
SAVINGS_BPS=1500

MAX_CALLBACKS=100
MIN_PAYCHECK=1000000
REACTIVE_FUND_WEI=500000000000000000
CALLBACK_FUND_WEI=20000000000000000
```

`SAVINGS_PAYEE` takes precedence over the legacy `SAVINGS_ADDR`. All payees must differ from the deployer.

`MIN_PAYCHECK` is in token base units (1e6 = 1 USDC for a 6-dp token). It blocks dust-transfer spam from consuming callbacks; raise it for production. Each user also starts with a 100-callback `userRemaining` budget; `topUpUser` / `setUserBudget` can adjust it. `TopUpReactive` is **additive** now; use `setCallbackLimit` for an exact budget. `PaydaySplitReactive` uses `Ownable2Step`, so rotate the owner with `transferOwnership` + `acceptOwnership`.

## 3. One-command deploy

```powershell
pwsh ./script/deploy.ps1
```

```bash
bash script/deploy.sh
```

| Step | Script | Chain | What it does |
|---|---|---|---|
| 1 | `DeployDest` | destination | Deploy `DemoUSDC` (unless `TOKEN_ADDR` set) + `PaydaySplit` |
| 2 | `DeployReactive` | Lasna | Deploy `PaydaySplitReactive` with `REACTIVE_FUND_WEI` |
| 3 | `Configure` | destination | `setReactive`, `setBuckets` (3 buckets), `approve`, fund callback ETH |
| 4 | `SimulatePaycheck` | destination | `faucet()` — a real ERC-20 `Transfer` |

Outputs:

- `deployments/<chainId>.json`
- `web/public/deployments.json` (for the frontend)

## 4. Manual deploy

```powershell
forge script script/Deploy.s.sol:DeployDest     --rpc-url $env:SEPOLIA_RPC_URL --broadcast --non-interactive
# copy TOKEN_ADDR / SPLIT_ADDR into .env
forge script script/Deploy.s.sol:DeployReactive --rpc-url $env:LASNA_RPC_URL   --broadcast --non-interactive
# copy REACTIVE_ADDR into .env
forge script script/Deploy.s.sol:Configure      --rpc-url $env:SEPOLIA_RPC_URL --broadcast --non-interactive
forge script script/Deploy.s.sol:SimulatePaycheck --rpc-url $env:SEPOLIA_RPC_URL --broadcast --non-interactive
```

## 5. Verify

```powershell
pwsh ./script/verify.ps1
```

Expected:

- destination: `bucketCount == 3`, `ruleVersion == 1`, `getBuckets` shows rent/tax/savings;
- Lasna: `getRule(user, token)` has 3 payees, version 1, `subscribed=true`;
- destination: three `Split` events and one `Retained` event;
- payee balances: 300 / 250 / 150; user keeps 300.

The three transaction hashes:

1. the paycheck `Transfer` (origin);
2. the Lasna `react()` transaction;
3. the destination callback (`Split`/`Retained`).

## 6. Switching chains

### Base Sepolia

```dotenv
DEST_RPC_URL=https://sepolia.base.org
DEST_CHAIN_ID=84532
CALLBACK_PROXY=0x476F44b11F5C942c58f4c8E3d0300E5710743585
```

Base Sepolia produces 200 ms blocks. The waterfall uses event amounts, not timestamps, so block time does not affect it (only the demo faucet cooldown uses timestamps).

### Unichain Sepolia

```dotenv
DEST_RPC_URL=https://sepolia.unichain.org
DEST_CHAIN_ID=1301
CALLBACK_PROXY=0x775c9B990ADe401060B78D0e98684eEf8d2466C1
```

## 7. Using real USDC

Set `TOKEN_ADDR` before step 1:

- Sepolia USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

When `TOKEN_ADDR` is set, `DeployDest` skips `DemoUSDC`; `SimulatePaycheck` fails (caught) and the frontend hides the faucet. Use a transfer from another wallet.

## 8. Changing the waterfall

Use the UI, or call:

```solidity
PaydaySplit.Bucket[] memory buckets = new PaydaySplit.Bucket[](3);
buckets[0] = PaydaySplit.Bucket(rent, 300e6, 0, true);
buckets[1] = PaydaySplit.Bucket(tax, 0, 2500, true);
buckets[2] = PaydaySplit.Bucket(savings, 0, 1500, true);
split.setBuckets(token, buckets);
```

Each call increments `ruleVersion`; the Reactive contract mirrors the new arrays and version.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `react()` never called | BucketsSet not mirrored / wrong chain | Check `PaydaySplitReactive.getRule`; re-save |
| `react()` called, no callback | `remaining == 0`, paused, no lREACT, or split in debt | `TopUpReactive`; check `debt` |
| `StaleRule` | Rule changed while a paycheck was in flight | Expected; re-trigger or wait |
| `BucketSkipped(SKIP_INSUFFICIENT_BALANCE)` | Allowance/balance below the bucket amount | Approve / fund; next paycheck |
| `BucketSkipped(SKIP_TRANSFER_FAILED)` | Payee blacklisted or token returned false | Change payee |
| Fixed bucket consumes the paycheck | `RENT_FIXED` too high | Lower fixed amounts or reorder |
| `TotalBpsTooHigh` | Active percentages > 100% | Reduce bps |
| `InvalidPayee` | Payee is zero / deployer / split | Use a different address |
| `EmptyBucket` | Active bucket with fixed 0 and bps 0 | Remove it or give it an amount |
| Frontend "Contracts not deployed" | `web/public/deployments.json` empty | Run deploy; refresh |
| Faucet disabled | DemoUSDC cooldown | Wait 1 hour or `mint` as owner |

## 10. Cost reference

| Action | Chain | Approx. |
|---|---|---|
| Deploy `PaydaySplit` | Sepolia | ~1.6M gas |
| Deploy `DemoUSDC` | Sepolia | ~1M gas |
| Deploy `PaydaySplitReactive` | Lasna | ~2.5M gas + 0.5 lREACT prepay |
| `react()` per event | Lasna | ~0.015–0.03 lREACT |
| 3-bucket callback | destination | ~250–350k gas, paid by `PaydaySplit` ETH |
| 8-bucket callback | destination | up to ~700k gas |

Keep at least `0.02 ETH` in `PaydaySplit` for callback fees.
