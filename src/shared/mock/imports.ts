import type {
  ImportBatch,
  ImportConfirmation,
  ImportDropOutcome,
  ImportItem,
  DocumentSource,
  DocumentSourceContent,
  SetImportDropTargetInput,
  WorkspaceDocument,
} from '../types/domain';

const clone = <T>(value: T): T => structuredClone(value);
let activeBatch: ImportBatch | null = null;
let authorizedSources: DocumentSource[] = [];

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
    capability: 'structured_data',
    status: 'ready',
    readable: true,
    editable: false,
    reasonCode: null,
    reason: null,
    alternative: null,
    warnings: [
      '基础数据读取上限：32 个工作表、每表 10000 行/256 列、共 100000 个单元格、单元格 32768 字符',
      '只读基础数据；公式不计算，宏不执行，外部链接不访问',
    ],
  },
  {
    id: 'mock-import-image',
    name: 'whiteboard.png',
    extension: 'png',
    sizeBytes: 23_040,
    capability: 'visual_context',
    status: 'ready',
    readable: true,
    editable: false,
    reasonCode: null,
    reason: null,
    alternative: null,
    warnings: [
      '原始视觉信息将按 1280×720 保留；不使用 OCR 文本假装理解图片',
      '当前未连接视觉模型；图片不会发送，后续发送前仍需确认上下文范围',
    ],
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

const mockSource = (item: ImportItem): DocumentSource => {
  const kind = item.extension === 'xlsx' ? 'table' : item.extension === 'png' ? 'image' : 'text';
  return {
    id: item.id,
    workspaceId: 'web-mock-workspace',
    name: item.name,
    extension: item.extension,
    kind,
    capability: item.capability as DocumentSource['capability'],
    mimeType:
      kind === 'table'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : kind === 'image'
          ? 'image/png'
          : 'text/plain; charset=utf-8',
    sizeBytes: item.sizeBytes,
    contentHash: item.id.padEnd(64, '0').slice(0, 64),
    editable: item.editable,
    warnings: [...item.warnings],
    table:
      kind === 'table'
        ? {
            sheetNames: ['销售数据'],
            rowCount: 3,
            columnCount: 3,
            cellCount: 9,
            formulaCellCount: 0,
            formulaInjectionRiskCellCount: 1,
            limits: {
              maxSheets: 32,
              maxRowsPerSheet: 10_000,
              maxColumnsPerSheet: 256,
              maxCellsTotal: 100_000,
              maxCellChars: 32_768,
            },
          }
        : null,
    image:
      kind === 'image'
        ? {
            width: 1280,
            height: 720,
            animated: false,
            originalPreserved: true,
            localPreviewAvailable: true,
            visualModelRequired: true,
          }
        : null,
  };
};

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
    const sources = confirmed ? selected.map(mockSource) : [];
    if (confirmed) {
      const merged = new Map(
        [...authorizedSources, ...sources].map((source) => [
          `${source.workspaceId}:${source.id}`,
          source,
        ])
      );
      authorizedSources = [...merged.values()];
    }
    activeBatch = null;
    return clone({
      batch,
      workspace: confirmed
        ? { id: 'web-mock-workspace', name: '已选择的资料', available: true, kind: 'standalone' }
        : null,
      documents: confirmed
        ? selected.filter((item) => ['md', 'docx'].includes(item.extension)).map(mockDocument)
        : [],
      sources,
    });
  },

  async listDocumentSources(workspaceId: string): Promise<DocumentSource[]> {
    return clone(authorizedSources.filter((source) => source.workspaceId === workspaceId));
  },

  async readDocumentSource(sourceId: string): Promise<DocumentSourceContent> {
    const source = authorizedSources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error('资料来源不存在或未授权');
    const tableContent =
      source.kind === 'table'
        ? {
            sheets: [
              {
                name: '销售数据',
                rows: [
                  ['月份', '销售额', '备注'],
                  ['一月', '120', '稳定'],
                  ['二月', '132', '=2+2'],
                ].map((row) =>
                  row.map((value) => ({
                    value,
                    formula: false,
                    formulaInjectionRisk: value.startsWith('='),
                  }))
                ),
              },
            ],
            limits: source.table!.limits,
          }
        : null;
    return clone({
      source,
      textContent: source.kind === 'text' ? 'Local Web Mock source.' : null,
      tableContent,
      imageDataUrl:
        source.kind === 'image'
          ? 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2U4ZjFmZiIvPjx0ZXh0IHg9IjEyMCIgeT0iNjAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiMxNjc3ZmYiPkxvY2FsIHByZXZpZXc8L3RleHQ+PC9zdmc+'
          : null,
      visualModelAvailable: false,
      notice:
        source.kind === 'image'
          ? '图片只在本机预览，尚未发送给 AI；使用视觉模型前仍需单独确认上下文范围。'
          : '表格仅在本机受控解析；公式不会计算，外部链接不会访问。',
    });
  },

  async revokeDocumentSource(workspaceId: string, sourceId: string) {
    const existing = authorizedSources.find(
      (source) => source.workspaceId === workspaceId && source.id === sourceId
    );
    if (!existing) throw new Error('资料来源不存在或未获当前工作区授权');
    authorizedSources = authorizedSources.filter(
      (source) => source.workspaceId !== workspaceId || source.id !== sourceId
    );
    return { revoked: true, originalFileDeleted: false as const };
  },
};

export const resetWebMockImports = () => {
  activeBatch = null;
  authorizedSources = [];
};
