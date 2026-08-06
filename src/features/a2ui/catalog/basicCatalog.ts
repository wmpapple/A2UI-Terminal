export const basicCatalog = [
  'Row',
  'Column',
  'Stack',
  'Text',
  'Card',
  'Badge',
  'Progress',
  'TextField',
  'Select',
  'Checkbox',
  'Button',
  'Tabs',
  'Form',
] as const;

export type BasicComponentName = (typeof basicCatalog)[number];

export const isBasicComponent = (name: string): name is BasicComponentName =>
  basicCatalog.includes(name as BasicComponentName);
