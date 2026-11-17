# PaydaySplit — one-pager

## The problem

Freelancers, creators, and small teams get paid irregularly. Every payment triggers the same manual routine: keep rent, reserve tax, move savings, then spend what is left. Miss it once and rent or the tax bill is short. Keeper bots need a server, a key, and a bill; exchange auto-transfers are opaque.

## The product

**PaydaySplit is a non-custodial income waterfall.** Set an ordered list of up to 8 buckets once:

- fixed amount (rent, invoice, salary);
- percentage of gross income (tax, savings, bonus pool);
- or both.

When a payment in the configured token arrives, a Reactive contract on Lasna mirrors the rule, watches the `Transfer`, and requests **one callback**. The destination pays the buckets in order, caps every payout by the paycheck, skips a failed bucket, and emits `Split` for each payee plus `Retained` for the remainder. The contract never holds principal.

## Why Reactive is doing real work

- Mirrors the full bucket list + version from `BucketsSet`, not just a notification.
- Maintains per-user/per-token `Transfer` subscriptions; subscribes/unsubscribes when the rule is armed or paused.
- Filters self-transfers and payee refunds; checks a minimum paycheck, a per-user budget, a global callback budget, and replay keys.
- Rejects an older mirrored version, so an at-least-once replay cannot downgrade the rule.
- Builds a versioned authenticated payload; one callback executes the whole waterfall.

## What is verified

| Evidence | Status |
|---|---|
| 62 Foundry tests (fuzz, malicious/non-standard ERC-20, version, budget, preview) | ✅ passing |
| Local Anvil full loop: Transfer → local `react()` → callback → 3 `Split` + `Retained` | ✅ `deployments/31337.evidence.json` |
| Frontend: labels, reorder, sample paycheck, CSV import/export, per-run receipt PNG, `?demo=1` no-wallet mode | ✅ build + local UI check |
| Sepolia + Lasna deployment | ⏳ requires funded wallet (owner action) |
| External audit | ⏳ not performed; self-audit in `docs/SECURITY.md` |

## Judge quick path (2 minutes)

1. `cd web && npm install && npm run dev`
2. open `http://127.0.0.1:5173/?demo=1` — no wallet needed.
3. Click **Run a sample income**; edit any bucket or the preview amount.
4. Full local loop: `pwsh ./script/local-demo.ps1`; open `?local=1`; `cd web && npm run local:watch`.

**Demo video:** `docs/payday-split-demo.mp4` (2:57, local Anvil, Chinese narration + English subtitles).

## Track

Reactive Omni Buildathon — **Set It and Forget It**.

## Links

- Repo: `<https://github.com/...>` (owner to publish)
- Submission draft: `docs/SUBMISSION.md`
- Remaining owner tasks: `docs/REMAINING_TASKS.md`
- Architecture / security / testing: `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/TESTING.md`
