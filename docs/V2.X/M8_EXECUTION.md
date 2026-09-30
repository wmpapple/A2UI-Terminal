# M8 结构化文档

2026-09-29：用户确认 M7 验收通过，授权 M8。代码起点 `7f66ced`，工作树干净。完成后停在 M8 人工验收，不进入 M9。

后续验收记录：用户已明确「M8 验收通过，开始下一阶段」，M9 执行见 [M9_EXECUTION.md](M9_EXECUTION.md)。以下保留 M8 原始工程记录。

## 实现

- 新增平台无关文档 AST、稳定结构块 ID、Markdown 原文切片适配和结构快照存储。Schema 从 27 顺延到 28，未重排历史 migration。
- 成果与授权工作区的 Markdown 文档新增“结构化编辑”：段落、标题、粗斜体、列表、表格单元格、移动/删除、PNG 与分页。原有源码编辑继续可用。
- 所有结构修改和 Word/Markdown 导入均经统一 Review，接受后写入与生成历史；正文/版本变化时旧候选被拦截。打开工作区文件和结构缓存不自动创建成果或扩大授权。
- Word 改为按语义结构导出，导入为副本；PNG 只使用选定文件或内嵌数据，不请求图片网址。格式能力与降级说明见 [编辑器 ADR](M8_EDITOR_ADR.md)。PDF 输入保持只读，输出支持分页但不承诺图片和表格布局保真。
- 信息提示可关闭；中文界面提供中文操作说明。既有 BYOK/本地模型接入不变；本期结构操作无需模型。

## 工程验证

工程检查通过：Rust 323 项（3 项原有可选测试默认忽略），前端 73 个测试文件/323 项，浏览器端到端 37 项。类型、ESLint、Prettier、Rustfmt、严格 Clippy、许可、既有 Beta 证据和未签名验收配置均通过。Windows 调试程序已构建。真实桌面验证使用隔离数据和回环测试服务，检查结构化提案确认前不写入、表格修改、插入/放弃、稳定 ID、过期提案拦截、页面重载恢复以及实际修改段落文字并加粗。页面未处理异常为 0，结构编辑没有模型请求。

桌面复验修复了两个富文本适配问题：整段加粗时不把段落边界包进 Markdown 格式标记；React 重绘不重置可编辑区域的正文或选区。表格修改只替换目标单元格的源切片，保留其他单元格的链接、代码和对齐；改变标题级别保留原有内联语法与 `C#` 等文字。统一撤销按钮改称“审阅修改”，涵盖手工结构编辑和 AI 提案。

最终二进制哈希与桌面报告由 `npm run audit:structured` 从实际日志生成，见 `M8_DELIVERY_SNAPSHOT.json`。覆盖率仍限于项目原有配置的聊天缓冲/上下文快照子集，不代表全仓覆盖率。本阶段不包含真实模型质量认证。Word 格式往返和 PNG/分页由 Rust 测试验证，系统导入选择器和真实 Word 应用中的视觉排版留作产品验收项。

命令：

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage -- --maxWorkers=2
npx playwright test --workers=1
cargo test --manifest-path src-tauri/Cargo.toml --all-features -j1 -- --test-threads=1
cargo +stable clippy --manifest-path src-tauri/Cargo.toml --all-features --all-targets -j1 -- -D warnings
npm run tauri build -- --debug --no-bundle
npm run test:structured:desktop
npm run audit:structured
```

## 交付与阶段边界

独立验收程序：`logs/m8-structured-review/a2ui-terminal.exe`；也可使用 `npm run desktop:dev`。保留 M7 验收程序。此调试程序供人工功能验收，不代表已签名的安装器发行。

用户仅需按 [M8_MANUAL_ACCEPTANCE.md](M8_MANUAL_ACCEPTANCE.md) 验证产品功能。M9 必须等待用户明确接受 M8 并授权。

状态：工程完成，停在 M8 人工验收。M9 未开始。
