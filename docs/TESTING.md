# Testing — PaydaySplit v5

Validated 2026-11-17. See [UPGRADE-v5.md](UPGRADE-v5.md) for behavior and limitations.

## Results

- Foundry: **62 passed, 0 failed**, including three fuzz tests at 256 runs each. Raw output: `deployments/tests-v5.json`.
- Frontend: **7 passed, 0 failed**. Includes integer-unit arithmetic and full demo DOM startup, spending policy, pause and bounded approval interactions.
- `npm run build`: passed.
- Local Anvil: full Transfer → react → MockProxy callback → 3 Split + Retained loop passed. Exact current hashes and amounts: `deployments/31337.evidence.json`.
- Eight buckets plus policy controls complete within a 900,000 gas MockProxy delivery test. This does not model the real callback proxy's fee/gas overhead.
- Runtime contract sizes remain below EIP-170.

## Reproduce

```powershell
forge fmt --check
forge test -vv
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
npm run health -- --local
```

`script/local-demo.ps1` resets the local Anvil at port 8545 after verifying its client identity. It uses the publicly known Anvil test key. Never fund that account on public chains.

## Coverage and verification limits

The v5 `forge coverage --ir-minimum` run produced extensive source mapping / anchor warnings. Its percentages are not accepted as reliable release evidence. Historical v4 screenshots and video do not show v5 spending controls.

The in-app browser could not connect to localhost in this session. DOM regression tests and production build passed; visual QA of the new layout remains outstanding. No real Lasna/Sepolia deployment, real callback proxy delivery, live long-duration operation, or independent security audit was performed. CI configuration is included; a hosted CI run has not been observed.
