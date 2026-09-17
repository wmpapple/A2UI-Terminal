# S4.2 本地模型探测与简单模型策略人工验收

> 范围：只验收 S4.2；通过前不得开始 S4.3。

> 必须使用 Windows 桌面应用。验收脚本只模拟本机 `/v1/models`，不会生成 AI 正文，也不能代替真实模型推理测试。

## 准备

1. 完全关闭旧桌面应用和开发进程。
2. 在项目根目录执行 `npm run desktop:dev`。
3. 另开一个 PowerShell，准备执行本单中的本机 fixture。若已运行 Ollama 或 LM Studio，可先完全退出，以便检查“未运行”状态。

本机若遇到随机 Rust 编译崩溃，可在新的 PowerShell 会话中使用：

```powershell
(Get-Process -Id $PID).ProcessorAffinity = 1
$env:RUSTUP_TOOLCHAIN = 'stable'
$env:RUST_MIN_STACK = '33554432'
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_BUILD_JOBS = '1'
npm run desktop:dev
```

## M01 无本机服务时不阻塞

1. 确认 Ollama、LM Studio 和验收 fixture 均未运行。
2. 进入“设置”，保持简单模式，点击“重新检查”。
3. 继续切换首页、成果和工作台，并打开已有 Provider 配置。

预期：短时间内显示本机服务未发现或当前云端配置状态；不会长时间卡住启动、导航或已有云端/BYOK 配置，也不会弹出技术堆栈。

## M02 固定 Ollama 回环端点正向探测

1. 在单独 PowerShell 中执行：

```powershell
node scripts/s4-2-local-provider-fixture.mjs --port=11434
```

2. 回到简单模式“设置”，点击“重新检查”。
3. 检查状态区域。

预期：显示发现 1 个本机服务；普通用户可看到本机服务可用提示，但看不到 `127.0.0.1:11434`、`s4.2-local-fixture`、Endpoint、Model、Temperature、Proxy 或 API Key。

## M03 专业模式技术明细

1. 切换为专业模式，点击“打开 Provider 高级设置”。
2. 点击“检测本机模型”。
3. 查看 Ollama 与 LM Studio 条目。

预期：Ollama 显示可用、`http://127.0.0.1:11434/v1` 和模型 `s4.2-local-fixture`；未运行的 LM Studio 显示未运行。探测不会自动改写或激活任何 Provider。

## M04 显式自定义回环端点

1. 另开 PowerShell 执行：

```powershell
node scripts/s4-2-local-provider-fixture.mjs --port=17777
```

2. 在专业 Provider 设置中选择 `OpenAI-Compatible`，把 Endpoint 设为 `http://localhost:17777/v1`，Model 填入 `s4.2-local-fixture` 并保存；无需设为当前 Provider。
3. 点击“检测本机模型”。

预期：出现“自定义本机端点”且显示可用；地址规范为数值回环 `127.0.0.1`。保存和探测不会自动设为当前 Provider，也不会发送 Prompt 或文件。

## M05 不扫描局域网

1. 在专业 Provider 设置中把自定义 Endpoint 临时保存为 `https://192.168.1.10/v1`，保持其他设置不变。
2. 点击“检测本机模型”，观察耗时和条目。
3. 验收后可恢复原来的自定义 Endpoint。

预期：不会出现该局域网地址的探测条目，也不会等待该地址超时；只检查固定的两个数值回环端点。应用不得枚举其他端口、设备或 mDNS 服务。

## M06 停止服务后的失败隔离与模式隐藏

1. 在两个 fixture PowerShell 中按 `Ctrl+C` 停止服务。
2. 专业模式点击“检测本机模型”，确认条目变为未运行。
3. 切回简单模式，再次检查状态与页面内容。
4. 确认原 Provider 配置、Key 状态和活动 Provider 未被探测过程修改。

预期：探测失败只影响本机状态提示，不阻塞云端或手动配置；简单模式仍不出现 Endpoint、模型 ID、Temperature、Proxy 或 Key 技术字段。

## P0 明确限制

- 本阶段只探测 OpenAI-Compatible `/v1/models` 状态，不验证模型质量、上下文长度、工具调用或真实生成能力。
- 不自动下载、启动、停止、选择或保存模型，不扫描局域网和端口范围。
- 平台内置试用服务仍受 O-08 阻塞；界面不会伪造内置额度或成功状态。

## 验收回复

全部通过后请回复：`S4.2 验收通过`。若失败，请提供步骤编号、当前模式、服务端口和界面提示；不要发送 API Key、真实 Prompt 或文件内容。
