#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use reqwest::Client;
use tauri::Window;
use futures_util::StreamExt;
use dotenv::dotenv;
use std::env;

// 🌟 创建一个可以被前端调用的指令 (Command)
// 🌟 创建一个可以被前端调用的指令 (Command)
#[tauri::command]
async fn ask_ai(window: Window, messages: serde_json::Value) -> Result<(), String> {
    
    // 🌟 核心混合架构：自动适配云端打包与本地开发
    // 1. option_env! 会在【编译时】检查是否存在（服务于 GitHub Actions）
    // 2. 如果编译时没有，就在【运行时】去读取 .env 文件（服务于本地 npm run tauri dev）
    let api_key = option_env!("AI_API_KEY")
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            dotenv::dotenv().ok();
            std::env::var("AI_API_KEY").unwrap_or_else(|_| "".to_string())
        });

    if api_key.is_empty() {
        return Err("找不到 API Key，请检查本地 .env 文件或 GitHub Secrets".to_string());
    }

    // 2. 构造给 LLM 的请求体
    let client = Client::new();
    // ... 下面的代码保持不变
    // 2. 构造给 LLM 的请求体
    let client = Client::new();
    let request_body = serde_json::json!({
        "model": "deepseek-ai/DeepSeek-V3", 
        "stream": true,
        "temperature": 0.1,
        "messages": messages
    });

    // 3. 发起请求
    let response = client.post("https://api.siliconflow.cn/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API 报错: 状态码 {}", response.status()));
    }

    // 4. 🚀 核心：处理 SSE (Server-Sent Events) 流式数据
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("读取流失败: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        // 按行解析大模型吐出的数据块
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer.drain(..=newline_pos);

            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" { continue; } // 结束信号
                
                // 解析 JSON 并通过 Tauri Event 发送给前端
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                        // 🔔 将截获到的一个字，发送给前端窗口，事件名为 'ai-chunk'
                        window.emit("ai-chunk", content).unwrap();
                    }
                }
            }
        }
    }

    // 5. 生成完毕，通知前端关闭 Loading 状态
    window.emit("ai-done", "完毕").unwrap();

    Ok(())
}

fn main() {
    tauri::Builder::default()
        // 注册刚才写的那个与前端通信的函数
        .invoke_handler(tauri::generate_handler![ask_ai])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 遇到错误");
}