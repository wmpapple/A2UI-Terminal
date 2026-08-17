import type {
  ImportBatch,
  ImportConfirmation,
  ImportDropOutcome,
  ImportItem,
  SetImportDropTargetInput,
  WorkspaceDocument,
} from '../types/domain';

const clone = <T>(value: T): T => structuredClone(value);
let activeBatch: ImportBatch | null = null;

const items = (): ImportItem[] => [
  {
    id: 'mock-import-notes',
    name: 'meeting-notes.md',
    extension: 'md',
    sizeBytes: 1_280,
    capability: 'editable_text',
    status: 'ready',
    readable: true,
    editable: true,
    reasonCode: null,
    reason: null,
    alternative: null,
    warnings: [],
  },
  {
    id: 'mock-import-report',
    name: 'research-report.docx',
    extension: 'docx',
    sizeBytes: 42_560,
    capability: 'read_only_text',
    status: 'ready',
    readable: true,
    editable: false,
    reasonCode: null,
    reason: null,
    alternative: null,
    warnings: ['DOCX 只读取正文文本；复杂版式、公式和图表不会无损复刻'],
  },
  {
    id: 'mock-import-table',
    name: 'sales.xlsx',
    extension: 'xlsx',
    sizeBytes: 18_432,
    capability: 'planned_structured_data',
    status: 'planned',
    readable: false,
    editable: false,
    reasonCode: 'ADAPTER_NOT_READY',
    reason: 'S2.2 将提供受控 XLSX 基础数据解析；公式和图表只读优先',
    alternative: '可先导出为 CSV，宏和外部链接不会执行或访问',
    warnings: [],
  },
  {
    id: 'mock-import-image',
    name: 'whiteboard.png',
    extension: 'png',
    sizeBytes: 23_040,
    capability: 'planned_visual_context',
    status: 'planned',
    readable: false,
    editable: false,
    reasonCode: 'ADAPTER_NOT_READY',
    reason: 'S2.2 将保留原始视觉信息并作为可单独授权的多模态上下文',
    alternative: '当前不会只提取文字来假装理解图片，也不会把图片发送给模型',
    warnings: [],
  },
  {
    id: 'mock-import-secret',
    name: '.env',
    extension: 'env',
    sizeBytes: 96,
    capability: 'unsupported',
    status: 'rejected',
    readable: false,
    editable: false,
    reasonCode: 'SENSITIVE_OR_HIDDEN_PATH',
    reason: '隐藏文件、密钥或敏感路径不会加入导入批次',
    alternative: '请改用不包含密钥的脱敏副本',
    warnings: [],
  },
];

const mockDocument = (item: ImportItem): WorkspaceDocument => ({
  path: `selected/${item.id}/${item.name}`,
  name: item.name,
  language: item.extension === 'md' ? 'markdown' : 'word',
  content:
    item.extension === 'md'
      ? '# Meeting notes\n\nLocal Web Mock source.\n'
      : 'Research report\n\nRead-only extracted document text.',
  contentHash: item.id.padEnd(64, '0').slice(0, 64),
  sizeBytes: item.sizeBytes,
  draft: null,
  editable: item.editable,
  extracted: item.extension === 'docx',
  sourceId: item.id,
});

export const webMockImportGateway = {
  async selectImportSources(_workspaceId?: string): Promise<ImportBatch> {
    void _workspaceId;
    const batchItems = items();
    activeBatch = {
      id: 'web-mock-import-batch',
      status: 'awaiting_confirmation',
      items: batchItems,
      totalSizeBytes: batchItems.reduce((sum, item) => sum + item.sizeBytes, 0),
      maxFiles: 20,
      maxBatchBytes: 100 * 1024 * 1024,
      canConfirm: true,
      failureCode: null,
      failureReason: null,
    };
    return clone(activeBatch);
  },

  async inspectImportBatch(batchId: string): Promise<ImportBatch> {
    if (!activeBatch || activeBatch.id !== batchId) throw new Error('导入批次不存在或已经失效');
    return clone(activeBatch);
  },

  async setImportDropTarget(_input: SetImportDropTargetInput): Promise<void> {
    void _input;
  },

  async listenImportDropOutcomes(
    _handler: (outcome: ImportDropOutcome) => void
  ): Promise<() => void> {
    void _handler;
    return () => undefined;
  },

  async confirmImport(
    batchId: string,
    acceptedItemIds: string[],
    confirmed: boolean
  ): Promise<ImportConfirmation> {
    if (!activeBatch || activeBatch.id !== batchId) throw new Error('导入批次不存在或已经失效');
    const accepted = new Set(acceptedItemIds);
    const selected = activeBatch.items.filter((item) => accepted.has(item.id));
    if (confirmed && selected.some((item) => item.status !== 'ready')) {
      throw new Error('只能确认当前可读取的文件');
    }
    const batch: ImportBatch = {
      ...activeBatch,
      status: confirmed ? 'confirmed' : 'cancelled',
      canConfirm: false,
    };
    activeBatch = null;
    return clone({
      batch,
      workspace: confirmed
        ? { id: 'web-mock-workspace', name: '已选择的资料', available: true, kind: 'standalone' }
        : null,
      documents: confirmed ? selected.map(mockDocument) : [],
    });
  },
};

export const resetWebMockImports = () => {
  activeBatch = null;
};
