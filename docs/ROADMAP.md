# Roadmap — PaydaySplit

Current source: **v9 modules**. See [Income modules](income-modules/README.md) for migration and local validation. The previous packaged release was [v8](UPGRADE-v8.md).

| Stage | Scope | Acceptance |
|---|---|---|
| Shipped v8 | v7 allocation/cycles plus shared CLI/dashboard health checks, fee credit/debt, exceptions, status history and verified independent observer | 98 Foundry + 33 frontend tests, local core flow and real observer evidence |
| Current main | [Income trace and recovery](income-trace/README.md) links each incoming transfer to the request and payout | 36 frontend tests, local browser payout and late callback replay verified |
| v9 local pilot | Bounded retries, ETH receiver, Aave V3, withdrawal cooldown and a CCTP V2 testnet route | 106 Foundry and 39 frontend tests, local browser flows, public integrations awaiting network acceptance |
| Validation | Deploy the complete testnet system, verify external integrations, commission independent audit | Published addresses and reproducible receipts for each path |
| Later extensions | Multiple collection routes, streaming pay, opt-in notifications and accounting exports | Reviewed permissions and a complete exception lifecycle |

The independent monitor is deployed and its camp task was submitted by the user. Platform review is unverified. PaydaySplit core testnet callback and payout deployment, updated video, external review and buildathon submission remain outstanding. The v9 modules require a new deployment. Automatic cycles use fixed-duration periods.

Research: [REFERENCE-RESEARCH-v7.md](REFERENCE-RESEARCH-v7.md). Known issues: [CODE-REVIEW-v7.md](CODE-REVIEW-v7.md).
