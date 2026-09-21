# M0 人工验收

状态：**用户已确认测试通过**。用户回复“测试通过，开始下一阶段”，已授权 F0。以下保留 M0 验收步骤与证据边界；F0 完成后仍需单独人工验收。

## 1. 审阅范围与开放问题

- [ ] 阅读基线报告，确认 schema18/94命令及当前成果助手占位的现状准确。
- [ ] 审阅 [架构草案](M0_ARCHITECTURE_DECISIONS.md)：资料独立、原地编辑不绑定 Ghost Diff、PDF页级/DOCX段落级、模型质量用 Eval 管理。
- [ ] 选择：接受 E2E 间歇性 page crash 作为需跟踪的基线问题，或要求 M0 内继续排查。当前没有单次全量 E2E 全绿证据。
- [ ] 确认 AI 商业策略尚未选择。可在此给出内置/BYOK/混合偏好；未选择不会被代理解释为同意 BYOK，M1-B 范围冻结前需决定。

## 2. 在隔离桌面窗口检查当前功能

构建产物：`src-tauri/target/debug/a2ui-terminal.exe`，debug、未签名、无安装包；SHA-256 见 [交付快照](M0_DELIVERY_SNAPSHOT.json)。不要双击本轮产物做隔离验收：无参数启动沿用日常数据目录。可在 PowerShell 中执行以下命令打开专用测试环境（窗口关闭后保留测试目录供检查）：

```powershell
Set-Location 'D:\A2UI\A2UI-Terminal'
$m0ReviewRoot = Join-Path ([IO.Path]::GetTempPath()) "a2ui-terminal-smoke-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $m0ReviewRoot | Out-Null
Write-Output "本轮测试目录：$m0ReviewRoot"
& '.\src-tauri\target\debug\a2ui-terminal.exe' --smoke-test-root $m0ReviewRoot
```

每次启动必须是全新空目录。此模式禁用系统凭据，不能用于远端 Provider 联调；无需输入 API Key。测试导入/导出的文件也只选择自己新建的测试目录。若要检查跨重启持久化，当前 smoke 模式会拒绝复用非空根，该项先依赖自动测试；后续专门的持久人工测试环境需另行安排。

- [ ] 窗口正常显示，可完成/跳过引导，无白屏。
- [ ] 使用 [样本原文](M0_ACCEPTANCE_SAMPLES.md) 新建文本成果，编辑并等待保存；在同一次运行内退出成果再重开，正文一致。
- [ ] 修改标题/正文，查看版本与置顶/取消置顶，确认交互和排序符合现有产品预期。
- [ ] 将样本 MD 导入测试工作区，本地预览内容与原文一致。
- [ ] 导出成果到测试目录并实际打开；确认中文、日期、金额可读。同名文件存在时不静默覆盖。
- [ ] 成果助手占位符合当前基线记录，没有把未实施功能误当故障或已交付能力。
- [ ] 关闭窗口；测试根内有 `ready.json` 和 `app-data`，凭据禁用标记为 true。资料清理只针对这次输出的临时目录，保留导出文件作为验收证据。

自动冒烟可另行执行，约数秒后自动关闭并清理自己的临时目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-desktop.ps1 -BinaryPath src-tauri/target/debug/a2ui-terminal.exe
```

## 3. 不混淆尚未完成的验证

真实 Provider 写作质量/完整文件修改闭环、跨重启人工检查、安装升级、签名与更新服务尚未实测。Rust 临时数据库/本地 fixture、Web Mock 和启动存活不能替代这些项目。S4.8/O-06/O-08 继续保持独立发布依赖。

记录问题时提供步骤、预期、实际及使用的样本编号即可；不要附密钥或真实资料。若某项未检查，请写“未测”，不默认通过。

## 4. 用户结论

当前：用户已明确确认测试通过并授权下一阶段。具体勾选记录未逐项提供，不代填各项实测结果。

可回复“ M0 验收通过，允许进入 F0 ”，或列出需修改项/希望补测项。只有明确通过并允许继续后才启动下一阶段；一般讨论、修改建议或本轮自动测试完成都不构成下一阶段授权。
