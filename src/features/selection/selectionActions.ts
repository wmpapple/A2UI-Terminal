export type SelectionAction =
  'polish' | 'shorten' | 'professional' | 'explain' | 'extract' | 'custom';

export const selectionActionPrompt = (action: SelectionAction, customInstruction = ''): string => {
  if (action === 'explain') {
    return '请解释当前选区的含义、上下文作用和可能的歧义。只返回说明，不要生成修改协议，不要修改文件。';
  }
  const instruction =
    action === 'polish'
      ? '润色当前选区，保持原意和事实不变，使表达更流畅。'
      : action === 'shorten'
        ? '缩短当前选区，保留关键信息，删除重复和冗余表达。'
        : action === 'professional'
          ? '把当前选区改写得更专业、准确和克制，保持原意。'
          : action === 'extract'
            ? '把当前选区改写为简洁的重点列表，只保留核心信息。'
            : customInstruction.trim();
  return `${instruction}\n只修改当前选区。返回可审阅的 document_patch JSON；不得直接写入文件，不得修改选区之外的内容。`;
};

export const isExplanationAction = (action: SelectionAction): boolean => action === 'explain';
