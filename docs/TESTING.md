# Testing — PaydaySplit v9

Contract tests updated 2026-11-25. See [income modules](income-modules/README.md), [workspace acceptance](workspace/README.md) and [allocation semantics](UPGRADE-v7.md).

## Results

- Foundry: **109 passed, 0 failed**, including fuzz tests and the v9 income modules. The three guardrail cases cover trigger filtering, replay, per-run and cumulative limits, and retry accounting. [Foundry output](guardrails/forge-test.txt)
- Frontend: **53 passed, 0 failed**. Includes testnet deployment validation, payment review, confirmed-block wallet snapshots and faucet detection.
- PowerShell environment parser: 7 checks; inline comments, quotes, URL fragments, export assignments, empty values and malformed quotes. Included in CI.
- `forge fmt --check` and `npm run build`: passed. CI also uses `node web/script/contract-abi.mjs --check` to compare the browser interfaces with compiled Solidity.
- Historical Anvil full loop: Transfer → react → MockProxy → 3 Split + Retained. Evidence: `deployments/31337.evidence.json`.
- Four pro-rata loops: budget 600; first goal 350 pays 300 → 50 → 0 → after 7 days 300; later shares remain 180/120. Every preview matches balance changes; every duplicate delivery pays zero. Evidence: `deployments/31337.budget-v7.evidence.json`.
- Eight standard-token buckets/goals fit the 900,000 gas historical regression. Seven gas-burning buckets followed by a valid eighth complete in the requested 1,500,000 gas MockProxy budget. Real proxy overhead is not modeled.
- PaydaySplit runtime with cumulative budgets: 24,521 B under the 24,576 B EIP-170 cap, using 25 optimizer runs. Reproduce with `forge build --sizes --skip test --skip script`.
- Historical v8 raw outputs and dependency scans are in `deployments/`: `tests-v8.json`, `frontend-v8.tap`, `npm-audit-v8.json` and `npm-audit-production-v8.json`. See the [v8 review](CODE-REVIEW-v8.md).
- Real Sepolia → Lasna observer execution verified: source Transfer, matching observation and automatic unsubscribe, count 1, remaining 0, zero debt. `deployments/camp-transfer-monitor.json`; new shared health checker independently returns `completed` in `deployments/camp-health.json`.

## Reproduce

```powershell
forge fmt --check
forge test -vv
forge build --sizes
pwsh ./script/test-env.ps1
cd web
npm ci
npm test
npm run build
npm run health -- --camp
npm run dev
# Open http://127.0.0.1:5173/?demo=1
```

```powershell
# Choose an unused local port:
pwsh ./script/local-demo.ps1 -Port 18673
cd web
npm run local:budget
npm run health -- --local
```

`local:budget` requires a fresh local demo deployment and sends local transactions. For the manual-waterfall goal scenario, start another disposable chain or pass `-Reset`, then run `npm run local:goals`. The harness uses a public Anvil test identity.

## Verification limits

Coverage runs have produced source-mapping warnings; coverage percentages are not reliable release evidence. Foundry lint warnings require contextual review, including timestamps, bounded casts and external calls. Passing tests are not an audit.

The independent observer has real Sepolia/Lasna evidence. PaydaySplit's actual destination callback delivery and payouts, long-duration operation and independent audit remain outstanding. The health panel has DOM regression coverage and [browser visual acceptance](visual-qa/README.md) at desktop and phone widths. Earlier product screenshots and video show the prior UI. GitHub Actions complements local checks.
