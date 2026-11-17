# Roadmap — from hackathon to production

## Shipped (this package)

- Non-custodial income waterfall: fixed + percentage, order = priority, up to 8 buckets.
- Versioned rules, replay protection, per-bucket failure isolation, retained remainder.
- Reactive mirror: dynamic subscriptions, self/refund filtering, min paycheck, per-user + global budget, monotonic version.
- Manual recovery (`runSplit`), no-op save detection, non-reverting token reads, Ownable2Step.
- No-wallet `?demo=1`, local Anvil full loop, `npm run local:watch`.
- 62 Foundry tests, local evidence, 2:57 demo video, architecture/security/deploy/testing docs.

## Next 30 days (testnet → submission)

1. Fund a throwaway wallet; deploy to Sepolia + Lasna; run `verify.ps1`.
2. Record a testnet version of the demo (optional; the local version is clearly labeled).
3. Publish the repo and submit to DoraHacks (see `REMAINING_TASKS.md`).
4. Get one external review of the callback auth + token edge cases.

## 60–90 days (production readiness)

| Work | Why |
|---|---|
| External audit + invariant/Echidna suite | Mainnet-grade assurance |
| Fee-on-transfer/rebasing token policy | Current cache assumes standard ERC-20 |
| Per-rule minimum paycheck | A global `minPaycheck` is a blunt instrument for multi-token deployments |
| Cycle detection / per-user cooldown hardening | A→B→C→A with 100% buckets can self-sustain until budget exhaustion |
| Safe / WalletConnect support | Team treasuries usually live in a Safe |
| Token registry + multi-token deployment manifest | One token per deployment today |
| Indexer/subgraph for activity | 5,000-block UI window is a local-demo compromise |
| Payday receipt (PNG/share link) + 60s video cut | Better distribution artifact |
| Gas optimization: pack `Bucket`, cache payee bitmap | Lower callback and setBuckets cost |

## Product ideas (validated, not built)

- Tax-reserve goal progress and “safe to spend” number.
- Payroll CSV import with labels + per-contributor history.
- Multi-income-source rules (client A → tax 30%, client B → tax 20%).
- Recurring invoices / subscription income.
- Fiat on-ramp/off-ramp reporting export.

Anything that custodies funds or holds a key is deliberately out of scope.
