# Windows 构建、签名与自动更新

## 三条流水线

- `.github/workflows/ci.yml`：PR/main 强制执行前端检查、关键模块覆盖率、Playwright Web E2E、Rust fmt/clippy/test、无安装包桌面构建和启动冒烟。
- `.github/workflows/internal-build.yml`：手动生成未签名 NSIS/MSI 验收包。该产物不得作为正式版本发布。
- `.github/workflows/release.yml`：推送与版本完全一致的 `v*` tag 后，在受保护的 `production` environment 中构建 Authenticode 签名安装包和 Tauri updater 产物，并创建 Draft Release。

## GitHub production 配置

Repository/Environment variables：

- `WINDOWS_PUBLISHER`：安装包 Publisher。
- `TAURI_UPDATER_PUBLIC_KEY`：Tauri updater 公钥内容，不是文件路径。

Environment secrets：

- `WINDOWS_CERTIFICATE_BASE64`：代码签名 PFX 的 Base64 内容。
- `WINDOWS_CERTIFICATE_PASSWORD`：PFX 密码。
- `TAURI_SIGNING_PRIVATE_KEY`：Tauri updater 私钥内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥密码；无密码时可留空。

建议为 `production` environment 配置审批人。任何必填材料缺失都会在导入证书前失败。PFX 只短暂写入 runner 临时目录，导入用户证书库后立即删除；任务结束时证书也会从 runner 证书库移除。

## 版本与 tag

以下版本必须完全一致：

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

发布 tag 必须为 `v<version>`，例如版本 `1.0.0` 只能使用 `v1.0.0`。可在本地执行：

```powershell
./scripts/verify-release.ps1 -Tag v1.0.0
```

## 自动更新

基础开发/内部构建不包含更新 endpoint 和公钥，更新检查会安全显示“未配置”，不阻塞启动。正式工作流生成临时 `tauri.release.conf.json` 配置覆盖层：

- `bundle.createUpdaterArtifacts = true`
- endpoint 指向当前仓库 `releases/latest/download/latest.json`
- updater 公钥来自 GitHub variable
- Windows 更新安装模式为 `passive`

updater 私钥仅通过 `TAURI_SIGNING_PRIVATE_KEY` 注入。Tauri 会为 NSIS/MSI 生成 `.sig`，`tauri-action` 同时生成并上传 `latest.json`。客户端只安装签名验证通过且版本更高的更新。

## 正式发布流程

1. 更新三处版本号并运行完整验证。
2. 合并到主分支后创建并推送匹配的 `v*` tag。
3. production 审批人允许工作流访问签名材料。
4. 工作流验证代码质量、版本、AuthentiCode、updater `.sig` 和桌面启动。
5. 工作流创建 Draft Release；下载产物完成干净安装、上一版本升级、卸载和数据保留验证。
6. 人工发布 Draft。发布后 `latest.json` 才会成为稳定更新源。

## 发布验收

- `Get-AuthenticodeSignature` 对所有 EXE/MSI 返回 `Valid`。
- Release 同时包含 NSIS、MSI、相应 `.sig` 和 `latest.json`。
- 从上一正式版本检查更新，可看到版本与说明，下载进度可见，安装后应用重启。
- 篡改安装包或签名后 updater 必须拒绝安装。
- 升级保留 SQLite 历史、草稿和 Credential Manager Key；卸载/清除数据策略与隐私说明一致。
- “一键清除所有本地数据”删除应用数据库与系统凭据，但不删除用户真实项目文件。

代码签名证书和 updater 私钥必须分别备份到受控密钥系统。丢失 updater 私钥后，已安装客户端无法信任用新密钥签名的更新。
