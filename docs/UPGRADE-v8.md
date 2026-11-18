# PaydaySplit v8：真实监听证据与自动化健康检查

日期：2026-11-18。本轮基于 v7 的双分配模式、稳定资金桶和自动周期，补充可运行的健康检查、站内异常提示和真实监听作业记录。核心收入瀑布合约逻辑没有变更。

## 已记录的真实结果

独立 CampTransferMonitor 在 Lasna 监听 Sepolia RCT 的 Transfer，1 RCT 自转触发系统 react()，成功计数 1、剩余 0、自动退订、欠费 0。[学习记录与截图](../notes/2026-11-18-first-transfer-monitor.md)、[机器证据](../deployments/camp-transfer-monitor.json)。用户报告已完成营地提交，平台审核结果尚未核实。

此证据只覆盖独立监听作业。PaydaySplit 主合约的真实目标链回调和分账仍待部署验收，不能用该地址代替 PaydaySplitReactive。

## 新增功能

### 同一套健康规则用于网页和命令行

Automation health 面板与 `npm run health` 共用 `automation-health.js`，检查：

- RPC 返回的真实 chainId，配置的代币、分账、Reactive、Proxy 和系统合约代码是否存在。
- Reactive 绑定与两端费用服务提供者是否符合配置。
- Reactive 和目标链的 balance、reserves、debt；余额与储备合并计算费率缓冲，欠费独立判定。
- 协议暂停、剩余应用回调次数；连接钱包后再检查有限授权、用户回调次数、规则镜像和订阅、暂停/到期、当日限额和未来周期锚点。
- 读取失败显示未知，不将缺失数据伪装成零余额或正常状态。错误报告不复制 RPC URL、访问令牌或底层响应。

费用缓冲阈值默认为 Reactive 0.05 个原生单位、目标链 0.02 个原生单位，可在部署配置的 `feeWarningWei` 中修改；它们是提醒阈值，不是实际手续费报价或能执行几次的保证。欠费需要清偿，单纯给合约加余额可能不足以恢复执行。

面板每 30 秒检查一次，页面隐藏或钱包操作期间不启动自动轮询，另有 Check now 和 JSON 报告下载。检查不会签名、转账、授权或自动改变配置；交易确认流程不依赖健康查询完成。

### 异常提示与恢复记录

同一异常持续存在时不重复弹出。完成一次有效复查后才标记问题已解决；RPC 中断期间保留上次确认的问题，避免错误提示“已恢复”。站内记录最多保存最近 20 项状态变化，断开钱包后清空当前面板。

Demo 模式明确显示 simulation only，不读取或虚构链上费用。健康检查只判断已保存规则，不将编辑草稿当作已上链的配置。

### 已完成的单次监听不是预算耗尽故障

`npm run health -- --camp` 读取真实监听合约。`count > 0 / remaining = 0 / subscribed = false` 识别为单次任务已完成；没有观察记录就停止订阅仍会提示待检查。它与收入瀑布服务的回调预算耗尽分开判断。

## 验证与复现

- 98 个合约测试：原有核心 87 项、监听/测试代币 11 项。
- 33 个前端测试：健康判断、不同网络、RPC 故障、储备抵扣、用户限额、提示去重、未知状态与真实恢复、原有分账/周期/备份和完整 Demo DOM。
- 生产构建、JavaScript 语法与 Foundry 格式检查。
- 新检查器通过真实监听合约读取：`completed`、计数 1、剩余 0、自动退订、欠费 0。结果：[camp-health.json](../deployments/camp-health.json)。

```powershell
cd web
npm ci
npm test
npm run build
npm run health -- --camp
# Configured PaydaySplit deployment:
npm run health -- --user 0xYOUR_WALLET
# Fresh local harness:
npm run health -- --local --user 0xYOUR_LOCAL_WALLET
```

CLI 退出码：0 为检查通过/有意停用/单次任务完成；1 为阻挡或需要注意；2 为配置不完整或无法检查。所有数值以整数字符串导出，避免大额授权精度损失。

## 边界与下一阶段

站内提示依赖页面保持运行，不是后台通知服务。未增加失败桶自动重试、桥、原生 ETH 收入路由或生息；这些仍需独立实现和审查。本轮不需要改动既有 v7 核心地址，新的独立监听合约用于本次作业。

健康面板已完成桌面和手机宽度的浏览器视觉验收，修复了窄屏溢出，并验证了异常、恢复和 JSON 下载。[验收记录与截图](visual-qa/README.md)。完整依赖树此前记录的 picomatch 构建依赖公告详见[代码复核](CODE-REVIEW-v8.md)。
