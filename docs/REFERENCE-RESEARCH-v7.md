# GitHub 相似项目研究与 PaydaySplit v7 落地

检索及源码核对：2026-11-18。精确提交和文件见 [reference-projects-v7.json](reference-projects-v7.json)。以下是独立设计参考，没有复制这些项目的合约实现，也没有宣称已集成它们。

## 相似点、差异与采取的改进

| 项目与固定版本源码 | 可参考的设计 | PaydaySplit 的处理 |
|---|---|---|
| [0xSplits Waterfall](https://github.com/0xSplits/splits-waterfall/blob/f13f3e15511d848ee976ea306dcc17c67b733ce1/src/WaterfallModule.sol) | 按层级分配，以及待提取余额与提取动作分离 | 保留优先级瀑布；目标进度按稳定桶身份记账，排序不会重新支付已满目标。该项目有托管/领取账本，不能直接替换当前钱包授权直付模式 |
| [0xSplits PushSplit](https://github.com/0xSplits/splits-contracts-monorepo/blob/23e9ef64c918205214fc23b2ff89fa590a32efc2/packages/splits-v2/src/splitters/push/PushSplit.sol) 与 [PullSplit](https://github.com/0xSplits/splits-contracts-monorepo/blob/23e9ef64c918205214fc23b2ff89fa590a32efc2/packages/splits-v2/src/splitters/pull/PullSplit.sol) | 推送分配和仓库领取两种架构；按共同基数计算份额 | 新增 ProRata：从同一个可用预算 B 计算所有份额；失败、封顶和舍入释放额留存，避免后续桶被意外放大；没有引入托管仓库 |
| [LlamaPay](https://github.com/LlamaPay/llamapay/blob/90d18e11b94b02208100b3ac8756955b1b726d37/contracts/LlamaPay.sol) | 区分已结算时间、余额和工资负债 | 明确“已付进度”与“周期”语义；编辑目标保留进度，改变周期配置才开启新账期。PaydaySplit 不是按秒产生工资债务的流式协议 |
| [Sablier Flow](https://github.com/sablier-labs/flow/blob/a0faf196c3ac684d69ba285f2abb14f4988b4732/src/SablierFlow.sol) 与 [资产假设](https://github.com/sablier-labs/flow/blob/a0faf196c3ac684d69ba285f2abb14f4988b4732/SECURITY.md) | 快照时间/债务、可提取额与资产兼容假设明确分开 | 补充代币支持边界：标准 ERC20、转账无扣税、无 rebase；未读取到余额/授权时按零可用资金处理。未来工资流适配器只把已提取实收额作为收入，不能直接分配累计应收债务 |
| [Superfluid SuperTokenV1Library](https://github.com/superfluid-org/protocol-monorepo/blob/d5296cd2362cea8b38cc7c4cba26bad9833fb665/packages/ethereum-contracts/contracts/apps/SuperTokenV1Library.sol) | 专用流速/协议调用接口，不能把持续余额变化当普通离散付款 | 当前继续监听离散 ERC20 Transfer；未来采用专用适配器和实收事件。持续流入通常不会每秒产生 Transfer，现有监听不等于已经支持流式工资 |
| [Reactive Omni AbstractCallback](https://github.com/Reactive-Network/reactive-lib-omni/blob/3ade0dcf1d27e67e5783ef807e73a1b9e0c0cce8/src/base/AbstractCallback.sol) 与 [IReactive](https://github.com/Reactive-Network/reactive-lib-omni/blob/3ade0dcf1d27e67e5783ef807e73a1b9e0c0cce8/src/interfaces/IReactive.sol) | 回调发送者认证与 Omni 日志结构 | 保留 Proxy 调用者和注入 Reactive 地址的双校验；日志结构不带来源时间，v7 固定周期明确按目标链执行时间计算，避免虚构来源时间 |
| [Reactive CronDemo](https://github.com/Reactive-Network/reactive-smart-contract-demos/blob/6fd02ce56d110762b9cecbacbf4374aa5951d491/src/demos/cron/CronDemo.sol) | 用系统周期事件驱动定时工作 | 所查示例仍含旧版 `vmOnly/topic_0` API，仅参考模式；不复制到 Omni。本轮用懒重置，无收入时不付定时回调费；未来有界重试可另做 Omni cron 适配 |

## 已落实的可靠性优化

1. ProRata 与 Waterfall 共用权限、目标和预算约束，模式切换递增规则版本，使旧回调失效。
2. `setBucketsWithIds` 支持增删、排序和权重修改。身份只能在同一用户/资产下复用且收款方不能改变；新收款方必须获得新 ID。
3. 固定周期支持 1–365 天，界面提供每周、两周、30 天；不是自然月。目标进度到期按需归零，所有执行仍共享目标链当天的日限额。
4. ERC20 读取限制 30,000 gas，单桶自调用限制 120,000 gas，恶意收款路径耗尽 gas 时不拖垮后续桶；请求回调预算为 1,500,000 gas。
5. 备份版本 2 保存模式与周期；只恢复草稿。链上分配 ID 返回后保留导入目标草稿，不伪造已付记录。
6. 部署示例改用有限授权，修复数值截断、环境注释读取和验证查询参数丢失。

## 后续模块的边界

失败任务队列需要保存每桶已付/待付、规则版本、事件 ID、有效期、取消权及原周期。不能直接重放一次完整瀑布，否则已成功的桶可能再次付款。当前 `recoverSplit` 只恢复未消费的来源键；已跳过的桶没有自动重试。

桥、流式工资和生息应各自作为可关闭的独立适配器，主分账路径不依赖它们。先在测试网验证实收、退出和重复投递，再接入用户主资金。

## 许可证与证据

0xSplits 文件标识 GPL-3.0-or-later；LlamaPay 所查文件标识 None；Sablier 所查核心为 BUSL-1.1；Superfluid 所查库文件为 MIT，但不能据此推断整个仓库统一许可证；Reactive 所查文件为 UNLICENSED。GitHub API 的 null/NOASSERTION 不表示允许任意复制。若以后复用源码，须逐文件确认许可和依赖义务。当前保留既有依赖许可，新逻辑独立编写。

研究没有继承参考项目的审计结论。验证记录见 [TESTING.md](TESTING.md)，自身勘误见 [CODE-REVIEW-v7.md](CODE-REVIEW-v7.md)。
