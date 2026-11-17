# Submission package — Reactive Income Waterfall

Canonical form draft: [`../docs/SUBMISSION.md`](../docs/SUBMISSION.md).
Everything I can complete without your accounts/funds is done; the rest is listed in
[`../docs/REMAINING_TASKS.md`](../docs/REMAINING_TASKS.md).

## Status

| Item | Status |
|---|---|
| Contracts + 62 Foundry tests | ✅ done |
| One-command local Anvil waterfall demo | ✅ done; `deployments/31337.evidence.json` |
| Frontend waterfall editor + `?demo=1` no-wallet mode | ✅ done; `web/` |
| Deploy scripts (Sepolia / Base / Unichain) | ✅ done |
| Architecture / security / deploy / demo / testing docs | ✅ done |
| Testnet deployment + tx hashes | ⏳ needs your funded wallet — see `docs/REMAINING_TASKS.md` §1 |
| v2 demo video | ✅ recorded: `docs/payday-split-demo.mp4` (2:57, local Anvil, English subtitles) |
| Public GitHub repo | ⏳ needs your account — §3 |
| DoraHacks submission | ⏳ needs your account — §4 |

## Local evidence (waterfall)

`deployments/31337.evidence.json`:

- income `Transfer`: `0xaed7e751162d6ec123fa40ed5c2ac4c0c075dcbc419ccafaf9eeaf5694568503`
- local `react()` (MockSystem): `0xa1cdef5cb90f3c241b52d068afd592bf13abd03d220a969855b450f7a04ff456`
- callback / `Split` + `Retained`: `0xbcda62fcdd1679d2929f137649ceabbec16d58cf37a5eb92786dc8e05af574dc`
- result: 1,000 dUSDC → rent 300, tax 250, savings 150, retained 300

This is **Anvil local**, not Sepolia. Do not submit it as a testnet transaction.

## What to fill before submitting

1. Run `pwsh ./script/deploy.ps1` on a funded testnet wallet.
2. Run `pwsh ./script/verify.ps1`; copy addresses + 3 hashes into `docs/SUBMISSION.md`.
3. Upload the generated `docs/payday-split-demo.mp4`; paste URL.
4. Push the repo publicly; paste URL.
5. Create the DoraHacks Build and submit.

## Pre-submit checklist

- [ ] `forge test` → 62 passed.
- [ ] `web` `npm run build` succeeds.
- [ ] `.env` absent from git; no private key in README/screenshots/video.
- [ ] DoraHacks track = **Set It and Forget It**.
- [ ] Video ≤ 3:00 and shows the waterfall result.
- [ ] Submit before 2026-12-06 04:00 Beijing time.
