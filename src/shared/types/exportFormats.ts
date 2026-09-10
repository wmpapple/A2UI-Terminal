import type { ExportFormat, ResultType, TextResultFormat } from './domain';

export const exportFormatsFor = (type: ResultType, format: TextResultFormat): ExportFormat[] => {
  if (type === 'document')
    return [format === 'markdown' ? 'markdown' : 'plain_text', 'docx', 'pdf', 'rtf'];
  if (type === 'spreadsheet') return ['csv', 'xlsx'];
  if (type === 'checklist' || type === 'form') return ['json', 'pdf'];
  return ['json'];
};

export const exportExtension = (format: ExportFormat): string =>
  format === 'markdown' ? 'md' : format === 'plain_text' ? 'txt' : format;
