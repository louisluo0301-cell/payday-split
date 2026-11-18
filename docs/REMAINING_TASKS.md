# 后续待办 — v7 当前状态

更新：2026-11-18。完整方案见 [OPTIMIZATION-PLAN.md](OPTIMIZATION-PLAN.md)，当前功能见 [UPGRADE-v7.md](UPGRADE-v7.md)。

| 项目 | 状态与下一步 |
|---|---|
| 合约/前端 | 87 Foundry + 18 前端测试、环境解析检查和构建通过 |
| 本地链 | 双模式与自动周期四次完整回调、重复投递验证，证据在 deployments/ |
| 公开 GitHub | 已发布：https://github.com/louisluo0301-cell/payday-split |
| 测试网 | 尚未部署；需有测试币的钱包、核验网络/Proxy，按 DEPLOY.md 执行 |
| 新功能视觉验收 | DOM 回归和构建已通过，浏览器视觉检查待完成 |
| 视频 | docs/payday-split-demo.mp4 是早期 UI；v7/真实测试网版待更新 |
| 安全 | 自查已记录，外部审计未完成；构建依赖 picomatch 公告暂无补丁，详情见 CODE-REVIEW-v7.md |
| 失败恢复 | 下阶段实现按桶幂等队列/取消，不能重放已成功桶 |
| 参赛提交 | SUBMISSION.md 是草稿，真实地址/哈希、视频和团队字段待补齐；本次没有提交网站作业 |

原生 ETH、桥、流式工资、生息和冷静期逐步引入独立模块。v7 不是旧地址原地升级；新部署前暂停旧规则、处理旧任务、撤销旧授权，启用新有限授权后小额验收。真实网络部署会产生费用，不能使用公开 Anvil 密钥。
