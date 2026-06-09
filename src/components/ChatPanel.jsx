import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Button, Input, Modal, Tooltip, message } from 'antd';
import {
  DeleteOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { useChatStore } from '../page/store';
import UIFactory from './UIFactory';

const SYSTEM_PROMPT = `你是一个支持 A2UI (Agent-to-UI) 协议的高级智能助手。
当前系统拥有左侧聊天区和右侧工作区两个展示空间。你需要根据用户需求，选择合适的 JSON 协议输出。

如果用户要求生成小卡片组件，输出格式：
\`\`\`json
{ "type": "component", "name": "TravelCard", "props": { "destination": "三亚", "days": 5, "highlights": ["大东海"] } }
\`\`\`

如果用户要求写文章、报告、修改段落等，输出格式：
\`\`\`json
{ "type": "workspace", "content": "# 标题\\n\\n这里是正文段落..." }
\`\`\`

你的整个回复必须只包含一个 json 代码块，不要在代码块前后输出解释文字。
注意：content 是 JSON 字符串，正文里的换行必须写成 \\n，双引号必须写成 \\"。`;

function ChatPanel({ onInsertContent }) {
  const [aiPrompt, setAiPrompt] = useState('');
  const [visibleContentByRequest, setVisibleContentByRequest] = useState({});
  const [isSessionListCollapsed, setIsSessionListCollapsed] = useState(false);
  const chatEndRef = useRef(null);
  const chunkBuffersRef = useRef(new Map());
  const flushTimersRef = useRef(new Map());
  const typewriterTargetsRef = useRef(new Map());
  const typewriterTimersRef = useRef(new Map());

  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const createSession = useChatStore((state) => state.createSession);
  const switchSession = useChatStore((state) => state.switchSession);
  const deleteSession = useChatStore((state) => state.deleteSession);
  const renameSession = useChatStore((state) => state.renameSession);
  const addMessage = useChatStore((state) => state.addMessage);
  const appendContentToMessage = useChatStore((state) => state.appendContentToMessage);
  const setSessionGenerating = useChatStore((state) => state.setSessionGenerating);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId]
  );

  const chatHistory = activeSession?.messages || [];
  const isGenerating = Boolean(activeSession?.isGenerating);

  const buildSessionTitle = (prompt) => {
    const cleaned = prompt
      .replace(/[，。！？、,.!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const compact = cleaned
      .replace(/^(请|帮我|帮忙|给我|我想|我要|能不能|可以|麻烦你)/, '')
      .trim();

    return (compact || cleaned || '新对话').slice(0, 18);
  };

  const flushBufferedChunk = (key) => {
    const buffered = chunkBuffersRef.current.get(key);
    if (!buffered) return;

    chunkBuffersRef.current.delete(key);
    flushTimersRef.current.delete(key);
    appendContentToMessage(buffered.sessionId, buffered.requestId, buffered.content);
  };

  const enqueueChunk = (sessionId, requestId, content) => {
    const key = `${sessionId}:${requestId}`;
    const existing = chunkBuffersRef.current.get(key);

    chunkBuffersRef.current.set(key, {
      sessionId,
      requestId,
      content: `${existing?.content || ''}${content}`,
    });

    if (flushTimersRef.current.has(key)) return;

    const timer = window.setTimeout(() => {
      flushBufferedChunk(key);
    }, 33);
    flushTimersRef.current.set(key, timer);
  };

  useEffect(() => {
    let disposed = false;
    let unlistenChunk;
    let unlistenDone;

    const setupListeners = async () => {
      const removeChunkListener = await listen('ai-chunk', (event) => {
        const payload = event.payload || {};
        if (!payload.sessionId || !payload.requestId || !payload.content) return;
        enqueueChunk(payload.sessionId, payload.requestId, payload.content);
      });

      if (disposed) {
        removeChunkListener();
        return;
      }
      unlistenChunk = removeChunkListener;

      const removeDoneListener = await listen('ai-done', (event) => {
        const payload = event.payload || {};
        if (!payload.sessionId || !payload.requestId) return;

        const key = `${payload.sessionId}:${payload.requestId}`;
        const timer = flushTimersRef.current.get(key);
        if (timer) window.clearTimeout(timer);
        flushBufferedChunk(key);
        setSessionGenerating(payload.sessionId, false);
      });

      if (disposed) {
        removeDoneListener();
        return;
      }
      unlistenDone = removeDoneListener;
    };

    if (window.__TAURI_IPC__) {
      setupListeners();
    }

    return () => {
      disposed = true;
      unlistenChunk?.();
      unlistenDone?.();
      flushTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      flushTimersRef.current.clear();
      chunkBuffersRef.current.clear();
    };
  }, [appendContentToMessage, setSessionGenerating]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  useEffect(() => {
    if (!activeSession?.id) return;

    chatHistory
      .filter((msg) => msg.role === 'assistant' && msg.requestId)
      .forEach((msg) => {
        const key = `${activeSession.id}:${msg.requestId}`;
        const target = msg.content || '';
        typewriterTargetsRef.current.set(key, target);

        if (!target || typewriterTimersRef.current.has(key)) return;

        const timer = window.setInterval(() => {
          setVisibleContentByRequest((currentState) => {
            const latestTarget = typewriterTargetsRef.current.get(key) || '';
            const current = currentState[key] || '';

            if (current.length >= latestTarget.length) {
              window.clearInterval(timer);
              typewriterTimersRef.current.delete(key);
              return currentState;
            }

            const remaining = latestTarget.length - current.length;
            const step = Math.min(Math.max(Math.ceil(remaining / 24), 1), 8);

            return {
              ...currentState,
              [key]: latestTarget.slice(0, current.length + step),
            };
          });
        }, 24);

        typewriterTimersRef.current.set(key, timer);
      });
  }, [activeSession?.id, chatHistory]);

  useEffect(() => {
    return () => {
      typewriterTimersRef.current.forEach((timer) => window.clearInterval(timer));
      typewriterTimersRef.current.clear();
      typewriterTargetsRef.current.clear();
    };
  }, []);

  const handleAskAI = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || !activeSession || isGenerating) return;

    if (!window.__TAURI_IPC__) {
      message.warning('当前处于 Web 预览模式，请在 Tauri 桌面端内测试大模型对话功能。');
      return;
    }

    const sessionId = activeSession.id;
    const requestId = crypto.randomUUID();
    const typewriterKey = `${sessionId}:${requestId}`;
    const currentDoc = useChatStore.getState().documentContent;
    const currentMessages =
      useChatStore
        .getState()
        .sessions.find((session) => session.id === sessionId)
        ?.messages.filter((item) => item.content && item.role !== 'system')
        .map(({ role, content }) => ({ role, content })) || [];

    setAiPrompt('');
    if (!activeSession.messages.some((item) => item.role === 'user')) {
      renameSession(sessionId, buildSessionTitle(prompt));
    }
    setVisibleContentByRequest((currentState) => ({
      ...currentState,
      [typewriterKey]: '',
    }));
    addMessage(sessionId, { role: 'user', content: prompt });
    addMessage(sessionId, { role: 'assistant', content: '', requestId });
    setSessionGenerating(sessionId, true, requestId);

    const messagesToSend = [
      {
        role: 'system',
        content: `${SYSTEM_PROMPT}\n\n当前右侧工作区内容：\n<workspace_content>\n${currentDoc || '当前为空'}\n</workspace_content>`,
      },
      ...currentMessages,
      { role: 'user', content: prompt },
    ];

    try {
      await invoke('ask_ai', {
        sessionId,
        requestId,
        messages: messagesToSend,
      });
    } catch (error) {
      console.error('AI 请求失败:', error);
      message.error(`请求失败: ${error}`);
      setSessionGenerating(sessionId, false);
    }
  };

  const handleStopAI = async () => {
    if (!activeSession?.activeRequestId) return;

    try {
      await invoke('cancel_ai', { requestId: activeSession.activeRequestId });
      setSessionGenerating(activeSession.id, false);
    } catch (error) {
      message.error(`停止失败: ${error}`);
    }
  };

  const looksLikeHtml = (value) => /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(value);

  const looksLikeDocument = (value) => {
    const text = value.trim();
    return looksLikeHtml(text) || /^#{1,6}\s+/m.test(text) || /\n\s*[-*]\s+/.test(text) || text.length > 120;
  };

  const renderWorkspaceActions = (content, key, title = '发现生成的文档内容') => (
    <div key={key} style={{ padding: '12px 16px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, margin: '8px 0' }}>
      <div style={{ color: '#52c41a', fontWeight: 'bold', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>内容不会自动执行，请选择是否同步到右侧编辑器：</div>
      <pre style={{ maxHeight: 220, overflow: 'auto', textAlign: 'left', fontSize: 12, background: '#f5f5f5', padding: 8, borderRadius: 4, whiteSpace: 'pre-wrap', marginBottom: 12 }}>
        {content}
      </pre>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          type="primary"
          style={{ background: '#52c41a', borderColor: '#52c41a', flex: 1 }}
          onClick={() => {
            Modal.confirm({
              title: '确认替换全文？',
              content: '这将替换右侧编辑器里的所有内容。',
              okText: '确认替换',
              cancelText: '取消',
              onOk: () => onInsertContent?.(content, 'replace'),
            });
          }}
        >
          替换全文
        </Button>
        <Button style={{ color: '#52c41a', borderColor: '#52c41a', flex: 1 }} onClick={() => onInsertContent?.(content, 'append')}>
          追加到末尾
        </Button>
        <Button style={{ color: '#fa8c16', borderColor: '#fa8c16', flex: '1 1 100%' }} onClick={() => onInsertContent?.(content, 'insert')}>
          插入光标处
        </Button>
      </div>
    </div>
  );

  const renderStreamingDocumentPreview = (content, key) => (
    <div key={key} style={{ padding: '12px 16px', background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: 8, margin: '8px 0' }}>
      <div style={{ color: '#666', fontWeight: 'bold', marginBottom: 8 }}>正在生成文档内容...</div>
      <pre style={{ maxHeight: 360, overflow: 'auto', textAlign: 'left', fontSize: 12, background: '#fff', padding: 8, borderRadius: 4, whiteSpace: 'pre-wrap', margin: 0 }}>
        {content}
      </pre>
    </div>
  );

  const parseLooseWorkspaceJson = (jsonString) => {
    const normalized = jsonString
      .trim()
      .replace(/[“”]/g, '"')
      .replace(/，/g, ',')
      .replace(/：/g, ':');

    try {
      return JSON.parse(normalized);
    } catch {
      const isWorkspace = /["']type["']\s*:\s*["']workspace["']/i.test(normalized);
      const contentKeyMatch = normalized.match(/["']content["']\s*:/i);
      if (!isWorkspace || !contentKeyMatch) return null;

      const contentStart = contentKeyMatch.index + contentKeyMatch[0].length;
      let content = normalized.slice(contentStart).trim();

      if (content.startsWith('"') || content.startsWith("'")) {
        const quote = content[0];
        content = content.slice(1);
        const endQuoteIndex = content.lastIndexOf(quote);
        if (endQuoteIndex !== -1) {
          content = content.slice(0, endQuoteIndex);
        }
      } else {
        content = content.replace(/[,}]\s*$/g, '');
      }

      return {
        type: 'workspace',
        content: content.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim(),
      };
    }
  };

  const renderParsedA2UI = (data, key) => {
    if (data.type === 'workspace') {
      return renderWorkspaceActions(data.content || '', key);
    }

    const compName = data.name || (data.type !== 'component' ? data.type : null);
    if (!compName) throw new Error('未知组件类型');
    return <UIFactory key={key} name={compName} props={data.props || {}} />;
  };

  const extractJsonPayload = (text) => {
    const fenceStart = text.search(/```(?:json)?\s*/i);
    if (fenceStart === -1) {
      const trimmed = text.trim();
      return trimmed.startsWith('{') && trimmed.endsWith('}')
        ? { rawBefore: '', jsonString: trimmed, rawAfter: '', isComplete: true }
        : null;
    }

    const openFence = text.match(/```(?:json)?\s*/i);
    const jsonStart = fenceStart + openFence[0].length;
    const fenceEnd = text.lastIndexOf('```');

    if (fenceEnd <= fenceStart) {
      return {
        rawBefore: text.slice(0, fenceStart),
        jsonString: text.slice(jsonStart),
        rawAfter: '',
        isComplete: false,
      };
    }

    return {
      rawBefore: text.slice(0, fenceStart),
      jsonString: text.slice(jsonStart, fenceEnd),
      rawAfter: text.slice(fenceEnd + 3),
      isComplete: true,
    };
  };

  const renderMessageContent = (text, isMessageGenerating = false) => {
    const payload = extractJsonPayload(text);

    if (!payload) {
      if (!isMessageGenerating && looksLikeDocument(text)) {
        return renderWorkspaceActions(text.trim(), 'fallback-document', looksLikeHtml(text) ? '检测到 HTML 内容' : '检测到文档内容');
      }
      return text;
    }

    if (!payload.isComplete || !payload.jsonString.trim()) {
      const streamingData = parseLooseWorkspaceJson(payload.jsonString);

      if (streamingData?.type === 'workspace' && streamingData.content) {
        return (
          <>
            {payload.rawBefore && <span>{payload.rawBefore}</span>}
            {renderStreamingDocumentPreview(streamingData.content, 'streaming-document')}
          </>
        );
      }

      return (
        <>
          {payload.rawBefore && <span>{payload.rawBefore}</span>}
          <div style={{ padding: 12, background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: 6, margin: '8px 0' }}>
            A2UI 协议生成中...
          </div>
        </>
      );
    }

    try {
      const data = parseLooseWorkspaceJson(payload.jsonString);
      if (!data) throw new Error('不是有效的 A2UI JSON 协议');

      return (
        <>
          {payload.rawBefore && <span>{payload.rawBefore}</span>}
          {renderParsedA2UI(data, 'parsed-a2ui')}
          {payload.rawAfter && <span>{payload.rawAfter}</span>}
        </>
      );
    } catch (error) {
      if (isMessageGenerating) {
        return (
          <>
            {payload.rawBefore && <span>{payload.rawBefore}</span>}
            <div style={{ padding: 12, background: '#f5f5f5', border: '1px solid #e5e5e5', borderRadius: 6, margin: '8px 0' }}>
              A2UI 协议生成中...
            </div>
          </>
        );
      }

      const fallbackContent = payload.jsonString.trim();
      if (looksLikeDocument(fallbackContent)) {
        return (
          <>
            {payload.rawBefore && <span>{payload.rawBefore}</span>}
            {renderWorkspaceActions(fallbackContent, 'fallback-jsonish-document', looksLikeHtml(fallbackContent) ? '检测到 HTML 内容' : '检测到文档内容')}
            {payload.rawAfter && <span>{payload.rawAfter}</span>}
          </>
        );
      }

      return (
        <div style={{ padding: 12, background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, margin: '8px 0' }}>
          <div style={{ color: '#ff4d4f', fontWeight: 'bold', marginBottom: 4 }}>JSON 解析失败</div>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>{error.message}</div>
          <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 8, overflowX: 'auto', borderRadius: 4, whiteSpace: 'pre-wrap' }}>
            {payload.jsonString}
          </pre>
        </div>
      );
    }
  };

  return (
    <div style={{ width: isSessionListCollapsed ? 468 : 580, display: 'flex', background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', flexShrink: 0, overflow: 'hidden' }}>
      <div style={{ width: isSessionListCollapsed ? 56 : 176, flexShrink: 0, borderRight: '1px solid #f0f0f0', background: '#fbfbfb', display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 57, padding: 8, display: 'flex', alignItems: 'center', justifyContent: isSessionListCollapsed ? 'center' : 'space-between', borderBottom: '1px solid #f0f0f0', boxSizing: 'border-box' }}>
          {!isSessionListCollapsed && <span style={{ fontWeight: 'bold', color: '#333' }}>对话</span>}
          <Tooltip title={isSessionListCollapsed ? '展开对话列表' : '隐藏对话列表'}>
            <Button
              size="small"
              shape="circle"
              icon={isSessionListCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setIsSessionListCollapsed((value) => !value)}
            />
          </Tooltip>
        </div>

        <div style={{ padding: isSessionListCollapsed ? 8 : '8px 10px', borderBottom: '1px solid #f0f0f0' }}>
          <Tooltip title="新建对话">
            <Button
              block={!isSessionListCollapsed}
              shape={isSessionListCollapsed ? 'circle' : 'default'}
              icon={<PlusOutlined />}
              onClick={createSession}
              style={!isSessionListCollapsed ? { border: 'none', boxShadow: 'none', justifyContent: 'flex-start', background: 'transparent' } : undefined}
            >
              {!isSessionListCollapsed && '新建对话'}
            </Button>
          </Tooltip>
        </div>

        {!isSessionListCollapsed && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;

              return (
                <div
                  key={session.id}
                  onClick={() => switchSession(session.id)}
                  style={{
                    minHeight: 36,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '0 6px 0 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: isActive ? '#1677ff' : '#333',
                    background: isActive ? '#eaf2ff' : 'transparent',
                    borderLeft: isActive ? '3px solid #1677ff' : '3px solid transparent',
                    boxSizing: 'border-box',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {session.title}
                  </span>
                  {isActive && sessions.length > 1 && (
                    <Tooltip title="删除当前对话">
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteSession(activeSessionId);
                        }}
                        style={{ flexShrink: 0 }}
                      />
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 57, padding: '0 16px', borderBottom: '1px solid #f0f0f0', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box' }}>
          <RobotOutlined style={{ color: '#722ed1' }} />
          A2UI 生成式终端
        </div>

        <div style={{ flex: 1, padding: 16, overflowY: 'auto', background: '#fafafa' }}>
          {chatHistory.map((msg, index) => {
            const messageKey = `${activeSession?.id}:${msg.requestId}`;
            const visibleContent = msg.requestId ? visibleContentByRequest[messageKey] : undefined;
            const isActiveAssistant =
              msg.role === 'assistant' && msg.requestId === activeSession?.activeRequestId;
            const shouldUseTypewriter = Boolean(
              msg.role === 'assistant' && msg.requestId && visibleContent !== (msg.content || '')
            );
            const isTyping = Boolean(
              shouldUseTypewriter && (visibleContent || '').length < (msg.content || '').length
            );
            const displayContent = shouldUseTypewriter ? visibleContent || '' : msg.content;

            return (
              <div key={`${msg.requestId || index}-${msg.role}`} style={{ marginBottom: 20, display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                <Avatar icon={msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />} style={{ backgroundColor: msg.role === 'user' ? '#1890ff' : '#722ed1', margin: msg.role === 'user' ? '0 0 0 12px' : '0 12px 0 0', flexShrink: 0 }} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                  <div style={{ background: msg.role === 'user' ? '#e6f7ff' : '#fff', padding: 12, borderRadius: 8, border: '1px solid #f0f0f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', width: '100%', textAlign: 'left' }}>
                    {msg.role === 'assistant' ? renderMessageContent(displayContent, isActiveAssistant || isTyping) : msg.content}
                    {isGenerating && isActiveAssistant && !msg.content && '思考中...'}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        <div style={{ padding: 16, borderTop: '1px solid #f0f0f0' }}>
          <Input.TextArea
            rows={3}
            placeholder="输入指令..."
            value={aiPrompt}
            disabled={isGenerating}
            onChange={(event) => setAiPrompt(event.target.value)}
            style={{ marginBottom: 12, resize: 'none' }}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault();
                handleAskAI();
              }
            }}
          />
          {isGenerating ? (
            <Button danger block icon={<StopOutlined />} onClick={handleStopAI}>
              停止生成
            </Button>
          ) : (
            <Button type="primary" block icon={<SendOutlined />} style={{ background: '#722ed1' }} onClick={handleAskAI}>
              发送指令
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;
