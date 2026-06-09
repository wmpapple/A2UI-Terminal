import React, { useState, useEffect, useRef } from 'react';
import { Button, Input, Avatar, message, Modal } from 'antd';
import { RobotOutlined, UserOutlined, SendOutlined } from '@ant-design/icons';
import { useChatStore } from '../page/store';
import UIFactory from './UIFactory';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

function ChatPanel({ onInsertContent }) {
  const [aiPrompt, setAiPrompt] = useState('');
  const chatEndRef = useRef(null);

  const chatHistory = useChatStore((state) => state.chatHistory);
  const isGenerating = useChatStore((state) => state.isGenerating);
  const addMessage = useChatStore((state) => state.addMessage);
  const appendContentToLastMessage = useChatStore((state) => state.appendContentToLastMessage);
  const setIsGenerating = useChatStore((state) => state.setIsGenerating);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);
  const handleAskAI = async () => {
    if (!aiPrompt.trim()) return;
    if (!window.__TAURI_IPC__) {
      message.warning('当前处于纯 Web 预览模式，请在 Tauri 桌面端内测试大模型对话功能！');
      return;
    }


    const currentPrompt = aiPrompt;
    setAiPrompt('');
    setIsGenerating(true);

    const currentHistory = useChatStore.getState().chatHistory;
    const currentDoc = useChatStore.getState().documentContent;

    addMessage({ role: 'user', content: currentPrompt });
    addMessage({ role: 'assistant', content: '' });

    // 组合给大模型的完整消息体
    const messagesToSend = [
      {
        role: 'system',
        content: `你是一个支持 A2UI (Agent-to-UI) 协议的高级智能助手。
当前系统拥有“左侧聊天框”和“右侧工作区”两个展示空间。你需要根据用户需求，选择合适的 JSON 协议输出。

【👀 当前工作区上下文感知】
用户右侧工作区目前的文档内容如下：
<workspace_content>
${currentDoc || "（当前为空）"}
</workspace_content>
如果用户指令包含“修改”、“接着写”、“把第二段删了”等基于现有内容的请求，你【必须】仔细阅读上述上下文，并在你的思维中对文档进行修改后，将修改完毕的【内容】输出到 workspace 协议的 content 中！

【最高级别警告：JSON 语法红线】
你输出的必须是极其严格、合法的 JSON 格式！任何语法错误都会导致系统崩溃！
1. 键值对之间【必须】用逗号 , 分隔！
2. 数组【必须】用方括号 [] 包裹，且元素之间用逗号 , 分隔！

【严禁废话，纯净输出】
你的整个回复必须且只能是一个 \`\`\`json ... \`\`\` 代码块！
绝对不允许在 JSON 代码块之前输出任何问候语（如“好的，这是为您生成的...”）！
绝对不允许在 JSON 代码块之后输出任何解释文字！

【场景 1：在左侧生成卡片小组件】
如果是行程规划等短小内容，务必严格参照以下格式输出：
\`\`\`json
{ "type": "component", "name": "TravelCard", "props": { "destination": "三亚", "days": 5, "highlights": ["大东海"] } }
\`\`\`

【场景 2：在右侧生成长篇文档】
如果用户要求写文章、报告、修改段落等，输出格式：
\`\`\`json
{ "type": "workspace", "content": "# 标题\\n\\n这里是正文段落..." }
\`\`\``
      },
      ...currentHistory,
      { role: 'user', content: currentPrompt }
    ];

    try {
      // 🎧 1. 挂载监听器：专门接收 Rust 底层传来的“每一个字”
      const unlistenChunk = await listen('ai-chunk', (event) => {
        appendContentToLastMessage(event.payload); // 把收到的字追加到屏幕上
      });

      // 🎧 2. 挂载监听器：接收 Rust 底层传来的“完成信号”
      const unlistenDone = await listen('ai-done', () => {
        setIsGenerating(false); // 停止思考 Loading 动画
        // 养成好习惯，完事后卸载监听器，防止内存泄漏
        unlistenChunk();
        unlistenDone();
      });

      // 🚀 3. 发号施令：调用我们在 Rust 里写的 ask_ai 命令！
      // 此时前端完全不接触 API Key 和网络协议，极其安全。
      await invoke('ask_ai', { messages: messagesToSend });

    } catch (error) {
      console.error("🔥 IPC 底层报错:", error);
      message.error(`请求失败: ${error}`);
      setIsGenerating(false);
    }
  };


  const renderMessageContent = (text) => {
    const regex = /\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
      }

      try {
        let jsonString = match[1].trim();
        if (!jsonString) throw new Error("等待内容生成...");

        // 🛡️ 终极防御装甲：自动修复大模型乱输出的中文符号
        jsonString = jsonString.replace(/[“”]/g, '"').replace(/，/g, ',').replace(/：/g, ':');

        const data = JSON.parse(jsonString);

        if (data.type === 'workspace') {
          parts.push(
            <div key={`ws-${match.index}`} style={{ padding: '12px 16px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, margin: '8px 0' }}>
              <div style={{ color: '#52c41a', fontWeight: 'bold', marginBottom: 8 }}>📝 发现生成的文本内容</div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: 12 }}>请选择如何将内容同步到右侧编辑器：</div>

              {/* 🌟 终极三选一：覆盖全文 / 追加到末尾 / 局部光标替换 */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Button
                  type="primary"
                  style={{ background: '#52c41a', borderColor: '#52c41a', flex: 1 }}
                  onClick={() => {
                    Modal.confirm({
                      title: '确认替换全文？',
                      content: '这将会替换当前右侧编辑器里的所有内容，确定要继续吗？',
                      okText: '确认替换',
                      cancelText: '取消',
                      onOk: () => {
                        if (onInsertContent) {
                          onInsertContent(data.content, 'replace');
                          message.success('已完美排版并覆盖工作区！');
                        }
                      }
                    });
                  }}
                >
                  替换全文 ➡️
                </Button>

                <Button
                  style={{ color: '#52c41a', borderColor: '#52c41a', flex: 1 }}
                  onClick={() => {
                    if (onInsertContent) {
                      onInsertContent(data.content, 'append');
                      message.success('已追加到文档末尾！');
                    }
                  }}
                >
                  追加到末尾 ➕
                </Button>

                <Button
                  style={{ color: '#fa8c16', borderColor: '#fa8c16', flex: '1 1 100%' }} // 独占一行显示
                  onClick={() => {
                    if (onInsertContent) {
                      onInsertContent(data.content, 'insert');
                      message.success('已插入到光标位置！');
                    }
                  }}
                >
                  插入光标处 / 替换选中内容 📍
                </Button>
              </div>
            </div>
          );
        } else {
          const compName = data.name || (data.type !== 'component' ? data.type : null);
          if (compName) {
            parts.push(<UIFactory key={`comp-${match.index}`} name={compName} props={data.props || {}} />);
          } else {
            throw new Error('未知的组件类型');
          }
        }
      } catch (e) {
        parts.push(
          <div key={`err-${match.index}`} style={{ padding: 12, background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, margin: '8px 0' }}>
            <div style={{ color: '#ff4d4f', fontWeight: 'bold', marginBottom: 4 }}>
              {isGenerating ? "⚙️ A2UI 协议生成中..." : "⚠️ JSON 解析失败 (格式异常)"}
            </div>
            {!isGenerating && (
              <>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: 8 }}>报错: {e.message}</div>
                <pre style={{ fontSize: '12px', background: '#f5f5f5', padding: 8, overflowX: 'auto', borderRadius: 4, whiteSpace: 'pre-wrap' }}>
                  {match[1] || "（内容为空）"}
                </pre>
              </>
            )}
          </div>
        );
      }
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(<span key={`text-last`}>{text.slice(lastIndex)}</span>);
    }
    return parts.length > 0 ? parts : text;
  };

  return (
    <div style={{ width: '400px', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', flexShrink: 0 }}>
      <div style={{ padding: '16px', borderBottom: '1px solid #f0f0f0', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <RobotOutlined style={{ color: '#722ed1' }} /> A2UI 生成式终端
      </div>
      <div style={{ flex: 1, padding: '16px', overflowY: 'auto', background: '#fafafa' }}>
        {chatHistory.map((msg, index) => (
          <div key={index} style={{ marginBottom: '20px', display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
            <Avatar icon={msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />} style={{ backgroundColor: msg.role === 'user' ? '#1890ff' : '#722ed1', margin: msg.role === 'user' ? '0 0 0 12px' : '0 12px 0 0', flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
              <div style={{ background: msg.role === 'user' ? '#e6f7ff' : '#fff', padding: '12px', borderRadius: '8px', border: '1px solid #f0f0f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', width: '100%' }}>
                {msg.role === 'assistant' ? renderMessageContent(msg.content) : msg.content}
                {isGenerating && msg.role === 'assistant' && msg.content === '' && '思考中...'}
              </div>
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <div style={{ padding: '16px', borderTop: '1px solid #f0f0f0' }}>
        <Input.TextArea rows={3} placeholder="输入指令..." value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} style={{ marginBottom: '12px', resize: 'none' }} onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleAskAI(); } }} />
        <Button type="primary" block icon={<SendOutlined />} style={{ background: '#722ed1' }} onClick={handleAskAI} loading={isGenerating}>发送指令</Button>
      </div>
    </div>
  );
}

export default ChatPanel;