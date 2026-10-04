import { Alert, Button, Drawer, Input, Modal, Select, Space, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../app/i18n/useI18n';
import type { DocumentSnapshot } from '../../shared/types/document';
import type { ReviewApplication, ReviewRequest } from '../../shared/types/domain';
import type {
  DocumentBlock,
  StructuredOperation,
  StructuredView,
} from '../../shared/types/structuredDocument';
import { renderSafeMarkdown } from '../../shared/markdown/renderSafeMarkdown';
import { errorDetails } from '../../stores/support';
import { structuredController as api } from './structuredController';
import { editorMarkdown, markSelection } from './editorAdapter';
import styles from './StructuredDocumentPanel.module.css';

function BlockPreview({ block }: { block: DocumentBlock }) {
  if (block.node.kind === 'page_break') return <hr aria-label="Page break" />;
  if (block.node.kind === 'image') {
    return block.node.source.startsWith('data:image/png;base64,') ? (
      <img
        alt={block.node.alt}
        src={block.node.source}
        style={{ maxWidth: '100%', maxHeight: 320 }}
      />
    ) : (
      <p>[{block.node.alt}]</p>
    );
  }
  // Do not load remote or local images in a document structure preview.
  return (
    <div
      dangerouslySetInnerHTML={{
        __html: renderSafeMarkdown(block.source).replace(/<img\b[^>]*>/gi, '[图片 / image]'),
      }}
    />
  );
}

function BlockEditor({
  block,
  onChange,
  zh,
}: {
  block: DocumentBlock;
  onChange: (markdown: string) => void;
  zh: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const rich =
    ['paragraph', 'heading', 'quote'].includes(block.node.kind) && !/[`[<]/.test(block.source);
  const [html] = useState(() => ({
    __html: renderSafeMarkdown(block.source).replace(/<img\b[^>]*>/gi, '[图片 / image]'),
  }));
  if (!rich)
    return (
      <Input.TextArea
        aria-label={zh ? '结构块内容' : 'Block content'}
        defaultValue={block.source.trim()}
        rows={6}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  const changed = () => {
    if (root.current) onChange(editorMarkdown(root.current, block));
  };
  return (
    <>
      <Space>
        <Button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (root.current && markSelection(root.current, 'strong')) changed();
          }}
        >
          {zh ? '加粗' : 'Bold'}
        </Button>
        <Button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (root.current && markSelection(root.current, 'em')) changed();
          }}
        >
          {zh ? '斜体' : 'Italic'}
        </Button>
      </Space>
      <div
        ref={root}
        role="textbox"
        aria-label={zh ? '段落内容' : 'Paragraph content'}
        contentEditable
        suppressContentEditableWarning
        className={styles.editable}
        dangerouslySetInnerHTML={html}
        onInput={changed}
        onDrop={(e) => e.preventDefault()}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          const selection = window.getSelection();
          if (!selection?.rangeCount || !root.current?.contains(selection.anchorNode)) return;
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const node = document.createTextNode(text);
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          changed();
        }}
      />
    </>
  );
}

export function StructuredDocumentPanel({
  snapshot,
  onApplied,
  compact = false,
}: {
  snapshot: DocumentSnapshot | null;
  onApplied: (application: ReviewApplication) => void | Promise<void>;
  compact?: boolean;
}) {
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const say = (cn: string, en: string) => (zh ? cn : en);
  const [open, setOpen] = useState(false),
    [view, setView] = useState<StructuredView | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [selected, setSelected] = useState<DocumentBlock | null>(null),
    [draft, setDraft] = useState(''),
    [inserting, setInserting] = useState(false);
  const [proposal, setProposal] = useState<{ review: ReviewRequest; key: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const current = useRef(snapshot);
  useEffect(() => {
    current.current = snapshot;
  }, [snapshot]);
  const key = JSON.stringify([
    snapshot?.target,
    snapshot?.contentHash,
    snapshot?.revisionId,
    snapshot?.hasUnsavedDraft,
  ]);
  const binding = useRef(key);
  useEffect(() => {
    binding.current = key;
  }, [key]);
  const inFlight = useRef(false);
  const pending = useRef<ReviewRequest | null>(null);
  const enabled = !!snapshot?.editable && snapshot.format === 'markdown';
  const dirty = !!snapshot?.hasUnsavedDraft;
  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(() => {
      if (!disposed) {
        setView(null);
        setSelected(null);
        setProposal(null);
        setInserting(false);
      }
    });
    if (pending.current) {
      void api.discard(pending.current).catch(() => {});
      pending.current = null;
    }
    if (open && snapshot && !snapshot.hasUnsavedDraft) {
      void api
        .inspect(snapshot)
        .then((value) => {
          if (!disposed) {
            setView(value);
            setError('');
          }
        })
        .catch((e) => {
          if (!disposed) setError(errorDetails(e).message);
        });
    }
    return () => {
      disposed = true;
    };
    // The snapshot binding deliberately excludes object identity and includes every precondition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, refresh]);
  useEffect(
    () => () => {
      if (pending.current) void api.discard(pending.current).catch(() => {});
    },
    []
  );
  const work = async (run: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await run();
    } catch (e) {
      setError(errorDetails(e).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const propose = async (operations: StructuredOperation[]) => {
    const captured = binding.current;
    if (!view || dirty) return;
    const review = await api.propose(view.snapshot, operations);
    if (binding.current !== captured) {
      await api.discard(review);
      return;
    }
    pending.current = review;
    setProposal({ review, key: captured });
  };
  if (!enabled) return null;
  const afterId = view?.document.blocks.at(-1)?.id ?? null;
  return (
    <>
      <Button
        block={!compact}
        size={compact ? 'small' : 'middle'}
        type={compact ? 'text' : 'default'}
        aria-label={say('结构化编辑', 'Structured editor')}
        disabled={dirty}
        onClick={() => setOpen(true)}
      >
        {compact ? say('结构', 'Structure') : say('结构化编辑', 'Structured editor')}
      </Button>
      <Drawer
        title={say('结构化文档', 'Structured document')}
        open={open}
        size={840}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <Alert
          closable
          type="info"
          showIcon
          title={say(
            '支持标题、段落、粗斜体、列表、简单表格、PNG 图片和分页。修改经确认后保存，可在历史记录恢复。',
            'Headings, paragraphs, bold, italic, lists, simple tables, PNG images and page breaks. Review changes before saving; restore through history.'
          )}
        />
        <p>
          {say(
            'Word 导入生成当前文档的副本内容，不修改原文件。复杂样式、页眉页脚和脚注不保留；合并或嵌套表格会提示转换失败。PDF 继续作为只读资料。',
            'Word imports a copy into this document. Complex styles, headers, footers and footnotes are not retained; merged or nested tables are rejected. PDF remains read-only.'
          )}
        </p>
        {error && <Alert closable type="error" title={error} onClose={() => setError('')} />}
        {dirty && (
          <Alert
            closable
            type="warning"
            title={say(
              '正文已变化，请先保存后重新打开。',
              'Save the changed document and reopen this editor.'
            )}
          />
        )}
        {view?.warnings.map((warning) => (
          <Alert
            key={warning}
            closable
            type="warning"
            title={
              zh
                ? warning
                : 'Some Markdown syntax is preserved as source; complex styles may be simplified on export.'
            }
          />
        ))}
        <fieldset disabled={busy || dirty || !!proposal} className={styles.fieldset}>
          <Space wrap>
            <Button
              disabled={!view}
              onClick={() => {
                setInserting(true);
                setDraft('');
              }}
            >
              {say('添加段落 / 列表', 'Add paragraph / list')}
            </Button>
            <Button
              disabled={!view}
              onClick={() =>
                void work(() =>
                  propose([
                    {
                      op: 'insert_table',
                      afterId,
                      rows: [
                        [say('名称', 'Name'), say('说明', 'Description')],
                        ['', ''],
                      ],
                    },
                  ])
                )
              }
            >
              {say('插入表格', 'Insert table')}
            </Button>
            <Button
              disabled={!view}
              onClick={() =>
                void work(() =>
                  propose([{ op: 'insert_block', afterId, markdown: '<!-- pagebreak -->' }])
                )
              }
            >
              {say('插入分页', 'Page break')}
            </Button>
            <Button
              disabled={!view}
              onClick={() =>
                void work(async () => {
                  const captured = binding.current;
                  const image = await api.image();
                  if (image && binding.current === captured)
                    await propose([
                      {
                        op: 'insert_block',
                        afterId,
                        markdown: `![${say('图片', 'Image')}](${image})`,
                      },
                    ]);
                })
              }
            >
              {say('插入图片', 'Insert image')}
            </Button>
            <Button
              disabled={!view}
              onClick={() =>
                void work(async () => {
                  const captured = binding.current;
                  const s = current.current;
                  if (!s) return;
                  const review = await api.import(s);
                  if (!review) return;
                  if (captured !== binding.current) {
                    await api.discard(review);
                    return;
                  }
                  pending.current = review;
                  setProposal({ review, key: captured });
                })
              }
            >
              {say('导入 Word / Markdown', 'Import Word / Markdown')}
            </Button>
          </Space>
          {inserting && (
            <section className={styles.block}>
              <Input.TextArea
                aria-label={say('新段落内容', 'New block content')}
                value={draft}
                rows={4}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={say(
                  '输入段落；列表可用 - 或 1. 开头',
                  'Enter a paragraph; start list items with - or 1.'
                )}
              />
              <Button
                disabled={!draft.trim()}
                onClick={() =>
                  void work(() => propose([{ op: 'insert_block', afterId, markdown: draft }]))
                }
              >
                {say('预览插入', 'Review insertion')}
              </Button>
              <Button onClick={() => setInserting(false)}>{say('取消', 'Cancel')}</Button>
            </section>
          )}
          {view?.document.blocks.map((block, index) => (
            <section key={block.id} className={styles.block} data-block-id={block.id}>
              <Space wrap>
                <Tag>{index + 1}</Tag>
                <Button
                  size="small"
                  onClick={() => {
                    setSelected(block);
                    setDraft(block.source.trim());
                    setInserting(false);
                  }}
                >
                  {say('编辑', 'Edit')}
                </Button>
                {['paragraph', 'heading'].includes(block.node.kind) && (
                  <Select
                    aria-label={say('段落级别', 'Heading level')}
                    style={{ width: 110 }}
                    value={block.node.kind === 'heading' ? block.node.level : 0}
                    options={Array.from({ length: 7 }, (_, level) => ({
                      value: level,
                      label: level
                        ? `${say('标题', 'Heading')} ${level}`
                        : say('正文', 'Paragraph'),
                    }))}
                    onChange={(level) =>
                      void work(() => propose([{ op: 'change_heading', blockId: block.id, level }]))
                    }
                  />
                )}
                <Button
                  size="small"
                  disabled={index === 0}
                  onClick={() =>
                    void work(() =>
                      propose([
                        {
                          op: 'move_block',
                          blockId: block.id,
                          afterId: index < 2 ? null : view.document.blocks[index - 2].id,
                        },
                      ])
                    )
                  }
                >
                  {say('上移', 'Move up')}
                </Button>
                <Button
                  size="small"
                  disabled={index === view.document.blocks.length - 1}
                  onClick={() =>
                    void work(() =>
                      propose([
                        {
                          op: 'move_block',
                          blockId: block.id,
                          afterId: view.document.blocks[index + 1].id,
                        },
                      ])
                    )
                  }
                >
                  {say('下移', 'Move down')}
                </Button>
                <Button
                  size="small"
                  danger
                  onClick={() =>
                    void work(() => propose([{ op: 'delete_block', blockId: block.id }]))
                  }
                >
                  {say('删除', 'Delete')}
                </Button>
              </Space>
              {block.node.kind === 'table' ? (
                <table className={styles.table}>
                  <tbody>
                    {block.node.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c}>
                            <Input.TextArea
                              aria-label={`${say('单元格', 'Cell')} ${r + 1},${c + 1}`}
                              defaultValue={cell.map((run) => run.text).join('')}
                              key={cell.map((run) => run.text).join('')}
                              autoSize
                              onBlur={(e) => {
                                const text = e.target.value;
                                if (text !== cell.map((run) => run.text).join(''))
                                  void work(() =>
                                    propose([
                                      {
                                        op: 'update_cell',
                                        blockId: block.id,
                                        row: r,
                                        column: c,
                                        text,
                                      },
                                    ])
                                  );
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <BlockPreview block={block} />
              )}
              {selected?.id === block.id && (
                <div>
                  <BlockEditor key={block.id} block={block} onChange={setDraft} zh={zh} />
                  <Space>
                    <Button
                      disabled={draft === block.source.trim() || !draft.trim()}
                      onClick={() =>
                        void work(() =>
                          propose([{ op: 'replace_block', blockId: block.id, markdown: draft }])
                        )
                      }
                    >
                      {say('审阅本段修改', 'Review block changes')}
                    </Button>
                    <Button onClick={() => setSelected(null)}>
                      {say('取消编辑', 'Cancel edit')}
                    </Button>
                  </Space>
                </div>
              )}
            </section>
          ))}
        </fieldset>
      </Drawer>
      <Modal
        title={say('确认文档修改', 'Review document changes')}
        open={!!proposal && proposal.key === key && open}
        width={800}
        confirmLoading={busy}
        okText={say('接受并保存', 'Accept and save')}
        cancelText={say('放弃修改', 'Discard')}
        onCancel={() => {
          if (busy || !proposal) return;
          void work(async () => {
            await api.discard(proposal.review);
            pending.current = null;
            setProposal(null);
            setRefresh((v) => v + 1);
          });
        }}
        onOk={() =>
          void work(async () => {
            if (!proposal || proposal.key !== binding.current || current.current?.hasUnsavedDraft)
              throw Error(say('正文已变化，请重新编辑', 'Document changed; reopen the editor'));
            const application = await api.accept(proposal.review);
            pending.current = null;
            setProposal(null);
            await onApplied(application);
            setRefresh((v) => v + 1);
          })
        }
      >
        <p>
          {say(
            '以下修改将替换当前已保存正文。请核对，接受后可通过历史记录恢复。',
            'These changes replace the saved document. Check them before accepting; history can restore earlier content.'
          )}
        </p>
        {proposal && (
          <>
            <h4>{say('修改前', 'Before')}</h4>
            <pre className={styles.source}>{proposal.review.blocks[0]?.before}</pre>
            <h4>{say('修改后', 'After')}</h4>
            <div
              className={styles.source}
              dangerouslySetInnerHTML={{
                __html: renderSafeMarkdown(proposal.review.blocks[0]?.after ?? '').replace(
                  /<img\b[^>]*>/gi,
                  '[图片 / image]'
                ),
              }}
            />
          </>
        )}
      </Modal>
    </>
  );
}
