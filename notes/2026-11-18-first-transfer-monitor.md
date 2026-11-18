---
title: 第一次部署：Sepolia 转账触发 Lasna react
type: note
tags: [reactive-omni, lasna, sepolia, builder-camp, submitted]
---

# 第一次部署：Sepolia 转账触发 Lasna react

记录日期：2026-11-18（Asia/Shanghai）。用户已报告在营地完成提交；本记录核验了真实链上执行，平台审核结果尚未核实。

## 地址与交易

| 项目 | 记录 |
|---|---|
| 测试钱包 | `0x90D2A64b86cB547d729ce61101FcD835d512e55a` |
| Sepolia RCT 代币 | [`0x5a6EaDc43049CC309eC1D4881090E2dbACfB2EDe`](https://sepolia.etherscan.io/address/0x5a6EaDc43049CC309eC1D4881090E2dbACfB2EDe) |
| Lasna 监听合约 | [`0xd1ad836170fBe9d5291D26BC372c4D81108d7378`](https://lasna.reactscan.net/address/0xd1ad836170fBe9d5291D26BC372c4D81108d7378) |
| 来源转账 | [`0x21ed5bc76f6eb16f5f5d7db5ee907beb82735082aab6968c4360d0280a722729`](https://sepolia.etherscan.io/tx/0x21ed5bc76f6eb16f5f5d7db5ee907beb82735082aab6968c4360d0280a722729) |
| react() 交易 | [`0x58119dd10f92acd967dcd3931c396fa855af3f8977a905e3ad5cd3d235a45c6b`](https://lasna.reactscan.net/tx/0x58119dd10f92acd967dcd3931c396fa855af3f8977a905e3ad5cd3d235a45c6b) |
| 来源区块 / logIndex | `12160493` / `8` |
| Lasna 执行区块 | `8640739` |

订阅过滤条件：只监听 Ethereum Sepolia（11155111）上上述 RCT 代币的标准 ERC20 Transfer；单笔金额严格超过 0.5 RCT 才计数。实际向自己转账 1 RCT，成功处理 1 次后自动退订。部署充值 0.1 lREACT 的设置来自本次部署页面与截图记录。

## 已核验结果

- [result] 来源交易成功，Transfer 的 from/to 均为上述测试钱包，金额 `1000000` 基准单位，即 1 RCT（6 位小数）。
- [result] Lasna react 交易成功，观察事件引用了同一个来源交易及 logIndex。
- [result] `count = 1`，`remaining = 0`，`subscribed = false`；同笔真实交易发出了自动退订事件。
- [result] 核验时合约余额 `0.0713306 lREACT`，系统欠费 `0`，预付储备 `0`。余额是核验时快照，不是以后每次执行的费用承诺。
- [status] 用户已完成营地提交；审核结果尚未核实。

机器证据：[camp-transfer-monitor.json](../deployments/camp-transfer-monitor.json)。用户提供的完成截图：[camp-transfer-monitor-result.png](../docs/camp-transfer-monitor-result.png)。复现与源码：[CAMP-TRANSFER-MONITOR.md](../docs/CAMP-TRANSFER-MONITOR.md)。

这次证据覆盖了测试代币 Transfer → Reactive 系统执行 → 自动退订。PaydaySplit 收入瀑布核心的真实目标链回调与分账仍需单独部署和验收。
