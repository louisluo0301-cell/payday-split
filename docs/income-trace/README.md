# 单笔收入追踪与恢复

当一次自动分账迟迟没有出现在历史里，用户需要区分到账、回调已请求、目标链已处理和查询失败。PaydaySplit 把这些阶段放在同一笔收入的证据卡里。输入来源交易哈希即可检查。批量交易有多个匹配的到账日志时，先按实际金额和日志序号选定一笔。

## GitHub 参考

| 项目 | 借鉴做法 | PaydaySplit 的落地 |
| --- | --- | --- |
| [Request Network](https://github.com/RequestNetwork/requestNetwork/tree/master/packages/payment-detection) | 用链上付款记录核对请求 | 从 ERC-20 收据提取真实金额、收款钱包、代币和日志序号，恢复金额独立于仪表盘的试算金额 |
| [Safe Transaction Service](https://github.com/safe-global/safe-transaction-service#history) | 区分链上状态与索引可见性 | 用准确的事件键查 Lasna 请求、目标链处理标记。近期日志缺失时显示证据边界，方便排查 |
| [Cascade Splits](https://github.com/cascade-protocol/splits/blob/main/docs/specification.md) | 把分账恢复和防重复作为同一个设计问题 | 用户恢复和延迟回调共用 PaydaySplit 已有的去重键，已处理收入只显示结果 |
| [Actual Budget](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/api/reference.md#split-transactions) | 保留原交易与拆分明细的关系 | 同一目标交易下的不同来源日志分别展示，保留各自的付款、留存、跳过桶及规则版本 |

这些项目提供设计参考。PaydaySplit 的组合是让用户从任意一笔收入查到自动化进度，并沿同一条证据安全恢复。功能无需新的托管合约或索引服务。

## 操作

1. 打开仪表盘的 **Income trace**。也可在已有分账卡上点 **Trace income**，自动定位来源。
2. 连接支持的部署，输入到账交易哈希，点 **Inspect transfer**。确认是这笔收入的金额和日志后，分别查看收入、回调和目标链结果。
3. 如该日志尚未处理，且当前规则能实际分出正数，面板展示收款人、金额和留存。点 **Recover this income once** 会重新读取来源和分账预演。金额或规则有变需要重新查看，重复处理会保留已有结果。
4. **Download trace JSON** 下载来源、回调状态、目标链记录及当前预演。代币基础单位用十进制整数字符串保存。

无钱包演示可以打开 `/?demo=1#income-trace`，选择 **Load sample trace**。它展示回调已请求但尚未分账的一笔样例。

## 状态判断与范围

- 来源与目标是同一条配置链，Lasna 的读取校验实际网络。只匹配成功收据中流向当前钱包的配置 ERC-20，排除自转和零值。演示代币的增发也属于有效到账。
- Lasna 回调记录匹配源哈希和日志序号。近期 1,001 个区块以内可附上匹配的 `Seen` 交易。目标链处理状态来自合约映射，付款记录来自最近 5,001 个区块；历史查询失败时仍可识别是否已处理。
- **已处理**也可能表示全额留存，金额来自对应日志。目标链确认前的预演会受到余额、授权、周期和规则变化影响。
- 钱包签名前核对收据区块、实际到账额、钱包、网络和最新预演。底层 `recoverSplit` 仍允许用户从自己的余额发起恢复，来源核验由网页完成。已处理收入的个别跳过桶暂不支持单独重试。

## 验证

36 个前端测试覆盖批量选择、精确金额、已处理拦截、预演变化后阻止签名，以及原有功能。浏览器在 390 和 1440 像素宽度验收。本地 Anvil 用实际 PaydaySplit 合约和模拟 Reactive 系统与回调代理验证了下列流程。

| 本地案例 | 结果 |
| --- | --- |
| 1,000 dUSDC 经自动回调 | 分出 700，留存 300，面板从活动卡定位到原到账日志 |
| 1,120.123456 dUSDC 回调已请求 | 网页预演分出 748.049382，留存 372.074074 |
| 上述第二笔从浏览器发起恢复 | 实际分账与预演一致，导出证据匹配对应请求和目标交易 |
| 恢复后再投递原回调 | 收款方余额未增加，付款仍为原来三条 |

[手机演示](mobile-sample.png) · [回调已分账](local-completed.png) · [恢复预演](local-recovery-preview.png) · [本地浏览器与链上记录](browser-local-evidence.json)
