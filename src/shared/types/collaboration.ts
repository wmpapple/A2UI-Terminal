export type SharePermission = 'read' | 'review';
export interface LocalIdentity {
  id: string;
  displayName: string;
}
export interface SharePackage {
  schemaVersion: number;
  id: string;
  senderName: string;
  title: string;
  format: 'markdown' | 'text';
  permission: SharePermission;
  content: string;
  contentHash: string;
}
export interface FeedbackPackage {
  schemaVersion: number;
  id: string;
  shareId: string;
  baseHash: string;
  reviewerName: string;
  comments: string;
  proposedContent: string | null;
}
export type CollaborationPackage =
  { kind: 'share'; payload: SharePackage } | { kind: 'feedback'; payload: FeedbackPackage };
export interface CollaborationItem {
  id: string;
  title: string;
  kind: string;
  status: string;
  createdAt: string;
  senderName?: string;
  permission?: SharePermission;
}
export interface CollaborationOverview {
  identity: LocalIdentity;
  shares: CollaborationItem[];
  inbox: CollaborationItem[];
  pendingCount: number;
}
export interface InboxDetail {
  package: CollaborationPackage;
  reply: FeedbackPackage | null;
}
export interface CreateShareInput {
  resultId: string;
  baseHash: string;
  revisionId: string;
  permission: SharePermission;
}
export interface SaveFeedbackInput {
  inboxId: string;
  comments: string;
  proposedContent: string | null;
}
