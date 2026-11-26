# DoraHacks submission draft — Reactive Income Waterfall

The build, video, and testnet evidence fields are ready to copy. Complete the entrant and contact fields in DoraHacks.

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
> | PaydaySplitReactive | Lasna | [`0xFfA5C8A1FD3c45afc0936cD21d12D14a8f513b0c`](https://lasna.reactscan.net/address/0xFfA5C8A1FD3c45afc0936cD21d12D14a8f513b0c) |
> | PaydaySplit | Sepolia (11155111) | [`0x2742Df5C6Fac4A7FF8D1d20D7D9bB8f020bF375F`](https://sepolia.etherscan.io/address/0x2742Df5C6Fac4A7FF8D1d20D7D9bB8f020bF375F) |
> | DemoUSDC | Sepolia (11155111) | [`0xF08fD050eef4b0d74e81300aeC188B5218157Ff2`](https://sepolia.etherscan.io/address/0xF08fD050eef4b0d74e81300aeC188B5218157Ff2) |
> | Callback Proxy | Sepolia | [`0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4`](https://sepolia.etherscan.io/address/0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4) |

**Transaction hashes showing the full loop, from origin event to callback.**

> 1. [Sepolia income `Transfer`](https://sepolia.etherscan.io/tx/0x5407766076d2a9131a7fdd622dd15be693e3b3aec9f672399907e51d0d700fd6) — block 12194576, log 24.
> 2. [Lasna `react()` and callback request](https://lasna.reactscan.net/tx/0x9eaceb9638091341be225bf5dc939a35bacb24b5babb3e035a40cd72ee56fa08) — block 9042558.
> 3. [Sepolia callback with `Split` and `Retained`](https://sepolia.etherscan.io/tx/0x66913a9758316f8c1f94fe997af744cb97f82905a3e3eeaf55edb1705c6fb21f) — block 12194577.
>
> The testnet payout routed 300 dUSDC and retained 700 dUSDC from a 1,000 dUSDC income. The destination events carry the source hash and log index. [Structured evidence](../deployments/paydaysplit-sepolia-lasna.evidence.json)

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
> - Waterfall fixed + gross-income percentage, or pro-rata shares of a capped budget; up to 8 destinations.
> - Stable bucket identities, cumulative targets and automatic fixed-duration UTC payday cycles (not calendar months).
> - Current-state execution preview, budget templates and validated v2 JSON plan backups (draft only).
> - Wallet reserve, per-run/daily limits, expiry, pause and bounded approvals.
> - Gross-income percentages; fixed bills first by preset; remainder retained.
> - 100% total percentage cap; every payout capped by the paycheck.
> - Versioned rules: stale callbacks are rejected, not silently applied. Identical re-saves do not bump the version.
> - Per-bucket failure isolation: one bad payee does not block the rest.
> - Non-custodial; two callback checks; replay protection; pause/revoke; explicit `runSplit` payments and origin-keyed `recoverSplit` for unconsumed events.
> - Liveness hardening: minimum paycheck, per-user callback budget, monotonic mirror, non-reverting token reads.
> - `previewWaterfall` for basic math; `previewExecution` includes current goals, policy, balance and allowance (assumes successful standard-token transfers).
> - One contract set also runs team payroll: a treasury sets fixed salary buckets + a bonus percentage, and pays everyone on the next funding event.
> - Visual waterfall editor with labels, reorder controls, CSV import, activity CSV export, per-run receipt PNG, and a no-wallet `?demo=1` mode.
> - Shared read-only web/CLI health checks for chain identity, fee balance/reserves/debt, callback slots, rule state and user limits; deduplicated in-page alerts, recovery history and JSON reports.
>
> **Tech stack.** Solidity 0.8.29, Foundry, `reactive-lib-omni v0.1.0`, OpenZeppelin 5.1, Vite + ethers v6.
>
> **Built during the buildathon.** Contracts, deployment/verification scripts, UI, local Anvil harness, and docs were written for this event. The public Reactive starter/library is used as a dependency.
>
> **Evidence.** The repository records 109 Foundry and 53 frontend tests. The public testnet evidence covers the single-bucket payout above. The v9 local demo shows the three-bucket waterfall routing 700 dUSDC and retaining 300 dUSDC. [Local loop evidence](../deployments/31337.evidence.json)

**GitHub / GitLab / Bitbucket**

> `https://github.com/louisluo0301-cell/payday-split`

**Video**

> 1:53, v9 dashboard on local Anvil, with English narration and embedded English subtitles. [MP4](https://raw.githubusercontent.com/louisluo0301-cell/payday-split/main/docs/payday-split-demo.mp4)

**AI assistance**

> Codex operated the browser during the recording and generated the English narration and subtitles. The recording was checked against the Anvil transaction receipts, and the subtitled export was checked against the original audio. The payout follows the configured Solidity rules.

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

1. Run `forge test` from the repository root and `npm test` from `web`.
2. Open the three public testnet transactions above. The Sepolia callback shows a 300 dUSDC payout and 700 dUSDC retained.
3. Play the v9 video or follow the [local reproduction steps](workspace/README.md). The local callback routes 300 + 250 + 150 dUSDC and retains 300 dUSDC.

---

## Submission checklist

- [ ] Public GitHub repo, MIT, no `.env`/private keys.
- [ ] `deployments/<chainId>.json` filled; `web/public/deployments.json` matches.
- [x] Three successful transaction receipts checked through public Sepolia and Lasna RPCs.
- [x] Video re-recorded for the v9 UI, under 3:00, with English narration and subtitles.
- [x] README includes the deployed addresses and transaction references.
- [ ] DoraHacks Build created; track = Set It and Forget It.
- [ ] Submit before **2026-12-06 04:00 Beijing time** (2026-12-05 20:00 UTC).
