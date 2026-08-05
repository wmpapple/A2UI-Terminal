export const normalizeGeneratedText = (value) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\"/g, '"');
};
