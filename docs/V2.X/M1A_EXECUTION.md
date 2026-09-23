# M1-A 个人资料库实施记录

本阶段追加了用户授权的“资料库与资料包整合”。下方首轮记录保留历史事实；当前交付与验证以文末整合记录和交付快照为准。

2026-09-23：用户确认 F0 产品验收完成并明确授权下一阶段。本轮仅实施 M1-A，M1-B 不启动。基于提交 `50b6f92`；F0 的工程异常历史保留，不将用户功能验收解释为对技术失败的认可。

## 实现范围

- 新增 schema 19：应用级 `personal_knowledge`，不依赖 Workspace 外键；稳定 sequence 游标分页，默认 40 条。旧迁移保持不变。
- 复用原生选择器、拖放检查批次及共用解析层。资料库页面有独立的确认目的地，确认前不创建资料记录；不接收前端绝对路径。TXT/MD/DOCX/PDF/CSV/XLSX，原文件不修改，提取正文上限 2 MiB。
- 确认时复核检查批次的原始字节 hash。副本先写 staging 并刷盘、原子改名，全部就绪后在同一数据库事务发布；失败补偿，启动清理未发布的 UUID 副本。Windows 独占文件锁防止多个应用进程的导入和启动对账相互删除副本。
- 管理目录为应用数据目录下 `knowledge/<uuid>.<format>`，使用扁平目录降低清理复杂度；路径只在 Rust 内部构造。启动复核副本 hash；缺失或变化的资料标为 failed。junction/symlink 越界拒绝，不递归删除来源目录。
- 提取结果、parserVersion、rawHash/extractedHash、sourceVersion、标签和时间持久化；搜索不重新解析 Office。重复内容复用现有记录。当前 sourceVersion 为 1；首版显式更新方式是删除旧副本再导入，新来源 ID 使旧授权不可复用；不静默跟踪原文件，不保留历史资料副本。
- 新页面提供导入确认、加载/失败/空状态、名称与标签管理、只读预览、分页搜索和删除重试；加入主导航和命令面板，中英文可用。
- 首页/命令面板的统一搜索增加 personal_knowledge，按 ID 打开预览；资料可在任意工作区的发送清单中明确选取。
- Manifest 从后端读取资料库正文，忽略前端伪造正文；规划及消费时复核来源和 hash，未选不发送。仅保存上下文选择仍需生成发送清单；成功发送后清空本次个人资料选择。
- 删除先使资料不可用，再清理管理副本；被占用时保留 deleting 并允许重试。撤销待确认清单、清空检索缓存并尝试停止正在执行的请求；已经发出的资料无法撤回。clear-all 清理资料库副本及新表，保留用户原文件、我的成果文件和导出文件；诊断增加资料计数。

新增 IPC：`list_personal_knowledge`、`get_personal_knowledge`、`edit_personal_knowledge`、`delete_personal_knowledge`、`confirm_personal_knowledge_import`。均同步 Gateway、命令注册和 capability；重命名与标签合并为一个受限元数据操作。耗时确认解析使用阻塞任务池，单个应用内串行处理资料变更。

## 能力边界

资料库导入只授权本地保存、读取和搜索，不授权云端发送。扫描 PDF 不做 OCR，PDF/DOCX/表格当前只读提取正文，定位能力仍明确 unavailable，M4 再增强；没有伪造页码或段落位置。Web Mock 用浏览器 TXT/MD 文件演示流程；六格式真实解析由 Rust 测试及桌面版本负责。

持久全文索引和大规模检索性能属于 M5，本阶段不宣称千份资料低延迟。Office 包增加统一的条目数量、展开大小、压缩比和越界路径检查，DOCX 正文读取有界。

## 工程记录

日志：`logs/m1a-*.log`。以下保留发现过程，最终结果见后面的验证表，不沿用 F0 的测试数量。

- 普通工具进程再次出现 Node 原生访问异常和 rustc heap/stack 异常；禁用 JIT 的 lint 曾通过，但不将其作为已解决根因的证据。
- 使用仓库配置对应的本机 stable 工具链（Rust 1.98.0），只为本次工具进程设置单核 affinity，未修改全局系统设置、应用运行参数或 Playwright 重试/断言。该路径下新增 6 项 Rust 资料库集成测试、3 项页面组件测试通过。
- 首次全量发现旧事务测试硬编码 schema 18，改为当前 schema 常量，保留事务回滚断言。并发运行的已有流超时测试失败，后续串行运行原断言复验。
- 浏览器回归发现新弹窗缺少显式中英文按钮文本，已补齐；资料管理闭环和原紧凑布局/主题回归通过。发送清单及最终全量验证仍以最终日志为准。

## 阶段门

用户只做产品功能与体验验收；代理负责工程检查、构建、技术故障和样本准备。当前状态为 **工程检查完成、待产品验收**，不是整个阶段已验收。用户确认并明确允许前不进入 M1-B。

## 最终工程验证（2026-09-23）

| 项目                                     | 结果                                                                                                                          | 日志                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 前端完整 check                           | 62 文件 / 276 测试通过，含格式、lint、类型及生产构建；仅保留原有 CodeEditor hooks lint warning                                | `m1a-check-complete.log`                                               |
| 全量覆盖率运行                           | 276 测试通过；既有配置覆盖范围 statements 97.97%、branches 84.61%、functions 96.66%、lines 98.80%，不等同于整仓或资料库覆盖率 | `m1a-coverage-full.log`                                                |
| Rust 全量                                | 249 通过、1 个原有手工 PDF 预览生成器忽略；含 0–18 → 19 升级、事务回滚、命令注册、6 项资料库集成测试                          | `m1a-rust-serial.log`                                                  |
| Rust 格式 / clippy                       | 通过，clippy 使用 all-targets / all-features / -D warnings                                                                    | `m1a-clippy.log`                                                       |
| 全量 E2E                                 | 25/25 通过；原重试、超时和断言保持，新添 2 项资料库流程                                                                       | `m1a-e2e-complete.log`                                                 |
| 第三方许可 / 历史 Beta 证据 / 开发版身份 | 通过；旧 Beta 审计不替代新资料库测试，也不代表签名发布完成                                                                    | `m1a-license-audit.log`、`m1a-beta-audit.log`、`m1a-release-audit.log` |
| 最新桌面构建                             | debug / no-bundle 通过，使用本机 stable Rust 1.98.0                                                                           | `m1a-desktop-build.log`                                                |
| 原生隔离启动                             | 通过；临时数据库和 WebView、凭据禁用，测试进程与临时数据已清理；本项没有设置单核 affinity                                     | `m1a-desktop-smoke.log`                                                |

工程检查命令沿用项目脚本。本机普通多核工具进程曾出现原生异常，因此最终构建/测试进程使用单核 affinity，Rust 关闭增量、单构建任务、测试串行，E2E 单 worker；只影响该次工具进程，未写入应用配置、系统设置或更改测试断言。上述验证在此明确条件下通过；原生异常根因仍属工程环境跟踪项，不能宣称已修复或要求用户判断是否接受。

交付副本：`logs/m1a-review/a2ui-terminal.exe`，与成功构建及启动验证的二进制 SHA-256 相同：`8a5304fbdd80cab5daa2d23d73c30f91d7c0846ec8a12aa5b1a68b5330d552db`。源代码、产物和日志指纹见 [M1A_DELIVERY_SNAPSHOT.json](M1A_DELIVERY_SNAPSHOT.json)。schema 19、99 个命令；未更改旧迁移、依赖锁文件、应用版本或发布身份。

没有安装、签名发布或自动打开用户真实数据库，也没有将任何资料发送给真实 Provider。后端授权边界使用虚构本地文件测试，Web Mock 验证产品操作。已提供 [Markdown 样本](samples/M1A_Knowledge_Sample.md) 和 [CSV 样本](samples/M1A_Knowledge_Sample.csv)。

## 本阶段追加：资料库与资料包整合（2026-09-23）

用户明确授权在 M1-A 内整合两个功能，未授权进入 M1-B。主导航改为“资料库”，下设“全部资料 / 资料包”。设置移除重复的管理界面，保留跳转按钮。没有工作区时可在资料包页选择工作区；Web Mock 同步提供明确的示例工作区。

资料包支持混合引用个人资料与当前工作区已授权来源，合计最多 20 项，仍按工作区保存并标明所属工作区。个人资料继续跨工作区复用，原工作区授权没有扩大。资料包不复制正文；改名实时读取来源名称，资料不可用时移除引用，空包清理；删除包不会删除资料。

新增 schema 20 `context_pack_knowledge_items`，保留原引用表及旧迁移，通过外键和状态变更触发器清理引用。旧协议缺失 `personalKnowledge` 时仍视为工作区来源。确认发送前按真实来源类型展开，后端读取正文并沿用发送清单确认、内容校验和删除失效机制；重复选择来源不会重复发送。诊断引用计数包含两种来源。

最终工程结果：

- `m1a-integration-check.log`：格式、lint、TypeScript、62 文件 / 276 测试、前端构建通过；保留原 CodeEditor 的一条 lint warning。
- `m1a-integration-rust.log`：250 通过、1 项原有手动 PDF 样本测试忽略；包含旧版本迁移、旧资料包协议、混合来源重启、改名、跨工作区拒绝、删除引用清理及发送清单展开。
- `m1a-integration-clippy.log`：所有 targets / features，`-D warnings` 通过；Rust fmt 通过。
- E2E：`m1a-integration-e2e.log` 中原有 25 项通过；新增整合用例因测试样本文本长度期望误写失败，改正为实际 24 字符后，`m1a-integration-e2e-unified.log` 独立复跑通过。合计 26 项验证通过，不将首次失败日志写成全绿。
- `m1a-integration-desktop-build.log` / `m1a-integration-desktop-smoke.log`：最新桌面构建与隔离启动通过，未关闭用户运行中的旧版、未使用真实凭据。

本轮沿用上述单核工具进程、串行 Rust / E2E 条件。期间修复新增 React effect 状态重置 lint 问题、旧协议默认值兼容、模拟工作区按钮空操作和测试导航迁移错误，最终检查通过；没有放宽断言或关闭失败检查。首轮 coverage 数字属于历史证据，本次未重新运行覆盖率统计。

当前交付：`logs/m1a-integrated-review/a2ui-terminal.exe`，SHA-256 `9d2f72dc2c4ab6ce91ce2ccf3ffde627d1d289860644b995019cdf86d004c514`。schema 20、99 命令；当前指纹见交付快照，功能验收见 [M1A_MANUAL_ACCEPTANCE.md](M1A_MANUAL_ACCEPTANCE.md)。停在 M1-A，等待用户产品验收。
