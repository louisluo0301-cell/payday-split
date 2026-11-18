# Security — Reactive Income Waterfall

The waterfall is designed to be bounded even when a bucket is wrong, a payee is blacklisted, or a callback arrives after the user changed the rule.

## 1. Assets and actors

| Asset | Where | At risk? |
|---|---|---|
| User's stablecoins | User wallet | Only up to the allowance and the active bucket amounts |
| Allowance | Token contract | Revocable at any time |
| Callback gas | `PaydaySplit` ETH balance | Consumed by callbacks; no user principal |
| lREACT budget | `PaydaySplitReactive` balance | Consumed by `react()` |

Actors: user, owner, Reactive contract, Callback Proxy, token, payee, arbitrary attacker.

## 2. Controls

### 2.1 Non-custodial

`PaydaySplit` never holds principal. The only token movement is:

```
user --approve--> PaydaySplit --transferFrom--> bucket payee
```

There is no function that moves user tokens to the owner or an arbitrary address.

### 2.2 Bounded rule

`setBuckets` enforces:

- at most **8** buckets;
- each active bucket has a payee that is not zero, the user, or the contract;
- `bps <= 10_000` per bucket;
- sum of active `bps <= 10_000` (100%);
- each active bucket has `fixedAmount > 0 || bps > 0`;
- `ruleVersion` increments on every change.

At execution, each bucket is additionally capped by `remaining` (the paycheck left after higher-priority buckets). A fixed rent of 800 on a 500 paycheck pays 500, and later buckets get 0.

### 2.3 Two callback checks

```solidity
modifier onlyServiceProvider() { if (msg.sender != address(_SERVICE_PROVIDER)) revert; }
modifier onlyReactive(address reactive_) {
    if (reactive == address(0) || reactive_ != reactive) revert;
}
```

- Proxy address is immutable.
- Reactive address is one-time bound by the owner.
- The first payload argument is `address(0)` and the proxy replaces it with the Reactive address.

### 2.4 Versioning

Every callback carries the rule version. If it does not match `ruleVersion[user][token]`, the callback emits `StaleRule` and moves nothing. This prevents an in-flight paycheck from being routed through a newly edited waterfall.

### 2.5 Replay protection

`keccak256(user, token, originTxHash, logIndex)` is marked before any transfer. A duplicated callback is a no-op. One origin event can only produce one waterfall.

### 2.6 Per-bucket failure isolation

A failed bucket (allowance, balance, blacklisted payee, non-standard token return) emits `BucketSkipped` and does **not** revert the whole callback. The remaining buckets still run, and the unspent amount remains in `remaining` for later buckets.

`_tryTransferFrom` uses a self-call with SafeERC20. Failed transfers roll back token state in that child call. It accepts:

- `true` return (standard ERC-20);
- empty return (USDT-style);
- returns `false` on revert / `false`.

`executeSplit` is `nonReentrant`, so a malicious token cannot re-enter.

### 2.7 Reentrancy and ordering

- `executeSplit` is `nonReentrant`.
- `processed[key]` is written before the first external call.
- Buckets are read into memory one at a time.
- `setBuckets` has no external calls.
- `rescueERC20` / `rescueETH` are owner-only and cannot touch user principal.

### 2.8 Pause and revoke

- User: `disableAll(token)` or set every bucket inactive; Reactive unsubscribes.
- User: revoke the ERC-20 allowance; each bucket emits `BucketSkipped(SKIP_INSUFFICIENT_BALANCE)`.
- Owner: `pause()` on `PaydaySplit`, `setPaused(true)` on the Reactive contract.
- Owner: `topUp()` / `coverDebt()` keep the Reactive contract funded.

### 2.9 Liveness hardening (2026-11 review)

- **`minPaycheck`** (owner-set, e.g. `1e6` for 6-dp USDC): transfers below the floor are ignored. Without it, a permissionless attacker can emit many dust `Transfer`s to a subscribed user and consume the global callback budget/fuel.
- **Per-user budget** (`userRemaining[user][token]`, default `100`, `topUpUser`/`setUserBudget`): one abusive payer can exhaust only the target user's budget, not every user's shared global budget. Re-arming a rule resets a drained budget.
- **Version monotonicity**: an older/replayed `BucketsSet` cannot downgrade the mirror (`version <= rule.version` is ignored). A downgrade would make every later callback stale.
- **No-op save detection**: `ruleHash` means re-saving an identical rule emits `RuleUnchanged` and does **not** bump `ruleVersion`, so an accidental save cannot drop an in-flight callback.
- **Non-reverting balance/allowance reads**: a token with reverting/malformed `balanceOf`/`allowance` cannot revert the whole callback; the transfer attempt decides the bucket.
- **Token code check**: `setBuckets` rejects an EOA token address (a no-code call would otherwise look like a successful empty-return transfer).
- **Manual recovery**: `runSplit(token, paycheck)` lets the user run the current rule from their own balance/allowance if a callback was dropped or stale. It is user-initiated, non-custodial, and does not touch the callback budget.
- **Ownership**: `PaydaySplitReactive` uses `Ownable2Step`, so a lost/decommissioned owner can be replaced safely.
- **`topUp` is additive** and emits `ToppedUp`; use `setCallbackLimit` to set an exact value. `setPaused` emits `PausedSet`.

### 2.10 Self-audit findings addressed

| Finding | Severity | Fix |
|---|---|---|
| Dust `Transfer` spam drains the global callback budget | High | `minPaycheck` + per-user budget |
| Replayed older `BucketsSet` downgrades mirror | Medium | monotonic version guard |
| Identical re-save bumps version and drops in-flight split | Medium | `ruleHash` / `RuleUnchanged` |
| Reverting token metadata reverts whole callback | Medium | non-reverting `_readUint` |
| No recovery after a dropped/stale callback | Medium | user-callable `runSplit` |
| `topUp` replaced instead of added; no event | Medium | additive `topUp` + `ToppedUp`; `setCallbackLimit` |
| Immutable reactive owner, no rotation | Medium | `Ownable2Step` |
| EOA/no-code token treated as success | Low | `token.code.length` check |

Residual risk: a malicious token can still emit fake `Transfer` logs or lie about balances; the destination can only move the user's tokens to the user's own payees, but “Split” is not cryptographic proof of token movement. Fee-on-transfer/rebasing tokens are unsupported because balance/allowance are cached for gas.

## 3. Known limitations

1. **Fee-on-transfer / rebasing tokens are unsupported.** The contract routes the event amount. A fee-on-transfer token may cause `SKIP_INSUFFICIENT_BALANCE` or deliver less than the event amount.
2. **Callback liveness.** Callbacks can fail, be delayed, or be dropped if the callback contract is in debt. A failed callback still costs gas. The origin event is marked as processed, so the same paycheck is not retried automatically.
3. **Stale callbacks are dropped.** If the user edits the rule while a paycheck is in flight, the old version is rejected. This is deliberate; the user can re-trigger or accept the missed run.
4. **Rules set before deployment are missed.** `BucketsSet` events emitted before the Reactive contract exists are not replayed. Set the rule after deployment.
5. **Owner trust.** The owner can pause, rescue accidentally sent tokens/ETH, and bind the Reactive address once. The owner cannot move user principal or rewrite a user's bucket list. In production the owner should be a multisig/timelock.
6. **No upgradeability.** A bug requires redeploying and replaying `BucketsSet` events.
7. **Testnet only.** DemoUSDC is mintable. Do not deploy to mainnet without an audit and a real token integration.
8. **Frontend trust.** A phishing site can show a different contract address. Verify `deployments/<chainId>.json` and the explorer.
9. **Reorgs.** Replay protection is per `(txHash, logIndex)`. A reorg that changes the tx hash produces a new key; the Reactive network's finality assumptions apply.
10. **Malicious token/payee.** A user can set an arbitrary token/payee. A malicious token can revert or reenter; `nonReentrant` and `_tryTransferFrom` reduce but do not eliminate token risk. Only use trusted tokens.

## 4. Deployment checklist

- [ ] Fresh testnet wallet; `.env` never committed.
- [ ] `CALLBACK_PROXY` matches the chain.
- [ ] `PaydaySplit.reactive()` equals the deployed `PaydaySplitReactive`.
- [ ] `PaydaySplitReactive.CONFIG_CONTRACT()` and `CALLBACK_CONTRACT()` equal `PaydaySplit`.
- [ ] `PaydaySplitReactive.getRule(user, token).subscribed == true` after saving.
- [ ] `PaydaySplit` has ETH for callback fees.
- [ ] `PaydaySplitReactive` has lREACT and `remaining > 0`.
- [ ] `debt` is 0 on both sides.
- [ ] Run a small-value waterfall (e.g., 10 USDC) before announcing.

## 5. Incident response

| Symptom | First check | Action |
|---|---|---|
| No callback | `remaining`, `paused`, `debt` | `topUp`, `coverDebt`, unpause |
| StaleRule | `ruleVersion` vs payload | Expected after edit; re-trigger or wait |
| BucketSkipped | allowance, balance, payee, transfer failure (now with `originTxHash`/`logIndex`) | Approve, fund, change payee |
| Fixed bucket eats everything | fixed amount > paycheck | Lower fixed amounts / reorder |
| Callback reverts | `cast run` the Lasna tx | Fix rule; redeploy if auth is wrong |
| Suspicious split | `Split` + `processed` | Pause, investigate, redeploy |

## 6. Testing

`forge test` covers 72 cases:

- constructor subscription to `BucketsSet`;
- mirroring arrays + version + dynamic Transfer subscription;
- full waterfall (fixed 300 + 25% + 15% + retained 300);
- priority partial payment;
- fixed + percentage in one bucket;
- inactive bucket skipped;
- partial allowance: only affected bucket skipped;
- zero allowance: everything retained;
- reverting transfer / false-return / no-return / malformed-return token;
- reverting `balanceOf` read still attempts the transfer;
- reentrant token is blocked by `nonReentrant`;
- stale version rejected; older mirror replay ignored; identical re-save does not bump version;
- duplicate callback;
- per-user and global budget exhaustion;
- min paycheck floor;
- reactive pause;
- manual `runSplit` recovery;
- total bps cap / max buckets / invalid payee / empty bucket / per-bucket bps cap;
- setReactive once / owner only;
- only system / only proxy / wrong reactive / paused split;
- fuzz: routed never exceeds paycheck, user balance exact, preview == execution.

A local Anvil harness (`web/script/local-watcher.mjs`) exercises the same path outside Foundry.


## v5 controls and limits

See [UPGRADE-v5.md](UPGRADE-v5.md) for current policy semantics, recovery, token support, validation limits and migration. Rule and policy mutations are nonReentrant. Original coverage percentages are historical v4 data.

## v6 goals, previews and backup boundaries

Only the user can set a goal for their current token/rule version. Paid progress increases after successful transfers; target edits preserve progress, explicit new cycles reset it. Real bucket changes create fresh goals; identical saves preserve them. Version-checked goal updates prevent a stale UI from configuring a different rule. These controls apply immediately to queued callbacks of the same version. Targets do not automatically reset on a calendar boundary.

`previewExecution` assumes standard ERC20 transfer success and current state; it cannot prove future execution. Backup import validates the chain, token, precision, amounts and recognized fields, stages a draft, and never restores paid progress or grants allowances. New core deployment is required for v6. See [UPGRADE-v6.md](UPGRADE-v6.md) and the six-dimension future threat model in [OPTIMIZATION-PLAN.md](OPTIMIZATION-PLAN.md). No independent audit has been performed.
