# Submission package — PaydaySplit v9

Form draft: [docs/SUBMISSION.md](../docs/SUBMISSION.md). Current capabilities: [v9 income modules](../docs/income-modules/README.md) and [workspace](../docs/workspace/README.md). Remaining work: [REMAINING_TASKS.md](../docs/REMAINING_TASKS.md).

| Item | Status |
|---|---|
| Contracts: 109 Foundry tests | Local pass |
| Frontend: 53 tests and production build | Local pass. [Health panel](../docs/visual-qa/README.md), [income trace](../docs/income-trace/README.md) and [v9 workspace](../docs/workspace/README.md) |
| Local Anvil callback/cycle evidence | [31337.evidence.json](../deployments/31337.evidence.json), [31337.budget-v7.evidence.json](../deployments/31337.budget-v7.evidence.json) |
| Public repository | https://github.com/louisluo0301-cell/payday-split |
| v9 demo video | 1:53, local Anvil, with English narration and embedded English subtitles. [MP4](https://raw.githubusercontent.com/louisluo0301-cell/payday-split/main/docs/payday-split-demo.mp4) |
| Independent camp observer on Lasna/Sepolia | [Verified record](../notes/2026-11-18-first-transfer-monitor.md): count 1, automatic unsubscription, zero debt |
| PaydaySplit core testnet callback and payout | Sepolia → Lasna → Sepolia. 300 dUSDC routed and 700 retained on a 1,000 dUSDC income. [Addresses and transaction links](../deployments/paydaysplit-sepolia-lasna.evidence.json) |
| External audit | Pending; development review is documented |
| Camp observer assignment submission | User reports submitted; platform review not verified |

The default local loop routes 1,000 dUSDC into 300/250/150 and retains 300. Pro-rata budget 600 pays 300/180/120; the first goal then reaches 350 and resets at the next 7-day boundary. Use machine evidence for exact hashes. All are Anvil transactions, not public testnet evidence.

The [submission draft](../docs/SUBMISSION.md) includes the project fields and evidence. Complete the entrant and contact fields in DoraHacks.
