import type { A2uiNode, A2uiSurface } from '../../shared/types/domain';
import type { CanvasBlock } from '../../shared/types/canvas';
import { renderSafeMarkdown } from '../../shared/markdown/renderSafeMarkdown';
import { parseChecklist, parseCsv, parseForm, parseTool } from '../results/resultAdapters';
import { A2uiRuntime } from '../a2ui/runtime/A2uiRuntime';
import { isCanvasSurface } from './canvasSurface';
import { readableAiContent } from './canvasAiContent';
import styles from './CanvasVisualContent.module.css';

function surfaceKind(surface: A2uiSurface): string {
  const kinds = new Set<string>();
  const visit = (node: A2uiNode) => {
    kinds.add(node.component);
    node.children.forEach(visit);
  };
  visit(surface.root);
  if (kinds.has('Table')) return 'table';
  if (kinds.has('Checklist')) return 'checklist';
  if (kinds.has('Form') || kinds.has('TextField')) return 'form';
  if (kinds.has('Status') || kinds.has('ResultSummary')) return 'status';
  return 'panel';
}

function SurfaceView({ surface }: { surface: A2uiSurface }) {
  if (!isCanvasSurface(surface))
    return (
      <div className={styles.invalid} role="status">
        组件结构无效，请刷新来源或重新导入。
      </div>
    );
  return (
    <div className={styles.surface} data-layout={surfaceKind(surface)}>
      <A2uiRuntime surface={surface} disabled onAction={() => undefined} />
    </div>
  );
}

type ParsedResult =
  | { kind: 'spreadsheet'; rows: string[][] }
  | { kind: 'checklist'; items: ReturnType<typeof parseChecklist> }
  | { kind: 'form'; fields: ReturnType<typeof parseForm> }
  | { kind: 'tool'; settings: ReturnType<typeof parseTool> }
  | { kind: 'invalid'; message: string };

function parseResult(block: CanvasBlock): ParsedResult {
  try {
    if (block.resultType === 'spreadsheet')
      return { kind: 'spreadsheet', rows: parseCsv(block.body) };
    if (block.resultType === 'checklist') {
      const items = parseChecklist(block.body);
      if (
        !items.every(
          (item) =>
            item &&
            typeof item.id === 'string' &&
            typeof item.text === 'string' &&
            typeof item.completed === 'boolean'
        )
      )
        throw new Error('清单项目格式无效');
      return { kind: 'checklist', items };
    }
    if (block.resultType === 'form') {
      const fields = parseForm(block.body);
      if (
        !fields.every(
          (field) => field && typeof field.id === 'string' && typeof field.label === 'string'
        )
      )
        throw new Error('表单字段格式无效');
      return { kind: 'form', fields };
    }
    if (block.resultType === 'tool') {
      const settings = parseTool(block.body);
      if (
        !settings.every(
          (setting) =>
            setting &&
            typeof setting.key === 'string' &&
            typeof setting.label === 'string' &&
            typeof setting.value === 'string'
        )
      )
        throw new Error('工具设置格式无效');
      return { kind: 'tool', settings };
    }
    return { kind: 'invalid', message: '缺少可视化成果类型，请刷新源内容。' };
  } catch (cause) {
    return { kind: 'invalid', message: `内容解析失败：${String(cause)}` };
  }
}

function ResultView({ block }: { block: CanvasBlock }) {
  if (block.surface) return <SurfaceView surface={block.surface} />;
  const parsed = parseResult(block);
  if (parsed.kind === 'spreadsheet') {
    const width = Math.max(0, ...parsed.rows.map((row) => row.length));
    return (
      <div className={styles.tableWrap} aria-label="成果表格预览">
        <div className={styles.metric}>
          {Math.max(parsed.rows.length - 1, 0)} 行 · {width} 列
        </div>
        <table>
          <tbody>
            {parsed.rows.slice(0, 100).map((row, index) => (
              <tr key={index}>
                {Array.from({ length: width }, (_, column) =>
                  index === 0 ? (
                    <th key={column}>{row[column] ?? ''}</th>
                  ) : (
                    <td key={column}>{row[column] ?? ''}</td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {parsed.rows.length > 100 && (
          <div className={styles.metric}>画布预览前 100 行，打开成果查看全部内容</div>
        )}
      </div>
    );
  }
  if (parsed.kind === 'checklist') {
    const done = parsed.items.filter((item) => item.completed).length;
    return (
      <div className={styles.items} aria-label="成果清单预览">
        <div className={styles.metric}>
          {done} / {parsed.items.length} 已完成
        </div>
        {parsed.items.map((item) => (
          <div key={item.id} className={styles.item}>
            <span className={styles.check} data-done={item.completed}>
              {item.completed ? '✓' : ''}
            </span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    );
  }
  if (parsed.kind === 'form')
    return (
      <div className={styles.form} aria-label="成果表单预览">
        {parsed.fields.map((field) => (
          <div key={field.id} className={styles.formField}>
            <strong>
              {field.label}
              {field.required ? ' *' : ''}
            </strong>
            <span>
              {field.kind === 'checkbox'
                ? '□'
                : field.kind === 'date'
                  ? '选择日期'
                  : field.kind === 'number'
                    ? '输入数字'
                    : '填写内容'}
            </span>
          </div>
        ))}
      </div>
    );
  if (parsed.kind === 'tool')
    return (
      <div className={styles.settings} aria-label="成果工具预览">
        {parsed.settings.map((setting) => (
          <div key={setting.key} className={styles.setting}>
            <span>{setting.label}</span>
            <strong>{setting.value || '未填写'}</strong>
          </div>
        ))}
      </div>
    );
  return (
    <div className={styles.invalid} role="status">
      {parsed.message}
    </div>
  );
}

export function CanvasVisualContent({ block }: { block: CanvasBlock }) {
  if (block.type === 'result' || block.type === 'tool') return <ResultView block={block} />;
  if (block.type === 'a2ui') {
    if (block.surface) return <SurfaceView surface={block.surface} />;
    return <div className={styles.invalid}>请选择已有的 A2UI 组件，或粘贴有效的组件 JSON。</div>;
  }
  if (block.type === 'summary') {
    const content = readableAiContent(block.body) || '等待生成摘要';
    return (
      <section className={styles.summaryVisual} aria-label="AI 摘要可视化">
        <div className={styles.summaryMasthead}>
          <span className={styles.summaryEmblem} aria-hidden="true">
            ✦
          </span>
          <div>
            <span className={styles.summaryKicker}>AI RESEARCH NOTE</span>
            <strong>洞察摘要</strong>
          </div>
          <span className={styles.summaryIndex}>01 / 摘要</span>
        </div>
        <article
          className={`${styles.markdown} ${styles.summaryBody}`}
          dangerouslySetInnerHTML={{ __html: renderSafeMarkdown(content) }}
        />
        {block.sourcePath && (
          <div className={styles.summarySource}>来源 · {block.sourcePath.split('/').at(-1)}</div>
        )}
      </section>
    );
  }
  return null;
}
