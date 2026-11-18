# Submission package — PaydaySplit v7

Form draft: [docs/SUBMISSION.md](../docs/SUBMISSION.md). Current capabilities: [UPGRADE-v7.md](../docs/UPGRADE-v7.md). Remaining work: [REMAINING_TASKS.md](../docs/REMAINING_TASKS.md).

| Item | Status |
|---|---|
| Contracts: 87 Foundry tests | Local pass |
| Frontend: 17 tests and production build | Local pass; browser visual QA pending |
| Local Anvil callback/cycle evidence | [31337.evidence.json](../deployments/31337.evidence.json), [31337.budget-v7.evidence.json](../deployments/31337.budget-v7.evidence.json) |
| Public repository | https://github.com/louisluo0301-cell/payday-split |
| Updated v7 video | Pending; bundled video is historical local footage |
| Real Lasna/Sepolia deployment and transactions | Pending |
| External audit | Pending; development review is documented |
| Website submission | Not performed in this update |

The default local loop routes 1,000 dUSDC into 300/250/150 and retains 300. Pro-rata budget 600 pays 300/180/120; the first goal then reaches 350 and resets at the next 7-day boundary. Use machine evidence for exact hashes. All are Anvil transactions, not public testnet evidence.

Before submitting, verify the current competition requirements, obtain real deployed addresses and full-loop hashes, record the current UI, and complete the remaining form fields. Build dependency advisory remains documented in [CODE-REVIEW-v7.md](../docs/CODE-REVIEW-v7.md).
