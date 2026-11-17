# DoraHacks submission draft — Reactive Income Waterfall

> Replace every `<...>` before submitting. Delete this note.

## Form fields

**Build name**

> PaydaySplit — Reactive Income Waterfall

**Track**

> Set It and Forget It

**Deployed contract addresses, and which network (Reactive mainnet or Lasna)?**

> Reactive side: **Lasna testnet** (chainId 5318007).
>
> | Contract | Network | Address |
> |---|---|---|
> | PaydaySplitReactive | Lasna | `<0x...>` |
> | PaydaySplit | Sepolia (11155111) | `<0x...>` |
> | DemoUSDC (or USDC) | Sepolia (11155111) | `<0x...>` |
> | Callback Proxy | Sepolia | `0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4` |
>
> Explorer: `https://lasna.reactscan.net/address/<REACTIVE>` and `https://sepolia.etherscan.io/address/<SPLIT>`.

**Transaction hashes showing the full loop, from origin event to callback.**

> 1. Origin `Transfer` (Sepolia): `<0x...>`
> 2. Lasna `react()` / `CallbackRequested`: `<0x...>`
> 3. Destination callback (`Split` + `Retained`): `<0x...>`
>
> The `Split` events contain `(originTxHash, logIndex, version)` and link back to the origin `Transfer`. `Retained` shows the amount left in the wallet.

**For Every Second Counts: what full-loop latency did you measure, and how?**

> N/A — Track 2 submission. The waterfall is event-driven, not latency-critical. If measured: source block timestamp → Lasna react block timestamp → callback block timestamp, 5 runs, median.

**Description**

> **PaydaySplit — every income, routed before you spend it.**
>
> **The problem.** Freelancers, creators, and small teams receive income irregularly. Every payment triggers the same manual decisions: keep rent, reserve tax, move savings, then spend what is left. Miss one and the tax bill or rent is short. Keeper bots require a server, a private key, and a bill; exchange auto-transfers are opaque.
>
> **How it works.** A user sets an ordered bucket list for a token: up to 8 destinations, each with a fixed amount, a percentage of gross income, or both. `PaydaySplit.setBuckets()` emits `BucketsSet` with the arrays and a version. A Reactive contract on Lasna mirrors the list, subscribes to that user's incoming ERC-20 `Transfer`, and requests one callback per paycheck. On the destination, `executeSplit()` pays fixed buckets first, then percentage buckets, caps every payout by the remaining paycheck, and emits `Split` for each payee plus `Retained` for spending money.
>
> **Why Reactive is doing real work.** The Reactive contract is not a notifier. It mirrors the full bucket list and version, maintains per-user/per-token subscriptions, adds/removes subscriptions when the rule is armed or paused, filters self-transfers and payee refunds, enforces the callback budget, and constructs the versioned authenticated payload. One callback executes the whole waterfall, so users pay one callback overhead instead of one per destination.
>
> **Features.**
> - Fixed + percentage buckets, priority order, up to 8 destinations.
> - Gross-income percentages; fixed bills first by preset; remainder retained.
> - 100% total percentage cap; every payout capped by the paycheck.
> - Versioned rules: stale callbacks are rejected, not silently applied. Identical re-saves do not bump the version.
> - Per-bucket failure isolation: one bad payee does not block the rest.
> - Non-custodial; two callback checks; replay protection; pause/revoke; user-callable `runSplit` recovery.
> - Liveness hardening: minimum paycheck, per-user callback budget, monotonic mirror, non-reverting token reads.
> - `previewWaterfall` view matches execution (fuzz-tested); UI preview + sample paycheck input.
> - One contract set also runs team payroll: a treasury sets fixed salary buckets + a bonus percentage, and pays everyone on the next funding event.
> - Visual waterfall editor with labels, reorder controls, CSV import, activity CSV export, per-run receipt PNG, and a no-wallet `?demo=1` mode.
>
> **Tech stack.** Solidity 0.8.29, Foundry, `reactive-lib-omni v0.1.0`, OpenZeppelin 5.1, Vite + ethers v6.
>
> **Built during the buildathon.** Contracts, 62 tests, deployment/verification scripts, UI, local Anvil harness, and docs were written for this event. The public Reactive starter/library is used as a dependency.
>
> **Evidence.** 62/62 Foundry tests; local Anvil full-loop demo; one-command testnet deploy + `verify.ps1`. Repo: `https://github.com/louisluo0301-cell/payday-split`.

**GitHub / GitLab / Bitbucket**

> `https://github.com/louisluo0301-cell/payday-split`

**Video**

> `<https://youtu.be/...>` — upload `docs/payday-split-demo.mp4` (2:57, local Anvil, Chinese narration + English subtitles) and paste the URL.

**Website**

> `<https://...>` (optional; local dashboard in `web/`)

**X**

> `<https://x.com/...>` (optional)

**LinkedIn**

> `<https://linkedin.com/in/...>` (optional)

**Other**

> Architecture: `docs/ARCHITECTURE.md` · Security: `docs/SECURITY.md` · Deploy: `docs/DEPLOY.md`

**Team info**

> `<Your name>` — solo builder. `<one line>`. Contact: `<email or Telegram>`.

**Tags**

> Reactive Network, Lasna, Reactive Contracts, Solidity, Foundry, DeFi, Personal Finance, Income Routing, Payroll, Automation, Stablecoins, ERC-20

---

## Copy-paste short description

> Every income, routed automatically: rent first, tax reserved, savings funded, the rest stays yours. Up to 8 fixed/percentage buckets, versioned rules, one Reactive callback. Non-custodial.

---

## Judge quick path

1. `forge test` → 62/62.
2. Open the three transactions above.
3. Lasna: `getRule(user, token)` → 3 payees, version, `subscribed=true`.
4. Destination: `bucketCount(user, token)` → 3; `ruleVersion` → 1; `getBuckets` → rent/tax/savings.
5. `Split` events: 300 + 250 + 150; `Retained`: 300.

---

## Submission checklist

- [ ] Public GitHub repo, MIT, no `.env`/private keys.
- [ ] `deployments/<chainId>.json` filled; `web/public/deployments.json` matches.
- [ ] Three transaction hashes verified in a fresh browser.
- [ ] Video re-recorded for the waterfall UI, ≤ 3:00, English subtitles.
- [ ] README evidence table filled.
- [ ] DoraHacks Build created; track = Set It and Forget It.
- [ ] Submit before **2026-12-06 04:00 Beijing time** (2026-12-05 20:00 UTC).
