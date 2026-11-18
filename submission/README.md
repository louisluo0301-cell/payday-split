# Submission package — PaydaySplit v8

Form draft: [docs/SUBMISSION.md](../docs/SUBMISSION.md). Current capabilities: [UPGRADE-v8.md](../docs/UPGRADE-v8.md), building on [v7](../docs/UPGRADE-v7.md). Remaining work: [REMAINING_TASKS.md](../docs/REMAINING_TASKS.md).

| Item | Status |
|---|---|
| Contracts: 98 Foundry tests (87 core + 11 observer/token) | Local pass |
| Frontend: 36 tests and production build | Local pass. [Health panel](../docs/visual-qa/README.md) and [income trace](../docs/income-trace/README.md) |
| Local Anvil callback/cycle evidence | [31337.evidence.json](../deployments/31337.evidence.json), [31337.budget-v7.evidence.json](../deployments/31337.budget-v7.evidence.json) |
| Public repository | https://github.com/louisluo0301-cell/payday-split |
| Updated product video | Pending; bundled video is historical local footage |
| Independent camp observer on Lasna/Sepolia | [Verified record](../notes/2026-11-18-first-transfer-monitor.md): count 1, automatic unsubscription, zero debt |
| PaydaySplit core real testnet callback and payout | Pending; the observer does not prove a destination payout |
| External audit | Pending; development review is documented |
| Camp observer assignment submission | User reports submitted; platform review not verified |

The default local loop routes 1,000 dUSDC into 300/250/150 and retains 300. Pro-rata budget 600 pays 300/180/120; the first goal then reaches 350 and resets at the next 7-day boundary. Use machine evidence for exact hashes. All are Anvil transactions, not public testnet evidence.

Before submitting the product, verify the current competition requirements, obtain real core contract addresses and full-loop hashes, record the current UI, and complete the remaining form fields. Build dependency advisory remains documented in [CODE-REVIEW-v8.md](../docs/CODE-REVIEW-v8.md).
