# Architecture — Reactive Income Waterfall

PaydaySplit routes every incoming stablecoin payment through an ordered bucket list. Each bucket can carry a fixed amount, a percentage of gross income, or both; array order is priority, and the default presets put fixed bills first. The rule lives on the destination chain; Lasna mirrors it and asks for exactly one callback per incoming transfer.

```
Origin chain (Sepolia / Base Sepolia / Unichain Sepolia)
┌──────────────────────────────────────────────────────────────┐
│  USDC / DemoUSDC                                             │
│    emit Transfer(from, to=user, amount)                      │
│                          │                                   │
│  PaydaySplit             │                                   │
│    buckets[user][token]  │                                   │
│    executeSplit(...)  ◀──┼──────────────┐                    │
│    emit Split / Retained │              │                    │
└──────────────────────────┼──────────────┼────────────────────┘
                           │ log          │ callback
                           ▼              │
Reactive Network (Lasna)                  │
┌─────────────────────────────────────────┴────────────────────┐
│  PaydaySplitReactive                                          │
│    buckets[user][token] + version  ← mirrored from BucketsSet │
│    react(log):                                                │
│      BucketsSet → update buckets/version, subscribe Transfer  │
│      Transfer   → check budget, requestCallbackV_1_0          │
│    emit Seen / CallbackRequested                              │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
              Callback Proxy (destination chain)
              injects Reactive address into payload
                           │
                           ▼
                 PaydaySplit.executeSplit(user, token, amount, version, ...)
```

## 1. Data model

### Destination chain

```solidity
struct Bucket {
    address payee;
    uint96 fixedAmount;
    uint16 bps;
    bool active;
}

mapping(address => mapping(address => Bucket[])) private _buckets; // user → token → ordered list
mapping(address => mapping(address => uint256)) public ruleVersion;
mapping(bytes32 => bool) public processed; // keccak(originTxHash, logIndex)
address public reactive;
```

Array order is priority. `fixedAmount` is in token units. `bps` is a percentage of the **gross** paycheck, not of the remainder. A bucket may have both (fixed + percentage).

### Reactive side

```solidity
struct Rule {
    address[] payees;
    uint96[] fixedAmounts;
    uint16[] bps;
    bool[] active;
    uint256 version;
    uint8 activeCount;
    bool subscribed;
}
mapping(address => mapping(address => Rule)) private _rules;
```

`activeCount == 0` means the rule is paused; the contract unsubscribes the user's `Transfer`.

## 2. Rule lifecycle

1. User calls `setBuckets(token, buckets)`.
2. Contract validates:
   - `buckets.length <= 8`;
   - each active bucket has a valid payee (not zero, not the user, not the contract);
   - each active bucket has `fixed > 0 || bps > 0`;
   - `bps <= 10_000`;
   - sum of active `bps <= 10_000`.
3. Contract increments `ruleVersion[user][token]` and emits:

```solidity
event BucketsSet(
  address indexed user,
  address indexed token,
  uint256 indexed version,
  address[] payees,
  uint96[] fixedAmounts,
  uint16[] bps,
  bool[] active
);
```

4. Reactive contract subscribes to `BucketsSet` at construction. On each event it:
   - decodes the arrays from `log.data`;
   - reads `version` from `log.topic3`;
   - validates the same invariants;
   - replaces its local arrays;
   - subscribes to `Transfer(to=user)` for this token if `activeCount > 0`;
   - unsubscribes if `activeCount == 0`.

`unsubscribe` uses exactly the same six criteria as `subscribe`; any drift silently leaves the old subscription in place, so both calls use the same helper values.

## 3. Waterfall algorithm

```solidity
remaining = paycheck
for (i = 0; i < buckets.length; i++) {
    if (!bucket.active) continue;
    requested = bucket.fixedAmount + paycheck * bucket.bps / 10_000;
    if (requested == 0) continue;
    if (remaining == 0) { emit BucketSkipped(SKIP_NO_FUNDS); continue; }

    pay = min(requested, remaining);

    if (allowance/balance < pay) {
        emit BucketSkipped(SKIP_INSUFFICIENT_BALANCE);
        continue;                 // do not subtract from remaining
    }
    if (!_tryTransferFrom(user, payee, pay)) {
        emit BucketSkipped(SKIP_TRANSFER_FAILED);
        continue;
    }
    remaining -= pay;
    emit Split(...);
}
if (remaining > 0) emit Retained(...);
```

Properties:

- **Order is priority**: `executeSplit` iterates the array; each bucket requests `fixedAmount + paycheck * bps / 10000`, capped by what remains. A fixed rent bucket is paid first only because the Freelancer preset puts it first. This is deliberate: one pass, one callback, no hidden second phase.
- **Gross basis**: tax 25% means 25% of the paycheck, not 25% of what is left after rent.
- **Cap by paycheck**: `pay = min(requested, remaining)`. If a 800 fixed rent meets a 500 paycheck, rent gets 500 and later buckets get nothing.
- **Failure isolation**: if one bucket's allowance/transfer fails, the remaining buckets still run. `remaining` is not reduced for a failed bucket, so a later bucket can still use it.
- **Retained**: whatever is left stays in the user's wallet and is emitted as `Retained`.

### Why `_tryTransferFrom` uses a low-level call

`SafeERC20.safeTransferFrom` reverts on failure. In a waterfall we want a failed bucket to be skipped, not to revert the whole callback (which still costs gas). `_tryTransferFrom` calls `transferFrom` and:

- returns `true` for a standard `true` return;
- returns `true` for a no-return token (USDT-style);
- returns `false` on revert or `false` return.

The whole function is `nonReentrant`, so a malicious token cannot re-enter the waterfall. A malformed 64-byte return whose first word is not exactly `1` is treated as failure, and a no-code token address is rejected at `setBuckets`.

### 3.1 Preview and manual recovery

`previewWaterfall(user, token, paycheck)` runs the same fixed/percentage/cap math as `executeSplit`, without external calls, and returns aligned `payees`, `amounts`, and `retained`. The UI uses it conceptually (and the fuzz test asserts preview equals execution).

`runSplit(token, paycheck)` is a user-callable recovery path. It runs the current rule against `msg.sender` only, emits normal `Split`/`Retained` with `originTxHash = logIndex = 0`, and uses no callback budget. This covers a dropped callback, a stale version, or a missed `BucketsSet`; it cannot move another user's funds.

## 4. Versioning

Every real `setBuckets` increments `ruleVersion`. Re-saving an identical rule emits `RuleUnchanged` and keeps the version, so an accidental no-op save cannot invalidate an in-flight callback. The Reactive contract mirrors the version and includes it in the callback payload. The destination rejects a callback whose version does not match the current rule:

```solidity
if (version_ != ruleVersion[user_][token_]) {
    emit StaleRule(...);
    return;
}
```

Why: a paycheck event can be in flight when the user changes the rule. Without versioning, the old event would execute against the new bucket list. With versioning, the stale callback is a no-op, and the user can decide whether to re-trigger. This is a deliberate trade-off: **no surprising splits** over **guaranteed split for every event**.

## 5. Team mode

The contract has no concept of "personal" vs "team". A team treasury is simply an address that:

1. holds the token;
2. approves `PaydaySplit`;
3. calls `setBuckets` with fixed salaries as buckets.

The shipped team preset is Design 1,500 / Engineering 2,000 / Ops 800 + 10% bonus pool. All four are ordinary buckets; the bonus pool is a percentage of gross income. Every incoming payment to the treasury triggers the same waterfall. A Safe/multisig can own the treasury and call `setBuckets`; the current UI uses an injected wallet, so a Safe transaction must be proposed in the Safe app (not through this UI).

## 6. Trust boundaries

| Actor | Can | Cannot |
|---|---|---|
| User | set/replace buckets, disable all, revoke allowance, `runSplit` | move another user's tokens |
| Owner | pause, bind Reactive once, set min paycheck / budgets, rescue accidentally sent tokens/ETH, rotate ownership | move user principal, change a user's payee list |
| Reactive contract | mirror rules, subscribe, request callbacks | call `executeSplit` directly (not the proxy), change a rule |
| Callback Proxy | call `executeSplit` with injected sender | bypass `onlyReactive` |
| Token | transfer within allowance | move more than approved |

**Liveness controls.** `minPaycheck` filters dust; `userRemaining[user][token]` gives each user an isolated callback budget; `version <= rule.version` prevents an older mirror from downgrading; `RuleUnchanged` prevents no-op version churn. `runSplit` is the user-controlled recovery path.

## 7. Failure modes

| Failure | Behavior | Recovery |
|---|---|---|
| Rule set before Reactive deployed | `BucketsSet` missed | Re-save the rule after deployment |
| Rule mirror delayed | Paycheck may not split | Wait; UI polls `getRule`; re-save if needed |
| Stale version | `StaleRule`, no transfers | `runSplit` or re-save |
| No allowance for one bucket | `BucketSkipped`, other buckets continue | Approve; next paycheck |
| Fixed amount > paycheck | Later buckets get nothing; `Retained == 0` | Adjust fixed amounts / priorities |
| Reactive debt | No events delivered | `topUp` / `coverDebt` |
| Callback gas too low | Proxy reports `CallbackFailure` | Increase `CALLBACK_GAS_LIMIT` (900k) and redeploy |
| Dust spam | `minPaycheck` ignores; per-user budget caps blast radius | Adjust `minPaycheck` |
| Token is fee-on-transfer | Balance check may skip / under-transfer | Unsupported; use standard ERC-20 |
| One payee blacklisted | Only that bucket fails (low-level transfer returns false) | Change payee |

## 8. Cost model

- **Lasna**: one `react()` per incoming transfer, plus rule mirroring. A 3-bucket rule + callback request is small; prepay `0.5 lREACT`, cap `MAX_CALLBACKS`.
- **Destination**: the Callback Proxy bills `PaydaySplit` in ETH. A 3-bucket callback is ~250–350k gas; 8 buckets can approach 700k. `CALLBACK_GAS_LIMIT = 1_500_000`; fund `0.02 ETH` for many runs.
- **No per-tick cost**: no Cron subscription. Idle time is free.
- **One callback, not N**: all buckets execute in one transaction, so users pay one callback overhead instead of one per destination.

## 9. Upgrade path

No proxies. To upgrade:

1. Deploy a new `PaydaySplit` / `PaydaySplitReactive`.
2. Bind the new Reactive address.
3. Replay `BucketsSet` events to rebuild state in the new Reactive contract.
4. Re-set buckets from the UI or a migration script.

The event log is the source of truth.
