# V2.x M0 基线报告

日期：2026-09-21。本报告保留 M0 交付时的证据，当时状态为待人工验收。用户随后已确认测试通过并授权 F0，见 [M0 执行记录](M0_EXECUTION.md)；自动 E2E 历史失败仍保留，不改写为自动全绿。

## 代码与环境

- 基准 HEAD：`35023d75a0d87e5e16f1d0de8a554e4eb6b49a69`。开始时 tracked 文件干净，`docs/V2.X/` 为已有未跟踪规划文档。本轮未提交、合并或发布。
- Windows 11 Home 10.0.22631；Node 22.23.2、npm 10.9.8；rustc 1.97.1、cargo 1.97.1；Rust 构建使用 `CARGO_BUILD_JOBS=1`。
- React 19 / TypeScript 5.9 / Vite 8 / Ant Design 6 / Zustand 5；Tauri 2 / Rust 2021 / SQLite。依赖和 lockfile 未修改。
- 应用版本 2.0.0，标识 `com.a2ui.terminal`；schema 18，0001–0018 迁移不变；94 个 Tauri 命令均有运行注册、build 注册和主窗口权限，capability 共 98 项权限。
- A2UI v0.9.1（兼容 v0.9/私有 1.0），本地 catalog `urn:a2ui-terminal:catalog:basic:v1`，20 组件、3 action。
- Provider 预置 silicon_flow/deep_seek/open_ai/custom；检索仍为内存词法/BM25-like/中文 bigram，不是持久混合索引。Manifest TTL 600 秒，32,000 token 上限、20 来源上限；目前新规划会清空旧 pending manifest。

原始源文件/合同/迁移的 68 项 SHA-256 和命令清单见 [M0_BASELINE_SNAPSHOT.json](M0_BASELINE_SNAPSHOT.json)。该文件保留**修复前**状态；本轮变更与构建产物见 [M0_DELIVERY_SNAPSHOT.json](M0_DELIVERY_SNAPSHOT.json)，不能将未提交修复误标为原 HEAD 已包含。

## 本轮验证结果

日志均在仓库 `logs/v2x-m0/`（忽略目录，结果摘要在本文留存）。

| 检查                     | 结果                                                   | 日志/边界                                                                               |
| ------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `npm run check`          | 通过；59 文件、258 测试，含格式/lint/类型/生产构建     | `frontend-check.log`；本轮没有前端实现修改                                              |
| `npm run test:coverage`  | 通过；语句 97.97%、分支 84.21%、函数 96.66%、行 98.80% | `frontend-coverage.log`；只针对配置内 4 个关键模块，非全仓覆盖率                        |
| Rust fmt/clippy          | 通过；all-targets/all-features，warnings 为错误        | `rust-fmt.log`、`rust-clippy-after-isolation.log`                                       |
| Rust 全量测试            | 修复前 230 通过；修复后 234 通过、1 忽略               | `rust-test-after-isolation.log`；201 单测 +33 集成；忽略项是手工 PDF 布局预览生成器     |
| schema 回归              | 通过，历史 0–17 升级到 18，历史管理/置顶/清理边界覆盖  | Rust storage/application 测试；未读取用户数据库                                         |
| Web E2E 全量第一次       | 22 通过、1 失败                                        | `web-e2e.log`；重复名称重试用例在 page.goto 崩溃                                        |
| Web E2E 全量第二次       | 21 通过、2 失败                                        | `web-e2e-rerun.log`；会议纪要和性能键盘用例在 page.goto 崩溃                            |
| 第二次失败项定向复跑     | 2/2 通过                                               | `web-e2e-last-failed.log`；第一轮失败用例在第二轮通过；没有全量单次全绿证据             |
| Beta/第三方/发布身份审计 | 均通过                                                 | `beta-evidence.log`、`third-party.log`、`release-audit.log`；审计通过不代表签名发布就绪 |
| npm 生产依赖审计         | 0 漏洞                                                 | `npm-audit.json`；截至执行时的 npm 生产依赖，不涵盖所有 Rust 风险                       |
| Debug 桌面无安装包构建   | 通过                                                   | `desktop-build.log`；内嵌前端，未生成/运行安装器                                        |
| 隔离桌面启动冒烟         | 通过；初始化回执、临时 DB、存活 5 秒，临时目录已清理   | `desktop-smoke.log`；不等于真实 UI/Provider/安装升级验收                                |

两次 E2E 全量失败均发生于导航阶段，报 `Page crashed`，未到业务断言；失败位置不同、复跑通过支持“间歇性浏览器问题”的判断，但根因尚未确定。没有改重试次数、跳过用例或放宽断言。第一次/第二次失败 trace 与 video 分别保存在 `logs/v2x-m0/e2e-first-run`、`e2e-second-run`。该问题继续开放，由人工决定 M0 是否接受这个基线缺陷。

## 本轮代码修复

旧 `smoke-desktop.ps1` 仅覆盖 APPDATA/LOCALAPPDATA，而本机 Tauri → dirs → dirs-sys 使用 Windows Known Folder API，不能据此保证数据隔离。本轮在发现后才运行修复版冒烟，未启动旧版脚本。

修改仅涉及 `scripts/smoke-desktop.ps1`、`src-tauri/src/lib.rs`、`src-tauri/src/security/credentials.rs`，新增 `src-tauri/src/smoke.rs`：显式 `--smoke-test-root` 模式限定新建空临时目录；SQLite/受管成果/WebView 数据使用测试根；拒绝系统凭据访问；初始化完成写协议回执。脚本在启动前检查支持标记，拒绝旧二进制，验证回执和临时 DB，再停止自己启动的进程并检查边界清理。

普通启动仍使用原应用数据和凭据路径；新增 4 项测试覆盖普通模式、有效临时根、非空/越界/错误参数及凭据禁用。没有增加业务命令、权限、表或依赖，也没有开始 F0 的接口提取。回退该修复时须同时停用隔离冒烟脚本，不能恢复旧脚本后仍声称安全隔离。

## 产品链路与证据限制

现有导入、Manifest、Provider、Review、Apply/Revision/Undo、Export 的 Rust 用例与合同测试通过，Web Mock 的对应交互在上述运行中均有通过记录。它们是分层证据，不能拼成“真实 Windows Provider 全链路已实测”。真实密钥、远端模型、用户资料和用户数据库均未使用。

Task 仍生成 local_scaffold，Result 助手仍是占位。此次修复不会出现资料库、成果 AI 助手或新 Inline UI；这些属于尚未获下一阶段授权的后续实现。

下一步仅为 [M0 人工验收](M0_MANUAL_ACCEPTANCE.md)。架构草案见 [M0_ARCHITECTURE_DECISIONS.md](M0_ARCHITECTURE_DECISIONS.md)，样本见 [M0_ACCEPTANCE_SAMPLES.md](M0_ACCEPTANCE_SAMPLES.md)。用户验收前不启动 F0；若发现问题，继续在 M0 修正。
