# S2.8 自动验证与交付记录

## 2026-09-10 人工验收缺陷修复（LOG-0098—0099，当前事实）

- 已修复 Markdown PDF 基础排版以及系统确认替换后仍失败的问题，仍待用户复验，未开始 S2.9。下面 2026-09-08 的检查表保留为历史证据，其中“一律拒绝已有目标”已被确认后安全替换取代。
- Rust：`cargo +stable test --manifest-path src-tauri/Cargo.toml --locked --offline --all-features -j 1`，138 单测与 17 集成测试通过，共 155；默认忽略的 1 个预览产物测试单独以 `--ignored` 运行通过。严格 all-targets/all-features Clippy 与 fmt 通过。
- 前端：lint/typecheck/build 通过，`npm test -- --maxWorkers=1` 40 文件/171 测试通过；导出 E2E `npm run test:e2e -- --grep 'exports the saved Result' --workers=1` 1/1 通过。本轮未重跑全部 E2E 和覆盖率，不把前轮结果当作本轮结果。
- M02 创建入口：`spreadsheet + csv + .csv` 合同不变，新建下拉框改为明确显示“表格（CSV）”；`npm run test:e2e -- --workers=1 --grep "creates and reopens typed spreadsheet"` 1/1 通过，覆盖创建、编辑、保存和重开。同步重跑 lint、typecheck、40 文件/171 项 Vitest 与生产构建，均通过。
- 真实视觉检查：执行 `cargo +stable test --manifest-path src-tauri/Cargo.toml --locked --offline --all-features write_manual_layout_preview --lib -j 1 -- --ignored`，得到 `src-tauri/target/s2.8-pdf-layout-preview/acceptance.pdf`；使用本机 Windows.Data.Pdf 渲染并查看首两页 PNG，确认标题层级、引用竖线、代码背景、列表与换行。测试素材是本验收文档，不含用户私有正文；产物留在忽略目录。
- 文件提交：按 Rust 原生保存对话框确认处理已有目标，完整生成临时文件并同步后再原子替换；Hash/时间/大小复验、取消/占用失败保留旧文件、新文件竞争 no-clobber、源成果/管理目录保护均有测试。最终指纹复核是乐观并发检查，不声称跨其他进程的文件系统事务。
- 确认依据：核对锁定的 rfd 0.16 Windows `build_save_file` 保留默认保存选项；Windows 保存对话框默认包含覆盖询问，见 [Microsoft 官方说明](https://github.com/MicrosoftDocs/win32/blob/docs/desktop-src/shell/common-file-dialog.md)。同目录替换使用 tempfile 的 [原子 persist 合同](https://docs.rs/tempfile/3.27.0/tempfile/struct.NamedTempFile.html#method.persist)，不采用先删除目标再写入。
- 依赖：pulldown-cmark 0.13.0（关闭默认 HTML/CLI features）和 unicase 2.9.0；既有 ttf-parser 0.19.2 转为直接字宽测量依赖。MIT 许可文本与声明已归档，字体字节未修改。完整本轮文件列表见 LOG-0098，包含新 `export_pdf.rs`、`export_target.rs` 与两个许可证文件；无 schema/IPC/Capability 新增。
- 需重新运行桌面应用，复验 M01 和 M04；本轮为解除缓存锁竞争停止了核实属于此项目的热重载 Cargo 进程，未清除数据或修改全局工具链。文件被阅读器独占时必须关闭占用后重试；不保证强行覆盖。全库历史格式差异仍保留，未声称 `npm run check` 全绿。

## 2026-09-08 基线验证（历史）

日期：2026-09-08（Asia/Shanghai）。基线：main / 7375f52（S2.7）。
关联：实施账本 LOG-0095/0096、ADR-021。当前为待人工验收，不是已完成。

## 结果

| 检查                 | 命令                                                                                                                                 | 实际结果                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| TypeScript           | `npm run typecheck`                                                                                                                  | 通过                                                        |
| ESLint               | `npm run lint`                                                                                                                       | 通过                                                        |
| 单测和配置覆盖率门槛 | `npm run test:coverage -- --maxWorkers=1`                                                                                            | 40 文件，170 测试通过                                       |
| Web Mock 浏览器回归  | `npm run test:e2e -- --workers=1`                                                                                                    | 11/11 通过，含新增导出流程                                  |
| 前端生产构建         | `npm run build`                                                                                                                      | 通过；保留已有大 chunk 提示                                 |
| Rust 格式            | `cargo fmt --manifest-path src-tauri/Cargo.toml --check`                                                                             | 通过                                                        |
| Rust 单测和集成测试  | `cargo +stable test --manifest-path src-tauri/Cargo.toml --locked -j 1`                                                              | 132 单测 + 6 架构 + 1 命令权限 + 10 合同，共 149 通过       |
| Rust 全功能测试      | 上述 test 命令增加 `--all-features`                                                                                                  | 同样 149 通过                                               |
| Rust 严格 lint       | `cargo +stable clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -j 1 -- -D warnings`                | 通过                                                        |
| 桌面构建             | `cargo +stable build --manifest-path src-tauri/Cargo.toml --locked --all-features -j 1`                                              | debug 构建通过                                              |
| 桌面启动冒烟         | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-desktop.ps1 -BinaryPath src-tauri/target/debug/a2ui-terminal.exe` | 隔离数据目录启动通过；脚本关闭测试进程并清理其临时目录      |
| 变更代码格式         | 对本次 TS/TSX/JSON 运行 `prettier --check`                                                                                           | 单独检查，不批量改写无关文件                                |
| 全库格式             | `npm run format:check`                                                                                                               | 未通过：已有格式/CRLF 差异仍在，未声称 `npm run check` 全绿 |

覆盖率仅对应仓库已配置的 streamBuffer/contextSnapshot 关键逻辑范围：
statements 97.97%、branches 84.72%、functions 96.66%、lines 98.8%，均超过 70%。
这不是整个项目、导出组件或 Rust 代码覆盖率。

## 实际导出断言

- Rust 真正生成 DOCX、XLSX、PDF、RTF、CSV、JSON 字节，不以 Mock 代替生成器测试。
- 打开 ZIP/XML 校验 DOCX 文本/缩进/XML 转义、XLSX 首行/末行/跨行内容及无公式/超链接。
- CSV 首行、空单元格、不等长行、引号/逗号/换行和公式型文本防护。
- PDF 85 行中文分页，提取验证首尾文字；嵌入 FontFile2 为真实 TrueType/glyf；缺失字体字符明确失败，Tab 展开可导出。
- RTF 非 BMP 字符按 UTF-16 代理对编码。
- JSON 拒绝结构之外的调试字段，清单/表单 PDF 呈现用户可读字段。
- SQLite/文件夹隔离测试绑定精确当前 Revision；跨 Result、旧 Revision、外部改动均拒绝。
- 取消前提交为零写入；并发两个 writer 只有一个成功，已有目标原字节不变，无临时残留。
- Rust/TS 同用 export fixture；前端路径/正文/Prompt/Context Manifest 等额外输入被 Rust serde 拒绝。
- 界面单测验证保存顺序、保存失败不导出旧内容、重复点击防护和卸载取消；Mock 验证并发、取消/重试、版本变化。

## 本机验证环境和失败记录

本机此前出现 Rust 随机 access violation/ICE/LLVM OOM，以及 Vitest 并行 worker
异常退出；本次未把这些当作断言通过。使用已有 stable 1.98.0、当前 PowerShell
进程 CPU affinity=1、`RUST_MIN_STACK=33554432`、`CARGO_INCREMENTAL=0`、
Cargo `-j 1`，Vitest/Playwright 单 worker 后完成上述运行。只影响当前进程及子进程，
没有修改全局 Rust 工具链或用户环境配置。编译器崩溃根因未被证明，不能断言是项目代码或硬件故障。

开发中实际发现并修复 PDF 字体 CFF/TrueType 不匹配、CJK 兼容字形 Unicode
映射、CSV 首行遗漏、非原子防覆盖和同步 IPC 问题。测试自身的 Mock 清理及
带图标/中文双字按钮定位也已修正后复跑。最终证据以本页结果为准，不删除历史失败账本。

## 待人工检查与限制

真实原生保存对话框交互、实际 Word/Excel/PDF 阅读器视觉效果、无写权限目录、
现场取消体验及源文件并发改动，请执行 [人工验收单](S2_8_MANUAL_ACCEPTANCE.md)。
没有执行正式安装器/签名发布；启动冒烟不等于完成真实导出手工验收。

P0 仅基础结构：复杂排版、宏、公式计算和 Office/PDF 无损回写不承诺。
XLSX 按文本单元格导出；PDF 缺字/同字形映射歧义明确拒绝。取消可在库调用返回
后阻止提交，不保证立即停止 CPU 生成；原子提交开始后不能撤回。
Web Mock 明确显示未创建文件，不访问文件系统/Provider。

旧的 CFF 字体仅移动到忽略目录
`src-tauri/target/s2.8-replaced-font/NotoSansCJKsc-Regular.otf`，可恢复。
当前 TTF 来源、哈希、OFL 和新增依赖许可证见
[第三方声明](../src-tauri/THIRD_PARTY_NOTICES.md)。字体已 include_bytes 嵌入，
许可证与声明配置为安装包资源，未生成或宣称已检查正式安装包。

## 修改/新增文件完整清单

以下包括本轮继续完成的既有未提交 S2.8 文件，以及本轮修复和证据文件。
没有 schema migration；没有开始 S2.9。

```text
contracts/v2/export.json
docs/S2_8_MANUAL_ACCEPTANCE.md
docs/S2_8_VALIDATION.md
docs/V2_ARCHITECTURE.md
docs/V2_IMPLEMENTATION_PLAN.md
e2e/web-mock.spec.ts
src-tauri/Cargo.lock
src-tauri/Cargo.toml
src-tauri/THIRD_PARTY_NOTICES.md
src-tauri/assets/fonts/NotoSansSC-VF.ttf
src-tauri/assets/fonts/OFL.txt
src-tauri/assets/licenses/aliasable-0.1.3-LICENSE.txt
src-tauri/assets/licenses/allsorts-0.14.2-LICENSE.txt
src-tauri/assets/licenses/bitreader-0.3.11-LICENSE-MIT.txt
src-tauri/assets/licenses/brotli-decompressor-2.5.1-LICENSE.txt
src-tauri/assets/licenses/bstr-1.13.1-LICENSE-MIT.txt
src-tauri/assets/licenses/docx-rs-MIT.txt
src-tauri/assets/licenses/either-1.18.0-LICENSE-MIT.txt
src-tauri/assets/licenses/glyph-names-0.2.0-LICENSE.txt
src-tauri/assets/licenses/itertools-0.10.5-LICENSE-MIT.txt
src-tauri/assets/licenses/lazy_static-1.5.0-LICENSE-MIT.txt
src-tauri/assets/licenses/linked-hash-map-0.5.6-LICENSE-MIT.txt
src-tauri/assets/licenses/lopdf-0.31.0-LICENSE.txt
src-tauri/assets/licenses/md5-0.7.0-LICENSE.md.txt
src-tauri/assets/licenses/ouroboros-0.17.2-LICENSE_MIT.txt
src-tauri/assets/licenses/ouroboros_macro-0.17.2-LICENSE_MIT.txt
src-tauri/assets/licenses/owned_ttf_parser-0.19.0-LICENSE.txt
src-tauri/assets/licenses/pom-3.4.0-LICENSE.txt
src-tauri/assets/licenses/printpdf-MIT.txt
src-tauri/assets/licenses/rust_xlsxwriter-Apache-2.0.txt
src-tauri/assets/licenses/rust_xlsxwriter-MIT.txt
src-tauri/assets/licenses/rustc-hash-1.1.0-LICENSE-MIT.txt
src-tauri/assets/licenses/static_assertions-1.1.0-LICENSE-MIT.txt
src-tauri/assets/licenses/tempfile-3.27.0-LICENSE-MIT.txt
src-tauri/assets/licenses/ttf-parser-0.19.2-LICENSE-MIT.txt
src-tauri/assets/licenses/typed-path-0.12.3-LICENSE-MIT.txt
src-tauri/assets/licenses/ucd-trie-0.1.7-LICENSE-MIT.txt
src-tauri/assets/licenses/unicode-canonical-combining-class-0.5.0-LICENSE.txt
src-tauri/assets/licenses/unicode-general-category-0.6.0-LICENSE.txt
src-tauri/assets/licenses/unicode-joining-type-0.7.0-LICENSE.txt
src-tauri/assets/licenses/zip-8.6.0-LICENSE.txt
src-tauri/build.rs
src-tauri/capabilities/main.json
src-tauri/src/application/export.rs
src-tauri/src/application/mod.rs
src-tauri/src/application/result.rs
src-tauri/src/commands.rs
src-tauri/src/domain/export.rs
src-tauri/src/domain/mod.rs
src-tauri/src/lib.rs
src-tauri/src/state.rs
src-tauri/tauri.conf.json
src-tauri/tests/command_registration.rs
src-tauri/tests/contract_fixtures.rs
src/app/i18n/messages.ts
src/features/results/components/CreateTextResultModal.tsx
src/features/results/components/ExportResultModal.test.tsx
src/features/results/components/ExportResultModal.tsx
src/features/results/components/ResultWorkbench.tsx
src/features/results/resultController.ts
src/shared/contracts/contracts.test.ts
src/shared/contracts/guards.ts
src/shared/mock/home.test.ts
src/shared/mock/home.ts
src/shared/platform/desktop.ts
src/shared/types/domain.ts
src/shared/types/exportFormats.ts
```

## 生成文件

由 Tauri build manifest 与 capability 生成；不得手工扩大权限。

```text
src-tauri/gen/schemas/acl-manifests.json
src-tauri/gen/schemas/capabilities.json
src-tauri/gen/schemas/desktop-schema.json
src-tauri/gen/schemas/windows-schema.json
src-tauri/permissions/autogenerated/cancel_export.toml
src-tauri/permissions/autogenerated/export_result.toml
```

Cargo.lock 由 Cargo 更新。dist、src-tauri/target、coverage、test-results 为
忽略的构建/验证产物；不包含用户工作数据，不作为源码提交。
