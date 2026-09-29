# M8 正文格式入口修复

原因：加粗、斜体入口原先仅在结构化面板内，成果正文源码编辑区缺少手动格式按钮。

现在可在 Markdown 成果正文选中文字，直接点击上方“加粗、斜体”。按钮保留选区，修改沿用正文草稿与自动保存流程。多行选择逐行处理，保留标题、引用和列表前缀及空白。阅读模式显示格式效果。纯文本、CSV 和只读内容不展示这些 Markdown 格式操作。

验证：3 个测试文件共 22 项通过，TypeScript、ESLint、改动文件格式检查通过。真实 Tauri / WebView2 隔离环境验证了正文选区加粗、自动保存、刷新后从成果列表重开并保留格式，以及原 M8 结构化审阅回归；无页面错误。自动化使用本地模拟服务，不涉及用户凭据或真实模型。

- 新验证程序：`logs/m8-formatting-fix-review/a2ui-terminal.exe`
- SHA256：`c2df5a9947db311afbb7c68524376218106e9e0aed1945f63d0d0141fbd71f2e`
- 桌面证据：`logs/m8-formatting-desktop/report.json`
- 单测与检查：`logs/m8-formatting-tests.log`、`logs/m8-formatting-typecheck.log`、`logs/m8-formatting-lint.log`、`logs/m8-formatting-format.log`
- 原始 M8 程序及交付快照保留；本文件记录验收期修复。

仍停留在 M8 人工验收阶段，未进入 M9。
