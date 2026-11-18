# Testing — PaydaySplit v6

Validated 2026-11-18. Behavior: [UPGRADE-v6.md](UPGRADE-v6.md). Future matrix: [OPTIMIZATION-PLAN.md](OPTIMIZATION-PLAN.md).

## Results

- Foundry: **72 passed, 0 failed**, including four fuzz tests at 256 runs each. Raw output: `deployments/tests-v6.json`.
- Frontend: **13 passed, 0 failed**. Integer-unit math, goal capping, backup validation, and full demo DOM interactions including controls, approval, goal cycles and draft import.
- `forge fmt --check` and `npm run build`: passed.
- Local Anvil: Transfer → react → MockProxy callback → 3 Split + Retained. Hashes/amounts: `deployments/31337.evidence.json`.
- Three additional callback loops: rent target 350 pays 300, 50, 0; tax/savings continue; onchain previews match beneficiary balance deltas; duplicate deliveries pay nothing. Evidence: `deployments/31337.goals-v6.evidence.json`.
- Eight active goals complete within a 900,000 gas MockProxy test. Real proxy billing overhead is not modeled.
- Runtime sizes: PaydaySplit 13,566 B, PaydaySplitReactive 10,602 B; both below EIP-170.

## Reproduce

```powershell
forge fmt --check
forge test -vv
forge build --sizes
cd web
npm ci
npm test
npm run build
npm run dev
# Open http://127.0.0.1:5173/?demo=1
```

```powershell
# From project root, on a disposable local Anvil chain only:
pwsh ./script/local-demo.ps1
cd web
npm run local:goals
npm run health -- --local
```

`local-demo.ps1` resets port 8545 after verifying the Anvil client identity. It uses a publicly known Anvil key. Do not fund that account on public chains. `local:goals` requires the default fresh demo deployment and deliberately executes local transactions.

## Verification limits

Historical coverage runs produced source mapping warnings; percentages are not accepted as reliable release evidence. Foundry lint warnings require contextual review, including timestamp comparisons, external calls and the bounded uint96 goal cast. Passing tests are not an audit.

No real Lasna/Sepolia deployment, real callback proxy delivery, long-duration operation, or independent security audit was performed. New layout has DOM regression coverage and a production build; browser visual QA remains outstanding. Existing screenshots/video show earlier UI. Hosted checks are available under the repository's GitHub Actions runs; these complement local results.
