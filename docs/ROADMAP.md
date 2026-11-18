# Roadmap — PaydaySplit

Current release: **v6, 2026-11-18**. Full six-dimension design, tradeoffs and acceptance criteria: [OPTIMIZATION-PLAN.md](OPTIMIZATION-PLAN.md).

| Stage | Scope | Acceptance |
|---|---|---|
| Shipped v6 | Versioned non-custodial ERC20 waterfall, spending controls, cumulative goals/manual cycles, execution preview, plan backup, receipts/CSV, local harness | 72 Foundry + 13 frontend tests; local callback evidence |
| M1 Hackathon | Explicit waterfall/pro-rata modes, stable bucket IDs, lazy payday-cycle accounting, bounded recovery, templates | Real testnet demo; no duplicate payment through failures/cycle changes |
| M2 Pilot | Native ETH receiver, opt-in notifications, multi-source local routing, accounting exports | Independent user exit, exception recovery, reviewed permissions |
| M3 Optional modules | One bridge, one streaming-pay adapter, one ERC-4626 strategy, cooldown account | Separate risk review/audit; core routing works without modules |

Public GitHub is published. Real Sepolia/Lasna deployment, current video, external review and buildathon submission remain outstanding. v6 is not proxy-upgradeable: migrate to a fresh deployment and revoke old permissions. No current claim of automatic monthly reset, native ETH routing, bridge settlement or yield generation.

Default product direction: one-time configuration, bounded automation, actionable exceptions, and a user-controlled exit.
