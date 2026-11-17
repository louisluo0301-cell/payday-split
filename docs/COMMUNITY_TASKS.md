# 社区开放任务（5 个方向）

> 这 5 个方向来自比赛展示页的「补充方向」，与 DoraHacks 主赛道提交相互独立。下面给出可直接改成帖子/文档的草稿。所有观点来自本次 PaydaySplit 的实测（Sepolia + Lasna + Foundry + 本地 Anvil），不是二手转述。

---

## 1. Reactive 使用体验反馈

### 1.1 实际踩到的 5 个摩擦点

1. **文档地址前后矛盾。** 同一份文档里系统合约同时出现 `0x…fffFfF` 和 `0x8888…8888`；Omni 升级后测试网 Callback Proxy 全换，但搜索到的旧教程、旧 README、AI 训练数据仍是旧地址。旧 Proxy 有代码但不投递，表现是「react 成功、回调永远不来」，极难排查。
2. **`reactive-lib-omni` 的示例太少。** 动态 `subscribe` / `unsubscribe`、`RuleSet` 这类「用事件把配置镜像到 Reactive 侧」的模式几乎没有完整示例；文档只在 Reactive Contracts 页用一段话说「可以在 react() 里改订阅」。真正写起来，订阅参数六元组必须完全一致，否则静默失败，没有链上回执。
3. **调试链路长。** 订阅没匹配上时，链上只能看到 `lastReactBlock=0`；没有「为什么没匹配」的查询。`cast run` 能看 react 交易，但需要先知道交易哈希；Reactscan 的筛选器对新手不够直观。
4. **费用模型是「静默失败」。** `debt > 0` 后合约收不到任何事件，也没有主动通知；回调失败也收费；Cron 每个 tick 都收费。对个人开发者，最需要的是「余额/欠费/剩余回调」一眼可见。
5. **AI 生成代码的污染。** 让 LLM 写 Reactive 合约，默认会产出旧版 `vm` / `emit Callback` / `0xfffFfF` 写法。需要把「Omni 写法」作为系统提示词，并给出一个可直接编译的模板。

### 1.2 建议

- 官方维护一个 **canonical `reactive.config.json`**：chainId、system、proxy、topic 常量、示例地址，一份文件解决「地址到底是哪个」。
- 在 Reactscan 加一个 **subscription inspector**：输入合约地址，列出节点侧保存的订阅六元组（目前合约读不回来）。
- 提供 **`forge` 模板**：`event → react → callback` 一条命令生成，内置 MockSystem/MockProxy（我们已经在 `test/PaydaySplit.t.sol` 里实现，可直接复用）。
- 错误信息区分「订阅未匹配」「余额不足」「回调 gas 不足」「Proxy 地址错误」，不要让四种情况都表现为「什么都没发生」。
- 文档给一个 **动态订阅** 的完整例子（用户级订阅、按事件增删），这是 Omni 相对旧版最有价值的能力之一。

### 1.3 本次实测数据

- Sepolia → Lasna → Sepolia，本地 Anvil 全链路一次通过；
- 25 个 Foundry 测试覆盖订阅、鉴权、阈值、重复回调、额度、暂停、fuzz；
- 单次 `react()` + 回调在测试网的成本量级：lREACT 约 0.015/次，回调 gas 由目标链合约付。

---

## 2. Use-case Proposal

### 2.1 已提交：PaydaySplit — Reactive Income Waterfall（Track 2）

一笔收入按优先级自动分账：固定房租/账单先付，再按毛收入百分比扣税、储蓄、投资，剩余留存。最多 8 个 bucket，支持固定额+百分比、版本化规则、一次回调执行整条 waterfall。非托管。同一套合约也支持团队工资/金库分账。详见仓库 README。

### 2.2 另外 4 个适合 Reactive 的方向

| 方向 | 源事件 | Reactive 侧判断 | 目标链动作 | 为什么适合 |
|---|---|---|---|---|
| **Reactive Payroll** | 雇主批量转账 / 工资单合约 `PayrollCreated` | 按员工、币种、周期拆分；检查预算 | 给每个员工发薪 / 发稳定币 | 一次事件触发多笔支付，Reactive 做 fan-out，目标链只执行 |
| **LP 止损 / 止盈** | DEX Pool `Swap` / `Sync` 或预言机 `AnswerUpdated` | 价格穿越阈值、冷却时间、单日次数 | 撤池 / 换回稳定币 | 时间敏感；Reactive 的 ~1s 区块比 keeper 轮询更贴近事件 |
| **订阅制收款** | 商户 `InvoiceCreated` / Cron | 到期、金额、用户授权 | 从用户 vault 扣款 | 事件驱动 + 无需商户自建 bot；Cron 只作为兜底 |
| **DAO 国库再平衡** | 国库 `Transfer` / 预言机价格 | 稳定币占比偏离目标区间 | 在 DEX 上调仓 | 规则公开可审计；Reactive 不持有国库资产 |

### 2.3 选题判断标准

一个方向适不适合 Reactive，看三点：

1. **触发是事件，不是纯时间**：有明确的链上日志可订阅。
2. **跨链/跨合约有真实价值**：不是同一个合约里一个 `if` 就能解决。
3. **失败可接受**：回调失败不会造成不可逆损失，或者有 pause/限额兜底。

---

## 3. Builder Demo Video

3 分钟脚本已写在 [`docs/DEMO.md`](DEMO.md)，包含逐秒画面、中文口播、英文字幕、60 秒剪辑版和录制检查清单。结构：

1. 0:00–0:18 痛点：储蓄是每次都要做的决定。
2. 0:18–0:40 方案：设置一次，Reactive 监听 `Transfer`。
3. 0:40–1:25 现场：连接、设规则、授权、领工资。
4. 1:25–1:55 结果：`Split` 落地，余额变化。
5. 1:55–2:25 三笔链上交易。
6. 2:25–3:00 安全 + 仓库。

---

## 4. Focused Competitor Usage Comparison

> 定性对比，重点看「触发模型 / 跨链 / 运维 / 成本 / 开发体验」，不比较具体报价。

| 方案 | 触发模型 | 跨链执行 | 谁付 gas / 运维 | 适合 | 不适合 |
|---|---|---|---|---|---|
| **Reactive Network** | 订阅任意 EVM 链日志，`react()` 里写 Solidity | 原生：Lasna 上判断，回调目标链 | 合约预付 lREACT；回调方付目标链 gas；无 keeper | 事件驱动、跨链、需要链上可审计规则 | 需要极复杂链下计算、需要私有数据 |
| **Chainlink Automation** | 时间/条件触发，keeper 网络 | 需要在目标链注册 upkeep；跨链要额外桥 | 项目方预付 LINK；keeper 执行 | 单链定时任务、成熟生态 | 多链事件编排、细粒度事件订阅 |
| **Gelato Web3 Functions** | 定时/链上条件，链下函数 | 多链支持，但逻辑在链下 | 项目方付 GELATO；需要维护函数 | 链下 API 调用、复杂计算 | 纯链上可验证规则、无信任执行 |
| **OpenZeppelin Defender** | 链下 monitor + relayer/actions | 多链 relayer | 项目方付订阅 + gas；需要服务器/密钥 | 运维成熟、告警、权限管理 | 去中心化执行、无运维 |
| **Envio / Ponder 等 indexer** | 只读索引 | 不执行 | 项目方自建 | 数据看板、通知 | 自动执行交易 |
| **Safe modules / 4337** | 用户签名 / bundler | 依赖 bundler/paymaster | 用户或 paymaster | 账户抽象、社交恢复 | 事件驱动的自动执行 |

**结论：**

- 如果需求是「链上事件 → 链上动作」且希望规则公开可审计，Reactive 的模型最直接；keeper 方案要么依赖中心化运维，要么需要把逻辑放到链下。
- 如果需求是「每天定时跑一个脚本 / 调 API」，Gelato/Defender 更成熟。
- 如果只是「看数据、发通知」，indexer 足够，不需要 Reactive。
- Reactive 的代价是：学习新的订阅/回调模型、管理 lREACT 余额、回调失败仍收费。这些是产品要补齐的 UX。

---

## 5. Chinese Developer Channel Map

### 5.1 渠道分层

| 层级 | 渠道 | 适合内容 | 频率 | 备注 |
|---|---|---|---|---|
| **私域** | 微信群、Telegram 群 | 答疑、打卡、活动通知 | 每日 | 需要群规/防钓鱼；官方从不先私信 |
| **实时** | X / Twitter、Farcaster / Warpcast | 短更新、交易截图、Space | 每周 3–5 条 | 英文为主，中文项目方可双语 |
| **中文社区** | 即刻、小红书、知乎 | 科普、踩坑、教程 | 每周 1–2 篇 | 小红书适合「小白自动化」叙事 |
| **长视频** | Bilibili、YouTube | 3 分钟 demo、 workshop 回放 | 每两周 | 标题带「Reactive / 链上自动化」 |
| **图文技术** | 掘金、CSDN、SegmentFault、Mirror | 架构、代码、安全 | 每月 2 篇 | 掘金/CSDN 搜索流量；Mirror 做存档 |
| **开源** | GitHub、Gitee | 模板、示例、issue | 持续 | README 中英双语；Issue 模板 |
| **开发者组织** | OpenBuild、LXDAO、Rebase、TinTinLand、706、WCB | workshop、共学、黑客松 | 每季度 | 适合联合办「Reactive 自动化」主题 |
| **高校** | 高校区块链社团（清北复交、浙大、港校等） | 入门课、demo day | 每学期 | 用测试网 + 零托管故事降低门槛 |
| **黑客松** | DoraHacks、Devfolio、ETHGlobal | BUIDL、track | 按赛事 | 提前 2 周预热，赛后复盘 |

### 5.2 4 周内容节奏（示例）

| 周 | 主题 | 渠道 | 产出 |
|---|---|---|---|
| W1 | 「什么是链上自动化」科普 | 小红书 / 即刻 / X | 1 篇图文 + 1 条 thread |
| W2 | 「30 分钟跑通 event → react → callback」 | Bilibili / YouTube / 掘金 | 视频 + 代码仓库 |
| W3 | 「PaydaySplit：收入到账，自动分账」demo | X / Farcaster / 微信群 | 3 分钟视频 + 交易哈希 |
| W4 | 「Reactive vs keeper：什么时候该用谁」 | 知乎 / Mirror / 掘金 | 对比长文 + 直播 |

### 5.3 内容原则

- 先给可运行的东西（repo / 测试网交易），再讲概念。
- 所有教程用测试网 + 一次性钱包；明确「不要用主钱包」。
- 不承诺收益、不写「空投」；避免钓鱼号借题发挥。
- 中文内容保留英文关键词（Reactive、Lasna、Callback Proxy），方便搜索。
- 每篇文末固定 CTA：报名链接 / 仓库 / 群二维码（用官方素材）。
