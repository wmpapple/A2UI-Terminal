# 阶段 3 验证记录

验证日期：2026-08-05

## 已通过

- `npm run check`：Prettier、ESLint、TypeScript、5 个测试文件中的 7 个测试、Vite 生产构建全部通过；
- `npm audit --omit=dev`：0 个生产依赖漏洞；
- Tauri CLI 2.11.4 成功解析 Tauri 2.11.5 配置、前端路径和 CSP；
- 仓库差异检查无空白错误；
- 静态安全扫描未发现 `api-all`、allow-all、空 CSP、`.env` 密钥读取、旧 `ask_ai` 或 `reqwest` 直连；
- Web Mock 的桌面 API 防越界测试通过，浏览器模式会拒绝特权 IPC；
- `cargo fmt --check`：通过；
- `cargo clippy --all-targets --all-features -- -D warnings`：通过；
- Rust 单元测试：8 个通过，0 个失败；
- Tauri debug 无安装包构建：通过；
- 桌面程序启动冒烟：进程持续运行，窗口标题为 `A2UI Terminal`；
- Tauri 2 `Cargo.lock`：已重新生成。

## 已实现、等待 Windows CI 执行

- 手动 NSIS/MSI 内测安装包构建、安装、启动和卸载。

当前开发机已安装隔离的 Rust 1.97.1 工具链，并已具备可用的 MSVC 链接环境。初次编译发现库 crate 名称未声明，已通过 `[lib] name = "a2ui_terminal_lib"` 修复，并完成 Clippy、测试、桌面构建和启动验证。

阶段 4 在上述 Windows 门槛和产品负责人验收前不开始。
