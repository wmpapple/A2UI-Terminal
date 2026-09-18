# S4.8 Windows 发布、升级与签名验证记录

> 状态：非签名实现与自动验证完成，待人工验收；正式签名子项因未提供材料而阻塞。S4.8 尚未整体完成。

## 已完成范围

- 大众显示名统一为“A2UI 工作台”，版本统一为 `2.0.0`。
- 保留 `com.a2ui.terminal`、`a2ui-terminal`、`a2ui-terminal.sqlite3` 和 `com.a2ui.terminal.provider`，避免改名造成应用数据和 Credential Manager 命名空间漂移。
- 固定历史 MSI UpgradeCode `04082aee-f6fd-526d-9670-71abf0ca6863`，WiX 使用 `zh-CN`，NSIS 使用 `currentUser`。
- NSIS 安装钩子可迁移旧显示名“A2UI Terminal”的当前用户安装，并通过 `/UPDATE` 保留应用数据。
- 升级默认保留数据。卸载默认也保留数据；NSIS 会阻止安装器的整目录“Delete app data”选项，避免误删托管成果。需要清除数据库和系统凭据时，必须先在应用“设置”中执行“清除所有本地数据”，再正常卸载。
- 普通 CI、内部未签名构建和正式签名发布分别使用开发、未签名验收、正式签名三种校验模式；基础配置不含 updater 公钥、端点或私钥。
- 生成了真实的 `0.1.9` NSIS 升级夹具，以及 `2.0.0` NSIS/MSI 未签名验收包。

## 安装包证据

这些文件位于本机 `target` 目录，不纳入 Git，也不能对外发布。执行 `cargo clean` 后需要重新构建。

| 文件                                                                       |     字节 | SHA-256                                                            |
| -------------------------------------------------------------------------- | -------: | ------------------------------------------------------------------ |
| `src-tauri/target/s4_8_upgrade-fixtures/A2UI Terminal_0.1.9_x64-setup.exe` | 16663962 | `A6A7304D636C234FD0B9CDC681B1ED79FA23BE99974FE414E2CC882F749FFB8A` |
| `src-tauri/target/release/bundle/nsis/A2UI 工作台_2.0.0_x64-setup.exe`     | 16661199 | `54AA81860EE6F017694E7D79407864F831B2670289B0150B0BE198F2330CA489` |
| `src-tauri/target/release/bundle/msi/A2UI 工作台_2.0.0_x64_zh-CN.msi`      | 23154688 | `CBC7C8D2A6A26159DF2C20F0F53F840F2BD542ADDAF80E2524B56E2491E3D524` |

`verify-windows-artifacts.ps1 -Mode UnsignedAcceptance` 已确认新版两个安装包均为 `NotSigned`，且不存在 `.sig`。这正是本轮预期，不代表正式发布合格。

## 自动验证

- `npm run audit:release`：通过。
- `verify-release.ps1 -Mode UnsignedAcceptance`：通过。
- `verify-release.ps1 -Tag v2.0.1`：按预期拒绝版本不一致。
- `verify-release.ps1 -Tag v2.0.0 -Mode SignedRelease`：在缺少受保护材料时按预期拒绝，并列出缺失输入。
- `verify-windows-artifacts.ps1 -Mode UnsignedAcceptance`：2 个安装包通过，均未签名。
- `npm audit --omit=dev --audit-level=high`：0 个漏洞。
- `npm run audit:beta-evidence`、`npm run audit:third-party`：通过；生产依赖 146 个，Windows Rust 依赖 398 个。
- `npm run check`：格式、lint、typecheck、48 文件/224 项 Vitest 与 production build 全部通过；仅保留既有 Vite 大 chunk 提示。为使同一门在 Git LF 与 Windows CRLF 检出下可重复执行，Prettier `endOfLine` 固定为 `auto`。
- Vitest：48 个文件、224 项测试全部通过；Statements 97.97%、Branches 84.21%、Functions 96.66%、Lines 98.80%。
- Playwright：最终完整回归 17/17 通过。此前一次并行运行有 3 项因本机 Chromium worker 崩溃失败，3 项隔离复跑通过，随后完整复跑通过。
- Rust：`cargo fmt --check`、Clippy `--all-targets --all-features -D warnings`、全量测试通过；193 项库测试通过、1 项 PDF 视觉测试忽略，33 项集成测试通过，文档测试通过。
- Release 可执行文件启动冒烟通过。
- NSIS 与 WiX 均成功生成。WiX 保留上游模板的 ICE03、ICE40、ICE57、ICE61 警告，没有致命错误；中文产品名通过 `zh-CN` codepage 构建。

## 尚未验证和阻塞项

- 尚未由用户执行真实安装、0.1.9 → 2.0.0 升级和卸载人工验收。
- 未提供正式 PFX、证书密码、Publisher、Updater 公钥/私钥，因此没有 Authenticode、`.sig`、`latest.json`、签名篡改拒绝或真实 updater 升级证据。
- 没有创建 tag、没有创建或发布 GitHub Release，也没有修改远端仓库。
- 只有最终选定提交的 `v2.0.0` tag 才会冻结发布候选；当前仍可继续改代码。每次修改后必须重新跑发布审计并重建安装包，旧 Hash 随即失效。

非签名人工步骤见 [S4_8_MANUAL_ACCEPTANCE.md](S4_8_MANUAL_ACCEPTANCE.md)。
