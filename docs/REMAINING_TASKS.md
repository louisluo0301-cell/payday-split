# 后续待办（我无法替你完成的部分）

下面每一项都写清了「为什么需要你」「具体命令」「完成标准」。代码、测试、本地演示和文档已经就绪；这些是账户、资金、发布和录屏层面的操作。

---

## 1. 测试网部署（需要测试币与你的钱包）

**为什么需要你：** 我没有你的测试网资金，也不能替你登录 faucet / DoraHacks。

### 1.1 准备

- 使用一次性测试钱包（不要用主钱包）。
- 需要约 **0.06 Sepolia ETH**：
  - 0.01 ETH → lREACT；
  - 0.05 ETH → 部署 + 回调 gas。
- 领水：Google Cloud Sepolia faucet；或 pk910 PoW faucet。
- 换 lREACT：
  ```bash
  cast send 0x9b9BB25f1A81078C544C829c5EB7822d747Cf434 \
    --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
    --private-key $PRIVATE_KEY \
    "request(address)" <YOUR_ADDRESS> --value 0.01ether
  ```
- 约 1 分钟后检查：
  ```bash
  cast balance <YOUR_ADDRESS> --rpc-url https://lasna-rpc.rnk.dev/ -e
  ```

### 1.2 配置

```bash
cp .env.example .env
# 填 PRIVATE_KEY；确认 RENT_PAYEE / TAX_PAYEE / SAVINGS_PAYEE
# 确认 MIN_PAYCHECK（默认 1000000 = 1 USDC，6 位小数）
```

本地前端（不部署测试网也能演示）：

```bash
cd web
npm run dev        # ?demo=1 无需钱包
npm run local:watch # 已跑 local-demo 后，MetaMask 本地模式自动交付回调
```

### 1.3 部署

```powershell
pwsh ./script/deploy.ps1
```

或：

```bash
bash script/deploy.sh
```

### 1.4 验证 + 记录

```powershell
pwsh ./script/verify.ps1
```

需要记录：

- `PaydaySplitReactive` 地址（Lasna）
- `PaydaySplit` 地址（Sepolia）
- `DemoUSDC` / USDC 地址
- 三笔交易哈希：
  1. 源链 `Transfer`
  2. Lasna `react()`
  3. 目标链 `Split` / `Retained`

**完成标准：** `getBuckets` 返回 3 个 bucket；`getRule` 返回 3 个 payee、version 1、`subscribed=true`；目标链有 3 条 `Split` + 1 条 `Retained`。

---

## 2. 上传 v2 演示视频（视频已生成）

**为什么需要你：** 视频文件已生成（`docs/payday-split-demo.mp4`，2:57，本地 Anvil，中文旁白 + 英文字幕），但需要你的 YouTube/Loom 账号上传，拿到公开链接。

- 视频已生成：`docs/payday-split-demo.mp4`（2:57，本地 Anvil，中文旁白 + 英文字幕）。
- 你只需要上传到 YouTube unlisted / Loom，并把链接填进 `docs/SUBMISSION.md` 的 Video 字段。
- 如果之后做了测试网部署，可以按 `docs/DEMO.md` 重录一版测试网视频（可选，不是必须）。

**完成标准：** ≤ 3:00，画面里能看到真实 `Split` 结果或明确标注的本地结果，视频链接可访问。

---

## 3. 发布公开仓库（需要你的 GitHub 账号）

**为什么需要你：** 我没有你的 GitHub 凭据，也不能替你创建公开仓库。

```bash
cd "C:\Users\罗正\Desktop\Reactive Omni Buildathon\payday-split"
git remote add origin https://github.com/<YOUR_HANDLE>/payday-split.git
git branch -M main
git push -u origin main
```

然后：

- 确认 `.env` 没有被推送：`git ls-files | findstr .env` 只应有 `.env.example`；
- 把仓库链接填进 `docs/SUBMISSION.md`；
- 在 GitHub 仓库 About 里写一句简介 + 加 topics（reactive-network、lasna、solidity、foundry、defi、automation）。

**完成标准：** 公开可访问；`forge test` 在 CI 通过；README 里的链接可用。

---

## 4. 提交到 DoraHacks（需要你的账号）

**为什么需要你：** 需要登录 DoraHacks、创建 Build、粘贴地址/哈希/视频。

1. 在 DoraHacks 报名 Reactive Omni Buildathon。
2. 创建 Build：名称 `PaydaySplit — Reactive Income Waterfall`，Track `Set It and Forget It`。
3. 粘贴 `docs/SUBMISSION.md` 里的字段：
   - deployed addresses（Lasna + Sepolia）；
   - 三笔交易哈希；
   - GitHub 链接；
   - 视频链接；
   - 团队信息。
4. 截止：**2026-12-06 04:00 北京时间**（2026-12-05 20:00 UTC）。建议 12/04 前提交。

**完成标准：** DoraHacks 页面显示 submitted；所有链接可访问；Track 正确。

---

## 5. 可选但建议的增强

- **真实 USDC**：把 `TOKEN_ADDR` 设为 Sepolia/Base Sepolia USDC，重新部署；用真实转账测试。
- **团队模式 demo**：用 Safe/多签作为 treasury，设置 3 个固定工资 bucket；录一段 30 秒补充视频。
- **审计**：至少找一个人 review `PaydaySplit.executeSplit` 的 waterfall/allowance 边界。
- **主网**：不要直接上主网；先测试网 + 审计 + 多签 owner。
- **社区开放任务**：`docs/COMMUNITY_TASKS.md` 已给出 5 个方向的草稿，可改成帖子发到 X/即刻/掘金。

---

## 6. 当前已验证 / 未验证

| 项目 | 状态 |
|---|---|
| `forge test` 62/62 | ✅ 已验证 |
| 本地 Anvil 全链路（3 buckets + retained） | ✅ 已验证 |
| 前端 `npm run build` | ✅ 已验证 |
| 本地 waterfall UI（连接/预览/活动流） | ✅ 已验证 |
| Sepolia + Lasna 测试网部署 | ⏳ 需要你按第 1 节执行 |
| 测试网三笔交易哈希 | ⏳ 部署后产生 |
| v2 演示视频 | ✅ 已生成 `docs/payday-split-demo.mp4`（2:57，本地 Anvil）；如需测试网版本可重录 |
| GitHub 公开仓库 | ⏳ 需要你按第 3 节推送 |
| DoraHacks 提交 | ⏳ 需要你按第 4 节提交 |

---

## 7. 交付包里已经有什么

- `src/`：`PaydaySplit.sol`、`PaydaySplitReactive.sol`、`DemoUSDC.sol`
- `test/`：62 个 Foundry 测试
- `script/`：部署、验证、本地 demo
- `web/`：waterfall 编辑器 dashboard
- `docs/`：架构、安全、部署、演示脚本、提交草稿、社区任务
- `deployments/31337.evidence.json`：本地全链路证据
- `README.md`：一页看懂 + 快速开始
