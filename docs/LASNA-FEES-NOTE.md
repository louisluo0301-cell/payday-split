# Lasna 费用机制：实测与理解

查询时间：2026-11-17 21:29:22（北京时间）。网络 Lasna，chainId 5318007；固定区块 **8573855**。以下为实际执行的三条 cast 命令与输出，不是文档默认值。

```text
cast call 0x8888888888888888888888888888888888888888 '_gasPriceCoeffPer1000()(uint256)' --rpc-url https://lasna-rpc.rnk.dev/ --block 8573855 --chain 5318007
1000

cast call 0x8888888888888888888888888888888888888888 '_extraGas()(uint256)' --rpc-url https://lasna-rpc.rnk.dev/ --block 8573855 --chain 5318007
100000 [1e5]

cast call 0x8888888888888888888888888888888888888888 '_maxChargeGas()(uint256)' --rpc-url https://lasna-rpc.rnk.dev/ --block 8573855 --chain 5318007
50000 [5e4]
```

结构化原始记录：[lasna-fees.json](../deployments/lasna-fees.json)。参数可由管理员调整，本记录仅代表指定区块。重新查询：`pwsh ./script/read-lasna-fees.ps1`（cast 需在 PATH）。

## 1. 一次 react() 的费用怎么算？

`fee = max(tx.gasprice, block.basefee) × (1000 / 1000) × (实际执行 gas + 100000)`。

系数是 1，不能把读到的 1000 直接再乘一千倍。假设基础 gas 价格为 100 gwei、执行消耗 50,000 gas，费用为 0.015 lREACT；这是计算示例，不是实测某笔交易收费。`_maxChargeGas = 50000` 是结算时调用 `pay()` 的 gas 预算，不是费用公式中的上限，也不是 react() 执行 gas 上限。依据：[官方费用模型](https://dev.reactive.network/economy)。

## 2. balance、reserves、debt 分别是什么？为什么一点 debt 也会停？

balance 是合约自身可用的原生币；reserves 是系统/代理代管的预付手续费；debt 是已经发生但尚未结清的费用。收费先扣 reserves，充值到系统的指定账户先还债，再形成预付余额。网络在执行前检查 debt，只要大于零就暂停服务，避免继续产生未付款的执行成本。

直接给合约转币只增加 balance，不会自动清掉已存在的 debt；还需 `coverDebt()`，或使用系统/目标链代理的 `depositTo(合约地址)`。Reactive 侧支付 lREACT，目标链回调支付目标链原生币。依据：[官方余额与结算说明](https://dev.reactive.network/economy)。

## 3. react() 回滚还收费吗？对设计有什么影响？

仍收费：系统捕获回滚并按已消耗 gas 加固定附加项计费，状态回滚不等于计算免费。因此我的 PaydaySplit 尽早用条件和 `return` 过滤无关事件，限制 bucket 数量并去重；异常资金转账隔离在子调用内。还要检查双方欠费与原生币，并保留偿债入口。过滤本身仍消耗 gas，不应描述成免费。依据：[官方事件处理说明](https://dev.reactive.network/reactive-contracts)。

## 交付状态

三条查询与三问回答已完成，原始证据随公开仓库提供。公开笔记链接：https://github.com/louisluo0301-cell/payday-split/blob/main/docs/LASNA-FEES-NOTE.md 。营地网站尚未提交。
