# Roadmap — PaydaySplit

Current release: **v7, 2026-11-18**. Full design: [OPTIMIZATION-PLAN.md](OPTIMIZATION-PLAN.md). Current semantics: [UPGRADE-v7.md](UPGRADE-v7.md).

| Stage | Scope | Acceptance |
|---|---|---|
| Shipped v7 | ERC20 waterfall/pro-rata, stable bucket IDs, fixed-length payday cycles, goals, controls, preview, templates, backup v2, receipts/CSV | 87 Foundry + 18 frontend tests, local four-loop cycle evidence |
| M1 remaining | Bounded per-bucket retry/cancellation, exception status, real testnet deployment | No duplicate successful payments; failures/reordering/cycle changes tested |
| M2 pilot | Native ETH receiver, opt-in notifications, multi-source routing, accounting exports | Independent exit, reviewed permissions and complete exception lifecycle |
| M3 optional modules | One bridge, one streaming-pay adapter, one ERC-4626 strategy, cooldown account | Separate risk review/audit; routing works without modules |

Public GitHub is published. Real Sepolia/Lasna deployment, updated video, external review and buildathon submission remain outstanding. v7 uses a new immutable deployment; revoke old permissions during migration. Automatic cycles are fixed-duration periods, not calendar months. Native ETH routing, bridges, streaming-pay and yield integration are not implemented.

Research: [REFERENCE-RESEARCH-v7.md](REFERENCE-RESEARCH-v7.md). Known issues: [CODE-REVIEW-v7.md](CODE-REVIEW-v7.md).
