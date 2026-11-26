> Historical script for the earlier waterfall UI. The 1:53 v9 recording uses the Anvil workspace with English narration and embedded English subtitles. [Current video](https://raw.githubusercontent.com/louisluo0301-cell/payday-split/main/docs/payday-split-demo.mp4)

# 3-minute demo video script — Reactive Income Waterfall

**Target length:** 2:50–3:00. **Format:** 1920×1080, 30 fps. **Language:** Chinese narration + English subtitles.

> The 2:57 waterfall recording and the earlier savings-only recording are available in Git history.

---

## Pre-record checklist

- [ ] Local Anvil demo or testnet deployment is ready.
- [ ] `?demo=1` opens with sample data and no wallet (judge quick path).
- [ ] `?local=1` dashboard shows the 3-bucket Freelancer preset.
- [ ] Faucet cooldown is clear; allow balance is set; callback budget > 0.
- [ ] Explorer tabs: origin `Transfer`, Lasna `react()`, destination `Split`/`Retained`.
- [ ] Terminal: `forge test` (62 passed) visible.
- [ ] Browser zoom 100%; clean desktop.

---

## Timeline

### 0:00–0:18 — Hook

**Visual:** hero card showing $4,200 split into Rent / Tax / Savings / Spending.

**On-screen text:** `Four decisions. Every single payment.`

**Narration (CN):**
> 自由职业者的收入是不规律的。每次到账，你都要做四个决定：先留房租，再预留税，再存一点，剩下的才是能花的。PaydaySplit 把这四个决定，变成一次设置。

**English subtitle:** Irregular income means four decisions every time: rent, tax, savings, spending. PaydaySplit makes those decisions once.

---

### 0:18–0:40 — What it is

**Visual:** the 3-step diagram; cursor over the waterfall bar.

**On-screen text:** `One ordered waterfall. One callback.`

**Narration (CN):**
> 你设置一个有序的 bucket 列表。默认 preset 把固定账单放前面，然后按毛收入的百分比预留税和储蓄，剩下的留在钱包里。Reactive Network 监听收入到账的 Transfer 事件，在 Lasna 上镜像你的规则，然后回调目标链，一次执行整条 waterfall。

**English subtitle:** Set an ordered bucket list. The default preset puts fixed bills first, then percentages of gross income for tax and savings, and the rest stays in your wallet. Reactive mirrors the rule on Lasna and runs the whole waterfall in one callback.

---

### 0:40–1:30 — Live demo

**Visual:** connect wallet; dashboard; choose Freelancer preset; show buckets: rent 300 fixed, tax 25%, savings 15%; edit one value; save; approve; claim.

**On-screen text (lower third):** `1. Build buckets → 2. Approve → 3. Claim income`

**Narration (CN):**
> 这是实时仪表盘。连接钱包。选择 Freelancer 预设：房租固定 300，税 25%，储蓄 15%。你可以拖动优先级、改金额、加第四个去向，最多 8 个。保存规则，Lasna 会把 bucket 列表和版本号镜像过去。然后授权一次，合约只能动你明确授权的额度。最后，领一笔 1,000 的演示收入。这是一笔真实的 ERC-20 Transfer。

**English subtitle:** This is the live dashboard. Connect. Pick the Freelancer preset: rent 300 fixed, tax 25%, savings 15%. Reorder, edit amounts, add up to 8 buckets. Saving the rule mirrors the bucket list and version on Lasna. Approve once, then claim a 1,000 demo income — a real ERC-20 Transfer.

---

### 1:30–2:05 — The waterfall runs

**Visual:** activity card updates with four rows: Rent vault +300, Tax reserve +250, Savings +150, Stayed in wallet 300. Click the transaction.

**On-screen text:** `1,000 in → 700 routed → 300 retained`

**Narration (CN):**
> 几秒钟后，回调到达。房租先拿 300，税预留 250，储蓄 150，剩下的 300 留在钱包里。四行记录，一笔回调。没有 keeper，没有表格，也没有每月手动转账。如果某个收款方失败，只会跳过那一个 bucket，其他仍然执行。

**English subtitle:** Seconds later the callback lands: rent 300, tax 250, savings 150, and 300 retained. Four rows, one callback. No keeper, no spreadsheet, no manual transfers. If one payee fails, only that bucket is skipped; the rest still run.

---

### 2:05–2:35 — Architecture + team mode

**Visual:** loop diagram; then the same dashboard with three fixed buckets labeled Designer / Developer / Ops.

**On-screen text:** `Personal income · Team payroll · Same contract`

**Narration (CN):**
> 链上只有三步：收入 Transfer，Lasna 上的 react，目标链的 executeSplit。规则带版本号，旧回调不会套用新规则。同一套合约也能做团队工资：金库设置三个固定 bucket，回款一到，一次回调把工资全部发出去。

**English subtitle:** Three steps: the income Transfer, `react()` on Lasna, and `executeSplit` on the destination. Rules are versioned, so stale callbacks cannot apply a new rule. The same contract runs team payroll: a treasury sets fixed buckets; one funding event pays everyone.

---

### 2:35–3:00 — Safety + close

**Visual:** security section; `forge test` output 62 passed; repo URL.

**On-screen text:** `Non-custodial · 8 buckets · 100% cap · versioned · replay-proof`

**Narration (CN):**
> 它是非托管的：合约从不持有你的本金，只在你授权的额度内操作。最多 8 个去向，百分比总和不超过 100%，每个 bucket 都受 paycheck 上限约束。回调有两道校验，规则有版本号，同一笔收入有重放保护。62 个测试全部通过。设置一次，之后每一笔收入都先付给最重要的事。

**English subtitle:** Non-custodial: the contract never holds principal and only moves within your allowance. Up to 8 buckets, 100% cap, every payout capped by the paycheck. Two callback checks, versioned rules, replay protection. 62/62 tests pass. Set it once; every income pays what matters first.

---

## 60-second cut

1. 0:00–0:08: four decisions every payment.
2. 0:08–0:20: one ordered waterfall, one callback.
3. 0:20–0:45: preset → save → claim → four activity rows.
4. 0:45–0:52: architecture (3 steps).
5. 0:52–1:00: security + 62 tests + repo.

---

## B-roll

- `forge test` with 62 passing tests.
- `getRule` on Lasna showing 3 payees + version + `subscribed=true`.
- `Split` events for rent/tax/savings and one `Retained`.
- The team-payroll variant of the dashboard.

---

## Post-production

- Burn in English subtitles (ASS, 34 px, bottom center).
- Show the three hashes for 5 seconds at 2:05.
- Do not speed up the moment the waterfall lands.
- Export H.264 MP4, ≤ 3:00, ≤ 200 MB.
- Upload unlisted and paste the link into `docs/SUBMISSION.md`.
