# S4.6 隐私、诊断、清理与安全审计人工验收

> 范围：只验收 S4.6；通过前不得开始 S4.7。
>
> M03 会永久清除应用数据库、Provider Key 和界面偏好。请只在确认当前应用数据可清除时执行；真实项目文件、`my-results` 托管成果文件和已导出文件会保留，但应用内索引、历史和授权不会保留。不要把 API Key 抄入测试文档或截图。

## 准备

1. 在项目根目录执行 `npm run desktop:dev`。
2. 准备一个不含隐私的临时项目目录，建立 `keep-after-clear.md`，内容为 `S4.6 保留验证`。
3. 将该目录加入工作区；新建一个测试成果并导出到临时项目目录，记住两个文件名。
4. 若当前 Provider Key 仍需使用，确保清理后可以从原始安全来源重新配置；不要建立明文备份。

## M01 脱敏诊断

1. 在设置中点击“导出脱敏诊断”，保存 JSON。
2. 用文本编辑器打开；确认有 `formatVersion: "1.1"`、应用/Schema/平台/架构、`counts` 和 `privacy`。
3. 搜索临时项目名称、两个测试文件名、测试正文、Provider Endpoint/模型名；均不得出现。
4. `privacy` 中正文、文件内容/名称、Prompt、模型回复、路径、Endpoint、密钥和原始日志对应值都应为 `false`。

预期：诊断只含版本、环境和各 V2 数据域数量；不含可读正文、名称、路径、Provider 配置、密钥或日志。

## M02 清理确认与失败保持

1. 点击“一键清除所有本地数据”，阅读黄色说明；应明确保留项目文件、托管成果文件和导出文件，同时永久清除应用记录、凭据和界面偏好。
2. 输入错误文本 `DELETE_ALL`，确认按钮必须禁用；取消后数据仍在。
3. 再次打开并输入精确文本 `DELETE_ALL_LOCAL_DATA`。

预期：危险操作不能被模糊确认或一次误触触发；取消/错误确认不改变任何数据。

## M03 完整清理与文件保留

1. 在 M02 精确确认后执行清理，等待应用重载。
2. 检查最近项目、成果、会话/历史、个人 Surface、Context Pack、恢复摘要和匿名指标计数均已清空；匿名指标恢复默认关闭，简单/专业模式和首次引导偏好恢复默认。
3. 打开 Provider 设置；此前配置的 Provider 应显示未配置，需要重新输入 Key。
4. 在资源管理器检查 `keep-after-clear.md` 和已导出文件仍存在、内容未变。
5. 托管成果文件不要求从 UI 重新出现：数据库索引已按设计清除；其“不删磁盘文件”由 Rust 自动回归同时证明。

预期：应用数据、凭据、进程内临时状态和 WebView 偏好被清除；真实项目/托管成果/导出文件没有被删除或改写。

## M04 对抗 fixture

在新的 PowerShell 执行：

```powershell
$env:RUSTUP_TOOLCHAIN = 'stable'
$env:RUST_MIN_STACK = '33554432'
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_BUILD_JOBS = '1'
(Get-Process -Id $PID).ProcessorAffinity = 1
cargo test --manifest-path src-tauri/Cargo.toml --test contract_fixtures security_audit_fixture_exercises_import_export_search_and_a2ui_guards -j1
```

预期：1 项通过。该测试使用同一个 `contracts/v2/security-audit.json`，验证敏感 `.env` 导入被拒绝、四种表格公式前缀被转义、检索拒绝绝对路径字段、A2UI 拒绝外部 Catalog。

## M05 依赖、来源与许可证

1. 执行 `npm run audit:third-party`。
2. 确认输出 `Third-party audit passed`，并显示生产 npm 与 Windows Rust 包数量。
3. 打开 `src-tauri/THIRD_PARTY_NOTICES.md`；确认有前端/Rust 直接运行依赖、Noto 字体、A2UI 上游 commit `981e82f1a3cef88456416fa6fd80d8490964df01` 和 Apache-2.0。

预期：锁文件包均有许可证元数据和完整性信息，直接依赖版本与随包 NOTICE 一致，复用来源不随上游漂移。

## M06 威胁模型与隐私说明

阅读 `THREAT_MODEL.md` 与 `PRIVACY.md` 的“诊断导出”“删除与保留”。确认它们覆盖导入、导出、检索、A2UI、Patch/Review、Provider、诊断/指标、清理和依赖供应链，并与 M01—M05 的实际行为一致。

## 验收回复

全部通过后请回复：`S4.6 验收通过`。若失败，请提供 M 编号、稳定错误码/界面提示和文件类型；不要发送诊断 JSON、绝对路径、正文、Endpoint 或密钥。
