# 营地作业：第一次部署，监听 Sepolia 代币转账

本任务独立于 PaydaySplit 产品部署，目标是在 Lasna 真实部署并至少收到一次由系统发送的 `react()`。

**2026-11-18 已真实执行并由用户完成提交。** 合约、两链交易、截图与审核状态见 [学习记录](../notes/2026-11-18-first-transfer-monitor.md)，RPC 核验数据见 [机器证据](../deployments/camp-transfer-monitor.json)。

## 实现

- [CampTestToken.sol](../src/CampTestToken.sol)：6 位小数、固定初始供应的 Sepolia 测试代币 RCT，无价值。
- [CampTransferMonitor.sol](../src/CampTransferMonitor.sol)：构造函数仅订阅 Sepolia 上指定 RCT 的 ERC20 Transfer；三个无关 topic 使用 REACTIVE_IGNORE；react 带 onlySystem。
- 单笔金额严格超过 0.5 RCT 才计数；匹配计数 1 次后自动退订。来源链、合约、topic、日志参数数量、data 长度、金额和重复日志均用 return 过滤，避免用回滚过滤事件。
- 部署时附带 0.1 lREACT，保留标准 pay()/receive()；owner 可主动停止或补资后 coverDebt。不请求目标链回调，本任务只要求观测。

实现参考的是 Omni 版本；没有复制旧 ReactVM 写法。固定参考版本：

- [官方 Xfers](https://github.com/Reactive-Network/reactive-smart-contract-demos/blob/d1d854b4d8ded359d73dcd85cda882ec5c9aab49/src/micro-demos/Xfers.sol)
- [营地 CampReactive 模板](https://github.com/ethpanda-org/reactive-builder-camp/blob/87675f45bdaf7b944028bd6231e463f869b453c8/starter/src/CampReactive.sol)
- [当前 Reactive 文档](https://dev.reactive.network/reactive-contracts)、[费用与资金](https://dev.reactive.network/economy)、[官方测试币水龙头](https://dev.reactive.network/reactive-mainnet)

## 钱包签名与复现

```powershell
forge test --match-contract CampTransferMonitorTest -vv
forge build
cd web
npm ci
node script/camp-build.mjs
npm run dev -- --port 5184 --strictPort
# http://127.0.0.1:5184/camp-task-ready.html
```

部署页使用指定测试钱包 0x90D2A64b86cB547d729ce61101FcD835d512e55a。使用者在 MetaMask 手动确认连接、网络切换和交易，页面不读取/保存私钥。只允许 Ethereum Sepolia 11155111 与 Lasna 5318007。

顺序：如有需要用 0.005 Sepolia 测试 ETH 调官方 faucet.request(本钱包) → 部署 RCT → Lasna 部署监听并充值 0.1 lREACT → Sepolia 自转 1 RCT → 等待网络自动处理。自转余额不变，但仍产生标准 Transfer。

## 真网证据核验

```powershell
node web/script/camp-verify.mjs <监听合约地址> <监听部署交易> <代币部署交易> <水龙头交易>
```

脚本只读 RPC：检查两条真实网络的 chainId、合约 owner/资产/阈值、来源 Transfer、Lasna TransferObserved、同笔自动退订事件、最终 count=1/remaining=0/subscribed=false、无欠费，并输出 `deployments/camp-transfer-monitor.json`。没有真实系统日志时不会生成“已完成”证据。

最终提交需要合约 Reactscan 链接、一次真实 react() 交易链接、一句话订阅过滤条件。本次均已保存；提交状态来自用户报告，审核结果尚未核实。
