# F0 工程验收（代理负责）

依据用户最新要求：用户只做产品功能验收。代码、架构/接口、数据兼容、权限边界、自动测试、构建与技术故障排查均由代理负责，不再要求用户判断技术风险或接受 E2E 崩溃。

## 工程责任

- 复核共用解析层依赖方向、旧入口兼容和解析限制。
- 复核数据库迁移、IPC/权限、双端合同和事务回滚；出现后续修复时更新检查范围，不能照搬旧快照。
- 运行适用的格式、静态检查、前端/Rust 测试、E2E、构建与隔离启动验证。
- 排查失败，保留首次失败与修复后的证据；不以增加重试、删除断言或用户功能验收代替技术闭环。
- 准备产品验收版本、隔离环境、测试样本和简明步骤。

## 本轮检查记录

2026-09-21：将用户清单中的工程事项移到本文。工作区还包含之前的成果对比修复、导出/PDF/字体相关改动，保留现状；历史交付快照不能直接充当这些改动的最新工程验收结果。

- 浏览器诊断：原 `ui-refresh.spec.ts` 连续运行 3 次通过，日志 `logs/v2x-f0/browser-diagnostic.log`。这只能说明当前未复现，不能证明历史崩溃根因已解决。
- 带 `pw:browser` 诊断日志的完整 E2E：23/23 通过，日志 `engineering-e2e.log`。随后用未开启额外诊断的标准命令复验，不更改断言、超时或重试配置。
- 当前前端 check：61 个文件、273 项测试通过，含格式、lint、类型和生产构建；日志 `engineering-frontend.log`。
- Rust fmt/clippy 通过。默认增量编译路径先后出现 `rustc.exe` 的 `STATUS_HEAP_CORRUPTION` / `STATUS_ACCESS_VIOLATION`，不是用例断言失败；Windows Application 事件证据保存为 `native-crash-events.json`。设置本次进程环境 `CARGO_INCREMENTAL=0`、`CARGO_BUILD_JOBS=1` 后，完整 Rust 测试为 243 通过、1 个既有手工预览生成器忽略；日志 `engineering-rust-test-no-incremental.log`。这提供当前可复现的验证路径，不足以断言增量缓存就是根因；没有改动应用业务逻辑或系统安全设置。
- 第三方许可与开发版发布身份审计通过，日志 `engineering-third-party.log` / `engineering-release.log`；不代表签名发布验收。
- 历史前端/Rust/构建记录保留于 [F0_EXECUTION.md](F0_EXECUTION.md)；后续补验结果在本文追加，区分历史状态与当前状态。

## 阶段门

当前结论：**工程验收未通过**。补验通过项不抵消下列开放问题，也不由用户承担风险判断。

- 标准全量 E2E 为 20/23，通过 Chromium 新无头模式复验为 22/23；失败仍为 `page.goto: Page crashed`。Windows Application 事件确认独立浏览器进程发生原生访问异常，尚不能据此确定根因。日志：`engineering-e2e-standard.log`、`engineering-e2e-chromium.log`。
- 进一步以 Windows `channel: 'chromium'` 且移除 `--disable-gpu` 实验，全量 23/23 通过，日志：`engineering-e2e-chromium-default.log`。单轮通过不足以证明稳定性修复；实验配置已撤回，仓库保留原 Playwright 配置，未改变重试、断言或超时。此结果作为后续定位线索，不用于关闭问题。
- 本轮关闭增量编译的桌面构建仍发生 rustc 访问异常，因此上述 Rust 测试通过不能证明编译器问题已解决。随后默认构建在覆盖正在运行的 `a2ui-terminal.exe` 时遇到文件占用；没有终止用户正在使用的程序。日志：`engineering-desktop-build.log`、`engineering-desktop-build-default.log`。
- 现有二进制复制到 `logs/v2x-f0/engineering-review/` 后隔离启动冒烟通过，测试进程和临时数据已清理；日志：`engineering-desktop-smoke.log`。该结果仅验证复制产物的启动，不替代本轮未成功完成的桌面构建。
- 核对现有交付快照的源码与边界记录未发现变化，但当前桌面二进制指纹与历史快照不一致；历史快照不作为当前二进制通过完整验收的证明。

产品验收由用户确认；工程验收由代理确认。未关闭的技术问题由代理继续处理，不转交用户作技术判断。两类验收通过后，仍须用户明确允许进入下一阶段。本轮维持 F0，M1 不启动。

2026-09-23 后续记录：用户明确确认 F0 产品验收完成并授权 M1-A。按最新授权开始 M1-A，以上内容保留为 F0 当轮工程历史，不改写失败结果。工具原生异常与后续复验继续由代理负责，最新进展见 [M1A_EXECUTION.md](M1A_EXECUTION.md)；此授权不包含 M1-B。
