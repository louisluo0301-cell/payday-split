# 后续待办 — v9 当前状态

更新：2026-11-18。完整方案见 [OPTIMIZATION-PLAN.md](OPTIMIZATION-PLAN.md)，当前功能见 [v9 资金模块](income-modules/README.md)。

| 项目 | 状态与下一步 |
|---|---|
| 合约/前端 | 106 Foundry + 39 前端测试、环境解析检查和构建通过 |
| 本地链 | 双模式与自动周期四次完整回调、重复投递验证，证据在 deployments/ |
| 公开 GitHub | 已发布：https://github.com/louisluo0301-cell/payday-split |
| 独立监听作业 | Sepolia → Lasna 真实执行、自动退订、无欠费，用户已报告提交；审核未核实 |
| PaydaySplit 主流程测试网 | Sepolia → Lasna → Sepolia 单桶分账已通过。[合约与三段交易](../deployments/paydaysplit-sepolia-lasna.evidence.json) · [Sepolia 首笔转账发现](../README.md#最小分账闭环) |
| 自动化健康检查 | 网页/CLI 共用判断，支持费用、异常、恢复记录与报告；真实监听模式已验证 |
| 健康面板视觉验收 | 已通过桌面、手机宽度和模拟异常恢复检查，见[截图和浏览器结果](visual-qa/README.md) |
| 视频 | docs/payday-split-demo.mp4 是早期 UI；v8/真实测试网版待更新 |
| 安全 | 自查已记录，外部审计未完成；构建依赖 picomatch 公告暂无补丁，详情见 CODE-REVIEW-v7.md |
| 失败恢复 | [单笔收入追踪](income-trace/README.md)和[按桶自动重试与取消](income-modules/README.md)已完成本地验收 |
| 新收款与资金模块 | ETH / WETH、Aave V3、消费冷静期和 CCTP V2 归集已实现；公共网络验收待进行 |
| 参赛提交 | SUBMISSION.md 是产品参赛草稿，[核心真实地址和哈希](../deployments/paydaysplit-sepolia-lasna.evidence.json)已齐备，视频和团队字段待补齐；营地独立监听作业已由用户提交 |

流式工资及其他资产和桥路线仍在规划中。v9 需要新合约地址；新部署前暂停旧规则、处理旧任务、撤销旧授权，启用新有限授权后小额验收。
