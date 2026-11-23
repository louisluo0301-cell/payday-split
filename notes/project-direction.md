# PaydaySplit 黑客松项目方向卡

## 1. 一句话方向

Lasna 上的 Reactive Omni 合约监听 Ethereum Sepolia 上指定 ERC-20（演示用 dUSDC）转入用户钱包的 `Transfer` 事件。当该钱包已启用分账规则、到账金额达到门槛且回调预算充足时，Lasna 向 Ethereum Sepolia 发起一次回调。目标链合约在有效授权和限额内依次分配房租、税务预留和储蓄，余额留在用户钱包。

## 2. 参赛赛道

**赛道 2 · Set It and Forget It（个人自动化）**。用户连接钱包、配置分账规则并授权一次。之后每笔符合条件的收入到账都会触发自动分账，用户可以在工作台查看分账和留存明细。

## 3. 目标用户与真实场景

首批用户是收取稳定币的自由职业者和创作者。例如，设计师按项目收款，金额和时间都不固定，但每月都要付房租、预留税款和存钱。目前通常靠表格或记账工具计算，再打开钱包手动转账。忙的时候容易漏掉其中一笔。PaydaySplit 在每笔收入到账时按预设顺序执行，并记录每个资金桶的实际到账金额。

## 4. 第 2 周最小演示

1. 在 Ethereum Sepolia 用钱包保存并启用三个资金桶：房租固定 300 dUSDC，税务预留为当笔收入的 25%，储蓄为 15%。为分账合约授权 1,000 dUSDC。
2. 从另一钱包向用户钱包转入 1,000 dUSDC。Lasna 合约的 `react()` 捕获这笔 `Transfer`，请求回调 Ethereum Sepolia 的分账合约。
3. 核对三段交易以及目标链的 `Split` 和 `Retained` 事件。预期房租 300、税务预留 250、储蓄 150，剩余 300 dUSDC 留在用户钱包。用来源交易哈希和日志索引对应付款明细，重复处理同一事件时应保持同一组结果。

这条链路已在本地 Anvil 模拟环境复现，第二个钱包也通过了自动分账和重复处理校验。单桶最小版本也已在 Sepolia 与 Lasna 完成真实分账，分出 300 dUSDC 并留存 700 dUSDC。[三段交易与时序图](../README.md#最小分账闭环)。[本地三段演示记录](../deployments/31337.evidence.json) · [双钱包实测](../docs/workspace/integration/browser-local-evidence.json) · [独立监听作业](./2026-11-18-first-transfer-monitor.md)

## 5. 参赛形式

个人参赛。GitHub 账号 `louisluo0301-cell` 负责合约、前端、测试和演示交付。

## 报名凭证

DoraHacks 待报名。[Reactive Omni Buildathon 官方报名页](https://dorahacks.io/hackathon/reactive-omni-buildathon/detail)
