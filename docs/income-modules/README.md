# PaydaySplit v9 收款与资金模块

仪表盘的 **Income modules** 提供失败桶重试、原生 ETH 收款地址、Aave V3 储蓄、消费冷静期和测试 USDC 跨链归集。这一版使用新的合约部署。旧计划可以导出后恢复为草稿，检查并保存到新地址。

| 模块 | 使用方式 |
| --- | --- |
| 失败桶重试 | 用户按资产启用。暂时失败的桶在原分账额度内入队，面板展示任务编号、次数和结果，可以取消 |
| 原生 ETH 收款 | 选用 WETH 作为分账资产，创建专用地址。收到原生 ETH 后自动包装并向用户转 WETH，触发同一套收入规则 |
| Aave V3 生息 | 创建并注册储蓄桶，将它加入分账计划。资金随分账供给 Aave，aToken 直接进入用户钱包 |
| 消费冷静期 | 选择 1 小时至 30 天，创建资金桶并加入计划。每次申请提现都须等待，到期释放或提前取消 |
| 跨链归集 | 支持 Circle CCTP V2 的 Base Sepolia → Ethereum Sepolia 测试 USDC。先签来源销毁，取得证明后签目标铸造，同一钱包收款 |

## 怎么启用

1. 本地跑 `pwsh ./script/local-demo.ps1` 时，脚本部署新分账合约、模块工厂和模拟 Aave 池，然后写入本地配置。它会重置本机 8545 上的 Anvil，请为演示使用可重置的本地环境。启动前端后从 `/?local=1#income-modules` 连接本地测试钱包。
2. 在相应面板创建模块。Aave 储蓄桶还需按 **Enable automatic supply** 注册，然后用 **Add savings destination** 加入草稿。消费桶用 **Add locked destination** 加入草稿。设置金额或比例、启用目标并保存后才开始分配。
3. 冷静期内可取消未完成的提现。到期后点 **Refresh modules**，再点 **Release funds**。从 Aave 退出时，面板要求填写另一个由你控制的钱包，防止提回正在监听的钱包后被当作新的收入。
4. 公共部署使用 `script/deploy.ps1` 或 `script/deploy.sh`。两个脚本会写入模块工厂和重试队列。Aave 和 WETH 地址由部署人核实后配置，可分别绑定到对应资产。Sepolia CCTP 入口只在部署配置使用 Circle 官方测试 USDC 时开启。

| 可选设置 | 用途 |
| --- | --- |
| `WRAPPED_NATIVE` | 目标链的标准 WETH，必须与当前配置的 `TOKEN_ADDR` 一致才显示创建入口。18 位单位下应重新配置收入门槛、固定额和授权 |
| `AAVE_POOL` | 目标链提供该资产储备的 Aave V3 Pool，需要支持 `getReserveAToken`。空值不开放创建 |
| `RETRY_CRON_TICKS` | Lasna 管理员分配的有限 Cron1000 次数预算，默认 0。设为 0 可停用，额度用完自动退订 |

## 运行边界

- **重试**。每次收入最多入队两个桶，只分配成功付款后剩下的原始预算。每项至少间隔 15 分钟、最多三次，跨 UTC 日、规则版本、发薪周期和用户设置变化会失效。每个钱包/资产最多 12 个待处理任务，全局最多 256 项。重试检查最新余额、授权、目标进度和每日限额。系统 Cron 负责触发，单次最多处理三项。Cron 每次都会消耗费用，队列为空时管理员也应停用调度。可用 **Process due jobs** 手动触发同一检查。
- **原生 ETH**。收款方应分享专用收款合约地址。发送端需要为执行包装和转账留出 gas。分账资产及留存为 WETH；可以用 WETH 合约解包。普通钱包直接收到 ETH 时不会触发本模块。
- **Aave**。同一资产支持一个自动供给目的地。供给和该桶的 ERC-20 支付原子执行，失败时该桶不会滞留资金。Aave 停止供给、额度用完或资产不受支持时会失败。利率随储备变化，提现受流动性及用户 Aave 头寸约束。模块不会借款。误转入模块的底层资产可由受益人调用 `withdrawIdle` 取回。
- **冷静期**。资金桶没有管理员绕过入口。到期提款只回到创建该桶的钱包。释放时保留该桶为活动收款方，或先暂停计划，避免退出资金被收入监听再次分配。
- **跨链**。钱包签名分别在两个测试网完成。Circle 标准模式等待来源达到最终性，费用以用户设定上限为界。来源销毁前必须通过合约预演，费用查询回滚时仍保持此条件。未使用的授权可在 Base Sepolia 撤销。目标链先校验证明格式、地址、资产、手续费和 nonce，再通过 Circle 合约预演。实际收款以 Sepolia 铸造的 ERC-20 Transfer 为准。已有签名可用原来源哈希继续查询，重复铸造由 Circle 的 nonce 状态保护。
- **报告**。首次回调里的分出额和留存额是那一刻的结果。后续重试付款会另发 `RetryClosed` 事件，面板显示近期处理状态。

协议资料：[Reactive Cron](https://dev.reactive.network/reactive-contracts#subscribing-to-cron-events) · [Aave V3 Pool](https://aave.com/docs/aave-v3/smart-contracts/pool) · [Circle CCTP 合约地址](https://developers.circle.com/cctp/references/contract-addresses) · [CCTP V2 消息格式](https://developers.circle.com/cctp/references/technical-guide)

## 验收

- 106 个 Foundry 测试和 39 个前端测试。覆盖重试不超原上限、重复 Cron 不重复付、Aave 暂停后原子恢复、真实 ETH 转入本地合约后 WETH 事件触发分账，以及冷静期取消和到期边界。
- 独立 Anvil 浏览器验证：启用重试、创建注册 Aave 桶、冷静期锁 100 并在到期后释放 40、向专用地址转 1 本地 ETH 并收到 1 WETH。
- Circle V2 证明的验收使用官方消息格式测试数据，涵盖收款人、资产、手续费、最终性和多个同类证明。真实公共网络的销毁与铸造仍待验收。Aave 验收使用模拟储备。
- 使用 Solidity 0.8.29 编译，部署运行时代码 24,454 字节，CI 校验以太坊合约尺寸上限。

[冷静期桌面截图](desktop-cooldown.png) · [ETH 收款手机截图](mobile-native-eth.png) · [浏览器验收记录](browser-local-evidence.json)
