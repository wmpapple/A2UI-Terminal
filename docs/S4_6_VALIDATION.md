# S4.6 隐私、诊断、清理与安全审计验证记录

> 状态：实现与自动验证已完成，等待用户人工验收；通过前不得开始 S4.7。

## 实现范围

- 诊断格式升级到 v1.1，数量覆盖全部 V2 数据域，并显式声明正文、文件内容/名称、Prompt、模型回复、路径、Endpoint、密钥和原始日志均未包含。
- SQLite 清理显式覆盖 Context Pack、Review Block、A2UI 模板、自定义 Task 模板与全部恢复/导出/遥测表；保留 Schema、内置空白模板和默认关闭的 telemetry singleton。
- Rust 清理成功后清空 WebView localStorage/sessionStorage；Rust 失败时保留前端偏好。活动请求与导出取消并移出内存注册表。
- 清理回归向全部 V2 表写入虚构敏感数据，清理后逐表断言为空，同时断言真实托管成果文件仍在磁盘。
- 新增统一对抗 fixture，实际穿过导入、表格导出、检索 DTO 与 A2UI 可信校验。
- 新增应用级威胁模型、扩展隐私说明、完整直接依赖 NOTICE 和锁文件许可证/完整性门禁。

## 自动验证

| 命令                                                   | 结果                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `npm run audit:third-party`                            | 通过；146 个生产 npm 包、398 个 Windows Rust 包均有许可证元数据          |
| `npm run lint` / `npm run typecheck` / `npm run build` | 通过                                                                     |
| `npm run test`                                         | 通过；48 文件、224 项                                                    |
| `npm run test:coverage`                                | 通过；97.97% statements、84.21% branches、96.66% functions、98.80% lines |
| `cargo fmt --check` / Clippy `-D warnings`             | 通过                                                                     |
| `cargo test --all-targets -j1`                         | 通过；193 个库测试、33 个集成测试；1 个视觉 PDF 测试按设计忽略           |
| S4.6 四域对抗 fixture 定向测试                         | 通过；1 项                                                               |
| `npm run test:e2e` + CI 单 worker 隔离重跑             | 13 项均有通过证据；首轮 2 项发生本机 Chromium 进程崩溃，详见 LOG-0171    |
| Tauri debug `--no-bundle` + 隔离启动冒烟               | 通过                                                                     |

## 隐私与副作用

- fixture、测试数据库和文件均为临时、虚构数据；未读取真实工作区正文、诊断文件或 Credential Manager Key，未调用 Provider 或遥测接收端。
- 没有新增 migration、IPC、Capability、网络目标或遥测字段；诊断字段仅增加脱敏计数与否定型隐私声明。
- 自动测试不会删除用户文件。真实 Credential Manager 与 WebView2 清理需要用户按人工验收单在可清理环境复验。
