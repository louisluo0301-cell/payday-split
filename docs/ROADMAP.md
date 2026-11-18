# Roadmap — PaydaySplit

Current release: **v8, 2026-11-18**. Full design: [OPTIMIZATION-PLAN.md](OPTIMIZATION-PLAN.md). Current additions: [UPGRADE-v8.md](UPGRADE-v8.md); core semantics: [UPGRADE-v7.md](UPGRADE-v7.md).

| Stage | Scope | Acceptance |
|---|---|---|
| Shipped v8 | v7 allocation/cycles plus shared CLI/dashboard health checks, fee credit/debt, exceptions, status history and verified independent observer | 98 Foundry + 33 frontend tests, local core flow and real observer evidence |
| M1 remaining | Bounded per-bucket retry/cancellation, actual PaydaySplit testnet callback/payout | No duplicate successful payments; failures/reordering/cycle changes tested |
| M2 pilot | Native ETH receiver, opt-in notifications, multi-source routing, accounting exports | Independent exit, reviewed permissions and complete exception lifecycle |
| M3 optional modules | One bridge, one streaming-pay adapter, one ERC-4626 strategy, cooldown account | Separate risk review/audit; routing works without modules |

Public GitHub is published. The independent monitor is deployed and its camp task was submitted by the user; platform review is unverified. PaydaySplit core testnet callback/payout deployment, updated video, external review and buildathon submission remain outstanding. Core v7 deployments are immutable; v8 health checks do not change that core. Automatic cycles are fixed-duration periods, not calendar months. Native ETH routing, bridges, streaming-pay and yield integration remain planned.

Research: [REFERENCE-RESEARCH-v7.md](REFERENCE-RESEARCH-v7.md). Known issues: [CODE-REVIEW-v7.md](CODE-REVIEW-v7.md).
