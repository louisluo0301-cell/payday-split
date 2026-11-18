# Testing — PaydaySplit v8

Validated 2026-11-18. Current behavior: [UPGRADE-v8.md](UPGRADE-v8.md); allocation semantics: [UPGRADE-v7.md](UPGRADE-v7.md). Review: [CODE-REVIEW-v7.md](CODE-REVIEW-v7.md).

## Results

- Foundry: **98 passed, 0 failed** (87 core + 11 independent observer/token), including five fuzz tests at 256 runs each. Raw output: `deployments/tests-v8.json`.
- Frontend: **33 passed, 0 failed**. Allocation, cycles/backup, health checks, wrong networks, unavailable RPC data, reserve credit, user controls, notification deduplication and recovery. Raw output: `deployments/frontend-v8.tap`.
- PowerShell environment parser: 7 checks; inline comments, quotes, URL fragments, export assignments, empty values and malformed quotes. Included in CI.
- `forge fmt --check` and `npm run build`: passed. Source syntax checks include JavaScript modules and PowerShell scripts.
- Historical Anvil full loop: Transfer → react → MockProxy → 3 Split + Retained. Evidence: `deployments/31337.evidence.json`.
- Four pro-rata loops: budget 600; first goal 350 pays 300 → 50 → 0 → after 7 days 300; later shares remain 180/120. Every preview matches balance changes; every duplicate delivery pays zero. Evidence: `deployments/31337.budget-v7.evidence.json`.
- Eight standard-token buckets/goals fit the 900,000 gas historical regression. Seven gas-burning buckets followed by a valid eighth complete in the requested 1,500,000 gas MockProxy budget. Real proxy overhead is not modeled.
- Runtime sizes: PaydaySplit 19,802 B, PaydaySplitReactive 10,602 B; both below 24,576 B (EIP-170). Reproduce with `forge build --sizes`.
- Official npm audit: production dependencies 0 known advisories; full tree has 4 high entries from one unpatched picomatch root advisory. Details: [CODE-REVIEW-v7.md](CODE-REVIEW-v7.md).
- Current dependency scans: `deployments/npm-audit-v8.json` and `deployments/npm-audit-production-v8.json`.
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
# Disposable local Anvil only; resets port 8545 after checking client identity:
pwsh ./script/local-demo.ps1
cd web
npm run local:budget
npm run health -- --local
```

`local:budget` requires a fresh default deployment and deliberately sends local transactions. For the manual-waterfall goal scenario, reset again and run `npm run local:goals` instead. The harness uses a publicly known Anvil key; never fund it on public chains.

## Verification limits

Coverage runs have produced source-mapping warnings; coverage percentages are not reliable release evidence. Foundry lint warnings require contextual review, including timestamps, bounded casts and external calls. Passing tests are not an audit.

The independent observer has real Sepolia/Lasna evidence. PaydaySplit's actual destination callback delivery and payouts, long-duration operation and independent audit remain outstanding. New health UI has DOM regression coverage and a production build; browser visual QA remains outstanding. Existing product screenshots/video are historical; the camp completion screenshot is current. GitHub Actions complements local checks.
