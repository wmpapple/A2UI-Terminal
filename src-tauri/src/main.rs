#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use dotenv::dotenv;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::json;
use std::collections::HashSet;
use std::env;
use std::sync::{Arc, Mutex};
use tauri::{State, Window};

#[derive(Default)]
struct CancelState {
    requests: Arc<Mutex<HashSet<String>>>,
}

#[tauri::command]
fn cancel_ai(state: State<'_, CancelState>, request_id: String) -> Result<(), String> {
    let mut requests = state
        .requests
        .lock()
        .map_err(|_| "无法锁定取消状态".to_string())?;
    requests.insert(request_id);
    Ok(())
}

fn is_canceled(state: &State<'_, CancelState>, request_id: &str) -> Result<bool, String> {
    let requests = state
        .requests
        .lock()
        .map_err(|_| "无法读取取消状态".to_string())?;
    Ok(requests.contains(request_id))
}

fn clear_cancel_flag(state: &State<'_, CancelState>, request_id: &str) -> Result<(), String> {
    let mut requests = state
        .requests
        .lock()
        .map_err(|_| "无法清理取消状态".to_string())?;
    requests.remove(request_id);
    Ok(())
}

#[tauri::command]
async fn ask_ai(
    window: Window,
    state: State<'_, CancelState>,
    session_id: String,
    request_id: String,
    messages: serde_json::Value,
) -> Result<(), String> {
    clear_cancel_flag(&state, &request_id)?;

    let api_key = option_env!("AI_API_KEY")
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            dotenv().ok();
            env::var("AI_API_KEY").unwrap_or_else(|_| "".to_string())
        });

    if api_key.is_empty() {
        return Err("找不到 API Key，请检查本地 .env 文件或 GitHub Secrets".to_string());
    }

    let client = Client::new();
    let request_body = json!({
        "model": "deepseek-ai/DeepSeek-V3",
        "stream": true,
        "temperature": 0.1,
        "messages": messages
    });

    let response = client
        .post("https://api.siliconflow.cn/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&request_body)
        .send()
        .await
        .map_err(|error| format!("网络请求失败: {}", error))?;

    if !response.status().is_success() {
        return Err(format!("API 报错: 状态码 {}", response.status()));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut canceled = false;

    while let Some(chunk) = stream.next().await {
        if is_canceled(&state, &request_id)? {
            canceled = true;
            break;
        }

        let bytes = chunk.map_err(|error| format!("读取流失败: {}", error))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer.drain(..=newline_pos);

            if !line.starts_with("data: ") {
                continue;
            }

            let data = &line[6..];
            if data == "[DONE]" {
                continue;
            }

            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                    window
                        .emit(
                            "ai-chunk",
                            json!({
                                "sessionId": session_id,
                                "requestId": request_id,
                                "content": content
                            }),
                        )
                        .map_err(|error| format!("发送流式事件失败: {}", error))?;
                }
            }
        }
    }

    clear_cancel_flag(&state, &request_id)?;

    window
        .emit(
            "ai-done",
            json!({
                "sessionId": session_id,
                "requestId": request_id,
                "canceled": canceled
            }),
        )
        .map_err(|error| format!("发送完成事件失败: {}", error))?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(CancelState::default())
        .invoke_handler(tauri::generate_handler![ask_ai, cancel_ai])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 遇到错误");
}
