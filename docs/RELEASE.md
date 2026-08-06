# Windows 构建、签名与自动更新

## 当前阶段

`.github/workflows/release.yml` 可手动生成未签名的 NSIS 和 MSI 测试安装包，用于阶段 3 启动验收。正式发布不得使用该产物。

## 正式发布前置条件

产品负责人仍需提供：

- Windows 代码签名证书、Publisher 信息和安全的签名方式；
- Tauri updater 签名公钥及保存在 GitHub Secrets 中的私钥；
- 更新清单的 HTTPS 托管地址，默认建议 GitHub Releases；
- 正式版本号和 tag 规则。

这些材料到位后，再启用 `bundle.createUpdaterArtifacts`、Updater 插件、发布 tag 工作流和安装包签名。仓库及构建日志中不得出现证书密码、PFX、更新私钥或 Provider Key。

## 验证要求

- PR：前端检查、Rust fmt/clippy/test、无安装包桌面构建；
- 手动内部构建：NSIS/MSI 安装、启动、卸载冒烟；
- 正式 tag：代码签名验证、更新签名验证、从上一版本升级和失败回滚验证。
