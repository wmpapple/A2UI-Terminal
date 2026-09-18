# S4.8 Windows 非签名范围人工验收

> 范围：只验收不依赖正式证书/私钥的 S4.8 步骤。通过本单也不等于 S4.8 整体完成，更不等于正式发布。

> 三个安装包都是本机刚构建的未签名测试包。请先核对 [S4_8_VALIDATION.md](S4_8_VALIDATION.md) 中的 SHA-256，只在 Windows Sandbox、虚拟机或已备份的测试账户中运行；不要分发给其他用户。

## 准备

1. 关闭正在运行的 A2UI 应用。
2. 准备一个不会影响日常数据的 Windows 测试环境。若必须在当前账户测试，先备份重要项目和导出成果。
3. 在 PowerShell 中执行：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\src-tauri\target\s4_8_upgrade-fixtures\A2UI Terminal_0.1.9_x64-setup.exe'
Get-FileHash -Algorithm SHA256 -LiteralPath '.\src-tauri\target\release\bundle\nsis\A2UI 工作台_2.0.0_x64-setup.exe'
Get-FileHash -Algorithm SHA256 -LiteralPath '.\src-tauri\target\release\bundle\msi\A2UI 工作台_2.0.0_x64_zh-CN.msi'
```

预期：三个 Hash 与验证记录完全一致。Windows 显示“未知发布者/未签名”是本轮的已知限制，不能把它忽略到正式发布。

## M01 干净安装与产品身份

1. 在没有已安装版本的测试环境运行 `A2UI 工作台_2.0.0_x64-setup.exe`。
2. 检查安装界面、开始菜单、窗口标题和“已安装的应用”。
3. 启动应用，打开设置并确认版本为 `2.0.0`；完成一次新建、保存和重启重开。

预期：用户可见名称都是“A2UI 工作台”，只按当前用户安装；保存内容重启后仍存在，没有出现名为“A2UI Terminal”的第二个新版应用。

## M02 从 0.1.9 升级并保留数据

1. 在全新的测试环境安装 `A2UI Terminal_0.1.9_x64-setup.exe`。
2. 启动旧版，创建至少一个托管成果、一个草稿/历史版本；配置一个仅供测试的 Provider Key，并记录能够确认其仍存在的非敏感状态。退出应用。
3. 运行 `A2UI 工作台_2.0.0_x64-setup.exe`。安装器应自动移除旧程序文件并安装新显示名，不应询问或删除应用数据。
4. 启动 2.0.0，检查成果、草稿/历史、设置状态和 Provider 已配置状态；打开并保存成果。
5. 查看“已安装的应用”和开始菜单。

预期：只剩“A2UI 工作台 2.0.0”；SQLite 历史、草稿、托管成果与测试凭据仍可使用；没有并列的旧快捷方式或旧卸载项。

## M03 MSI 安装身份

1. 在另一个干净测试环境运行 `A2UI 工作台_2.0.0_x64_zh-CN.msi`。
2. 检查中文安装界面、产品名称、版本和启动结果。
3. 通过系统“已安装的应用”执行一次正常卸载。

预期：MSI 能安装和启动，显示名为“A2UI 工作台”，版本为 2.0.0；正常卸载不删除应用数据目录、用户项目或导出文件。

## M04 NSIS 卸载与数据保护

1. 使用 NSIS 安装的 2.0.0 创建一个托管成果并退出。
2. 打开卸载器，不勾选“Delete app data/删除应用数据”，正常卸载；重新安装后确认成果仍可打开。
3. 再次打开卸载器，勾选“Delete app data/删除应用数据”并继续。

预期：默认卸载保留数据；勾选整目录删除时，卸载必须停止并提示先在应用“设置”中清除本地数据，不能静默删除托管成果，也不能假装已清除 Credential Manager。

若要验证主动清理：重新进入应用，在“设置”中执行“清除所有本地数据”，确认数据库记录和测试 Provider 凭据被清除、真实项目/托管成果文件仍在磁盘，再不勾选删除数据完成卸载。

## M05 修改后可继续开发

1. 不创建 `v2.0.0` tag，不发布 GitHub Release。
2. 若后续修改代码、依赖或安装配置，重新执行 `npm run audit:release`、完整质量门和安装包构建。

预期：当前 `2.0.0` 只是开发中的目标版本，不会阻止后续修改；新构建的安装包必须生成新的 Hash，旧验收包不得继续冒充最新候选。

## 不在本轮验收范围

- Authenticode `Valid`、正式 Publisher。
- Updater `.sig`、`latest.json` 和真实在线更新。
- 安装包或更新元数据被篡改后的签名拒绝。
- production environment 审批和 GitHub Draft Release。

这些项目必须在正式材料到位后按 [RELEASE.md](RELEASE.md) 补验。未补验前不得回复“S4.8 验收通过”。

## 验收回复

以上非签名步骤全部通过后，请回复：`S4.8 非签名项验收通过`。若失败，请提供 M 编号、安装包类型、界面提示和是否保留数据；不要发送真实 Key、正文或数据库。
