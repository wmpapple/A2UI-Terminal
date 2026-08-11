# 阶段 8 验收说明：分发、更新与稳定性交付

## 交付结论

阶段 8 已补齐 Windows 发布工程、自动更新运行时、关键模块覆盖率、Playwright Web E2E、脱敏诊断导出、一键清除本地数据入口及交付文档。阶段 7 的 A2UI 与阶段 6 的真实文件 Patch/Diff/撤销保持原安全边界。

## 自动化验证

```text
npm run test:coverage
  Vitest：17 files / 46 tests 通过
  Statements：95.95%
  Branches：80.88%
  Functions：93.10%
  Lines：98.80%

npm run test:e2e
  Playwright Chromium：3 tests 通过
  覆盖三栏/中英文、上下文→A2UI、上下文→Patch→Diff→应用

cargo test --lib --all-features
  Rust：51 tests 通过

cargo test --test command_registration
  Tauri 命令注册与主窗口权限：1 test 通过

cargo clippy --all-targets --all-features -- -D warnings
  通过

npm run check
  Prettier / ESLint / TypeScript / 46 tests / Vite production build：通过

npm run tauri build
  Rust release / NSIS / MSI：通过

scripts/smoke-desktop.ps1
  隔离数据目录启动 5 秒：通过

scripts/verify-release.ps1
  package / Cargo / Tauri 版本 0.1.9 一致：通过

GitHub Actions YAML lint
  ci / security / internal-build / release：通过
```

本地验收包为 `A2UI Terminal_0.1.9_x64-setup.exe`（5.95 MB）和 `A2UI Terminal_0.1.9_x64_en-US.msi`（8.23 MB）。两者按设计为 `NotSigned`，只用于阶段验收；正式工作流会拒绝发布未签名产物。

## 发布安全保证

- PR CI 覆盖前端质量、覆盖率、Playwright、Rust 和桌面启动冒烟。
- 内部验收工作流只生成明确标记为 unsigned 的 NSIS/MSI。
- 正式发布只接受与三处版本一致的 `v*` tag，并使用受保护的 `production` environment。
- 缺少 PFX、密码、Publisher、updater 公钥或私钥时，工作流在构建前失败。
- 安装包 Authenticode 必须为 `Valid`，且必须存在 updater `.sig`；否则工作流失败。
- 正式产物先进入 Draft Release，人工验证前不会成为稳定更新源。
- updater 私钥、PFX 和密码不进入源码、配置文件、日志或工作流产物。

## 手工验收建议

1. 打开设置页，确认“更新、诊断与本地数据”同时支持中英文。
2. 在内部验收包点击“检查更新”，确认显示未配置更新源且不影响其他功能。
3. 导出诊断 JSON，确认只有版本、平台和各表计数，没有消息正文、文件内容、工作区路径、Endpoint 或 Key。
4. 点击“一键清除所有本地数据”，不输入精确确认文本时按钮不可用；暂不执行真实清除，除非已备份需要保留的应用历史。
5. 在 GitHub 手动运行 unsigned acceptance workflow，安装 NSIS/MSI，验证启动、升级覆盖安装与卸载。
6. 配置 production environment 后，以测试证书和 updater 测试密钥推送匹配版本 tag，确认 Draft Release 包含 EXE、MSI、`.sig` 和 `latest.json`。
7. 从上一测试版本检查更新，确认版本提示、下载进度、签名验证、安装和重启；篡改产物后必须拒绝更新。

## 外部验收条件

仓库已完成签名与更新能力，但本机没有产品负责人提供的正式代码签名证书、Publisher 和 updater 密钥，因此不能声称当前本地安装包已正式签名。真实签名、GitHub Draft Release 和上一版本升级需要在这些材料安全配置到 `production` environment 后完成。

请验证后明确回复“阶段 8 通过”；未收到确认前停止后续实施和正式发布。
