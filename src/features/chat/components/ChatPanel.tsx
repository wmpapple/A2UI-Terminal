import {
  AppstoreOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Button, Input, message, Select, Tag, Tooltip } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../app/i18n/useI18n';
import type { ContextSelection } from '../../../shared/types/domain';
import { useAppStore } from '../../../stores/useAppStore';
import { ContextSelector } from '../../context/components/ContextSelector';
import styles from './ChatPanel.module.css';

const defaultContext: ContextSelection = {
  selection: false,
  currentFile: true,
  recentMessages: true,
  recentMessageCount: 3,
  projectFiles: [],
};

export function ChatPanel() {
  const { locale, t } = useI18n();
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const activePath = useAppStore((state) => state.activePath);
  const selectedText = useAppStore((state) => state.selectedText);
  const createSession = useAppStore((state) => state.createSession);
  const selectSession = useAppStore((state) => state.selectSession);
  const addMessage = useAppStore((state) => state.addMessage);
  const updateMessage = useAppStore((state) => state.updateMessage);
  const createProposal = useAppStore((state) => state.createProposal);
  const [prompt, setPrompt] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const contextBySession = useAppStore((state) => state.contextBySession);
  const setSessionContext = useAppStore((state) => state.setSessionContext);
  const addFileToContext = useAppStore((state) => state.addFileToContext);
  const addFile = useAppStore((state) => state.addFile);
  const [dragging, setDragging] = useState(false);
  const streamRef = useRef<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions]
  );
  const savedContext = contextBySession[activeSessionId];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages]);
  useEffect(
    () => () => {
      if (streamRef.current) window.clearInterval(streamRef.current);
    },
    []
  );

  const stop = () => {
    if (streamRef.current) window.clearInterval(streamRef.current);
    streamRef.current = null;
    setGenerating(false);
  };

  const sendWithContext = (selection: ContextSelection) => {
    const request = prompt.trim();
    if (!request || !activeSession) return;
    setContextOpen(false);
    setPrompt('');
    setGenerating(true);
    const assistantId = crypto.randomUUID();
    addMessage(activeSession.id, {
      id: crypto.randomUUID(),
      role: 'user',
      content: request,
      status: 'complete',
    });
    addMessage(activeSession.id, {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'streaming',
    });
    const sourceCount =
      Number(selection.selection && selectedText.length > 0) +
      Number(selection.currentFile) +
      Number(selection.recentMessages && selection.recentMessageCount > 0) +
      selection.projectFiles.length;
    const response =
      locale === 'zh-CN'
        ? `已分析 ${sourceCount} 项上下文。我生成了一项语义修改，正在送往审阅中心。请检查修改前后内容，再决定是否应用。`
        : `I analyzed ${sourceCount} context sources and generated a semantic change. Review the before and after content before applying it.`;
    let offset = 0;
    streamRef.current = window.setInterval(() => {
      offset = Math.min(response.length, offset + 2);
      updateMessage(
        activeSession.id,
        assistantId,
        response.slice(0, offset),
        offset === response.length ? 'complete' : 'streaming'
      );
      if (offset === response.length) {
        stop();
        createProposal();
      }
    }, 28);
  };

  const requestSend = () => {
    if (!prompt.trim() || generating) return;
    sendWithContext(savedContext ?? defaultContext);
  };

  const confirmContext = (selection: ContextSelection) => {
    setSessionContext(activeSessionId, selection);
    setContextOpen(false);
  };

  const addDroppedFiles = async (fileList: FileList) => {
    const supported =
      /\.(txt|md|json|ts|tsx|js|jsx|py|ya?ml|css|html|xml|toml|ini|env|sql|sh|ps1)$/i;
    for (const file of Array.from(fileList)) {
      if (!supported.test(file.name) || file.size > 2 * 1024 * 1024) {
        message.warning(`${file.name}: ${t('unsupportedFile')}`);
        continue;
      }
      const path = `uploads/${file.name}`;
      addFile({
        path,
        name: file.name,
        language: file.name.split('.').pop() ?? 'text',
        content: await file.text(),
      });
      addFileToContext(activeSessionId, path);
    }
  };

  return (
    <aside className={styles.panel} aria-label={t('assistant')}>
      <header className={styles.header}>
        <div>
          <strong>{t('assistant')}</strong>
          <span>
            <i /> {t('provider')}
          </span>
        </div>
        <Tooltip title={t('newSession')}>
          <Button type="text" icon={<PlusOutlined />} onClick={createSession} />
        </Tooltip>
      </header>
      <Select
        value={activeSessionId}
        onChange={selectSession}
        options={sessions.map((session) => ({ value: session.id, label: session.title }))}
        className={styles.sessionSelect}
      />
      <div className={styles.messages} aria-live="polite">
        {activeSession?.messages.map((message) => (
          <article
            key={message.id}
            className={`${styles.message} ${message.role === 'user' ? styles.user : styles.assistant}`}
          >
            <div className={styles.role}>{message.role === 'user' ? 'YOU' : 'A2UI'}</div>
            <p>
              {message.content}
              {message.status === 'streaming' && <span className={styles.cursor} />}
            </p>
          </article>
        ))}
        <div ref={endRef} />
      </div>
      <div
        className={`${styles.composer} ${dragging ? styles.dragging : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void addDroppedFiles(event.dataTransfer.files);
        }}
      >
        <div className={styles.contextBar}>
          <Button
            type="text"
            size="small"
            icon={<AppstoreOutlined />}
            onClick={() => setContextOpen(true)}
          >
            {t('context')}
          </Button>
          <Tag color="blue">{activePath}</Tag>
          {(savedContext?.projectFiles ?? []).map((path) => (
            <Tag key={path}>{path}</Tag>
          ))}
          <Tooltip title={t('dropFilesHint')}>
            <span className={styles.dropHint}>
              <PaperClipOutlined /> {t('dropFilesShort')}
            </span>
          </Tooltip>
        </div>
        <Input.TextArea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('askPlaceholder')}
          autoSize={{ minRows: 3, maxRows: 7 }}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              requestSend();
            }
          }}
        />
        {generating ? (
          <Button danger icon={<StopOutlined />} onClick={stop}>
            {t('stop')}
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={!prompt.trim()}
            onClick={requestSend}
          >
            {t('send')}
          </Button>
        )}
      </div>
      {contextOpen && (
        <ContextSelector
          open
          initialSelection={savedContext ?? defaultContext}
          onCancel={() => setContextOpen(false)}
          onConfirm={confirmContext}
        />
      )}
    </aside>
  );
}
