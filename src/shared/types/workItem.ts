export type WorkItemType = 'document' | 'tool' | 'result' | 'canvas';

export interface WorkItem {
  id: string;
  type: WorkItemType;
  title: string;
  status?: 'saved' | 'dirty' | 'conflict';
}
