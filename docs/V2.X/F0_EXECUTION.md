# F0 最小复用接口：实施与验证记录

日期：2026-09-21。M0 已经用户人工确认通过，授权进入 F0；本阶段结束后再次等待用户检验。当前：**代码交付，待人工验收**。未开始 M1-A/M1-B。

## 范围与原有工作

基准 HEAD 仍为 `35023d75a0d87e5e16f1d0de8a554e4eb6b49a69`，M0 修复和规划文档尚未提交。本轮保留所有 M0 改动，新增 F0 差异；不能将整个 `git diff` 当作仅 F0。没有新建迁移、业务命令或权限，不替换编辑器，不接通成果 AI 生成，不启动资料库。

## F0-01 共用解析

- 新增 `src-tauri/src/parser/{mod,text,table,formats}.rs`。TXT/Markdown/既有代码文本、DOCX/PDF 提取和 CSV/XLSX 解析共用这层；解析器不依赖 Workspace、Storage、Provider 或 Tauri。
- 现有 Workspace 读取和 DocumentSource 表格入口已改用共用实现。表格类型和常量从旧入口 re-export，原调用者及旧 DTO 保持兼容；没有复制第二份 Office 解析逻辑。
- 新增 ParsedDocument：format/parserVersion/rawHash/extractedHash/blocks/warnings；hash 对同一字节快照计算。普通文本 locator 使用 UTF-16；PDF/DOCX/表格当前结构映射明确 unavailable。页级/段落级定位仍属于后续增强，本轮不伪造精度。
- 当前版本 `local-v1`，普通文档单块保留原提取正文；表格通用文本视图按行/单元格转为换行/制表符，原表格预览仍使用保留公式标记的结构化 DTO。通用表格文本视图不是精确单元格定位。
- 共用文件读取有字节上限，CSV/XLSX 原行/列/单元格/压缩条目限制保留。DOCX 原提取行为保持；本阶段不是 OCR、完整 Office 对象模型或解析器安全审计。

## F0-02 数据访问

- Storage 提供 crate 内 `with_read` 和 `with_transaction` 回调，连接与 Mutex 不对 commands 暴露；所有新目标查询 SQL 放在 `repository/document.rs`。
- 事务成功提交，回调/SQL 出错回滚；已有置顶写入使用事务回调验证真实调用路径。旧 Storage 方法不全量搬迁。
- 回调只允许有界同步 SQL，不得递归调用 Storage（避免重入死锁），不得在锁内解析文件或发网络请求。这是 crate 内可信 Repository 的使用约束，不是 SQL 沙箱。
- 测试验证两次写入遇到业务错误/唯一约束错误整体回滚，锁释放后仍可读取。架构测试禁止 commands 使用这两个回调。

## F0-03 文档与选区基础

- Rust/TS 共享 DocumentTarget、DocumentSnapshot、SelectionSnapshot；共享 fixture 为 `contracts/v2x/document.json`，已显式接入两侧测试，不依赖旧审计器自动扫描新目录。
- Rust application/document 按授权 sourceId+workspaceId 或 resultId 解析现有目标，并调用已有读取与路径边界；不给新 DTO 增加前端绝对路径。Workspace 目标目前需要已授权 sourceId；没有 sourceId 的目录列表项需先沿已有导入授权流程取得身份，不能用路径伪装 ID。
- 选区快照绑定 revision（文件无 revision 时为 null）、contentHash、UTF-16 起止位置与选区 hash。后端拒绝跨工作区来源、已撤销/删除目标、未保存草稿、只读/结构化目标、过期内容/版本、越界及切开 emoji 代理对。
- 新接口是内部读取/校验基础，不新增 IPC，不提供新写入通道。未来实际 Apply 必须再次验证权限、版本和范围；本轮校验成功不是可长期复用的写入令牌。
- Result TextArea、CodeMirror 和 Markdown 源码编辑器提供可选 `onEditorPort`。共享 editorAdapter 读取快照/选区、展示或清除提案、接收调用方从现有后端应用流程取得的权威快照；展示提案不会写文件或自动接受。当前 UI 没有接入新的 AI 操作。
- Markdown 预览 DOM 不映射为源码写入范围；结构化成果不开放文本快捷端口。哈希计算前后检查正文、目标和选区，异步期间切文档/输入会使快照失效；若编辑器换行规范化导致正文与保存快照不同，也拒绝捕获而非猜测位置。

## 验证记录

日志目录：`logs/v2x-f0/`。初次编译暴露 sha2 输出格式及测试环境导入问题，均已修复。所有测试使用 fixture、临时数据库和 Web Mock，不读取真实密钥或发送资料给模型。

- 前端全量 check 通过（格式、lint、类型、单测、生产构建），最终 61 文件 / 270 测试。
- Rust fmt/clippy 通过，241 测试通过、1 个原有手工 PDF 预览生成器忽略。新增 4 项文档基础集成测试、2 项事务测试、1 项解析架构测试；迁移/表格/审阅/版本/置顶等旧回归均通过。
- Beta 证据审计通过；52 项冻结文件 hash 核对无变化，仍为 schema18 / 94 命令。
- E2E 首轮 21/23，通过失败项复跑 2/2。首次失败包括一项 page crash 和命令面板搜索焦点竞态；该竞态在回归中进一步修复，记录如下。
- 最终 E2E 全量 20/23，三项均为 page.goto/reload 的 Page crashed；失败项定向复跑 2/3，剩余 `ui-refresh.spec.ts` 仍在 page.goto 崩溃。此项尚未排除，不能标记全绿。日志为 `web-e2e-final.log`、`web-e2e-final-last-failed.log`；最终全量失败 trace/video 保存在 `e2e-final/`，最新失败保留在仓库 `test-results/`。
- 中间轮次包括初版焦点修复的 16/23（6 项崩溃、1 项聚焦失败）和对应定向 6/7；这些记录不作为最终版本通过证据。焦点逻辑最终修复后，完整命令导航/搜索/创建用例在最终全量通过。
- 最终 debug 无安装包构建、隔离启动冒烟通过；临时数据库/WebView 隔离、系统凭据禁用、测试进程和临时目录清理。日志为 `desktop-build-final.log`、`desktop-smoke-final.log`。
- 失败 trace/video 按轮次保留，未修改 Playwright 重试次数、超时或断言。没有运行安装器、签名发布或真实 Provider 质量评测。

## 回归发现的命令面板焦点问题

快速打开命令面板并输入本地搜索时，原 `afterOpenChange` 会在动画结束后强制聚焦命令框，可能把输入送到错误位置。失败快照中“调研”出现在命令框而非搜索框，与代码时序一致。

初版修复过度保留了弹窗默认聚焦的关闭按钮，导致重新打开后的命令框聚焦断言失败。浏览器诊断确认 activeElement 是 Close 按钮，随后修正为：保留已聚焦的文本输入；若焦点在默认关闭按钮、焦点陷阱或弹窗外，仍聚焦命令输入。四项组件测试覆盖搜索输入、弹窗外、焦点陷阱和默认关闭按钮。最终命令导航/搜索/创建 E2E 已通过；同轮草稿测试遇到 Runtime.callFunctionOn 的 Page crashed，另行跟踪浏览器问题。

这是本阶段回归发现的局部交互修复，不改变搜索查询/权限或新增功能。浏览器 page crash 的根因尚未确定，不将其归因于某个未经验证的环境因素，也不以定向通过替代全量结果。

## 停止条件

### 人工验收修复：查看修改两侧相同

用户反馈保存后“查看修改”的修改前后正文相同。定位到原弹窗直接读取 `activeDocument.content` 和 `draftContent`，自动保存会令二者相等，并会改变已经打开的对比。

修复：未保存时捕获保存版本与编辑内容；已保存时读取最近一个内容不同的历史版本，与当前内容对比。弹窗使用打开时的固定正文快照，不随自动保存变化；没有历史差异时显示明确提示，读取失败显示错误。关闭弹窗或切换成果后不接受过期请求回包。历史版本保存逻辑不变。

新增三项组件回归，覆盖自动保存期间对比不变、保存后读取历史正文、没有可比较版本。前端全量 check 为 61 文件 / 273 测试通过；重新完成 debug 构建和隔离冒烟。日志为 `result-comparison-check.log`、`result-comparison-build.log`、`result-comparison-smoke.log`。本修复没有改 Rust 业务代码，之前的 Rust 验证仍适用；上述 E2E 数字是修复前记录，本次未重跑浏览器 E2E。

### 人工验收修复：M0 样本 PDF 导出失败

原 PDF 仅内嵌 Noto Sans SC，遇到样本中的 emoji 会因缺字而拒绝导出。增加离线内嵌 Noto Emoji 黑白备用字体，按字符选择字体并使用对应宽度排版；每套字体单独重建 Unicode 映射，避免字体间字形编号冲突导致复制乱码。仍不支持的字符明确报告 Unicode 编号，不删除或替换原文。

新增完整 M0 Markdown 样本和 120 行多页混排回归，检查中文、emoji、组合字符的文字回读及字体嵌入；原“emoji 必须失败”断言改为成功并保留未覆盖字符拒绝检查。Rust 全量 243 测试通过、1 个原有预览生成器忽略，fmt/clippy 和第三方许可审计通过。初次定向编译曾发生 rustc STATUS_ACCESS_VIOLATION；后续完整编译及测试成功。本次未重跑前端单测或浏览器 E2E，前述开放问题仍保留。

配置边界例外仅为 `tauri.conf.json` 的 bundle.resources 增加备用字体许可证；其余 51 项冻结文件保持原 hash，权限、CSP、依赖、schema 和 IPC 不变。新字体原文件、许可证及来源 hash 记录在 THIRD_PARTY_NOTICES.md 和交付快照中。验证日志前缀为 `logs/v2x-f0/pdf-font-`。

已交付 [F0 人工验收](F0_MANUAL_ACCEPTANCE.md) 和 [交付快照](F0_DELIVERY_SNAPSHOT.json)，包含历史代码/产物/日志指纹。按用户最新要求，人工验收只包含产品功能和体验；工程补验、构建及 E2E 故障处理由代理负责，不需要用户另行要求或判断是否接受技术失败。

最新补验及开放问题统一记录在 [F0 工程验收](F0_ENGINEERING_ACCEPTANCE.md)。当前前端 273 项、Rust 243 项测试通过，但工程验收仍未通过；历史交付快照不能替代当前产物验收。两类验收通过并收到用户明确允许后才开始 M1-A/M1-B。
