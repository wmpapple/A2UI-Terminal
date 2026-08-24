import type { ReviewBlockDecision, ReviewConflictResolution } from '../../shared/types/domain';
import { desktopGateway } from '../../shared/platform/gateway';

export const reviewController = {
  decide: (reviewId: string, workspaceId: string, decisions: ReviewBlockDecision[]) =>
    desktopGateway.decideReviewBlocks({ reviewId, workspaceId, decisions }),
  apply: (reviewId: string, workspaceId: string) =>
    desktopGateway.applyReview({ reviewId, workspaceId }),
  discard: (workspaceId: string, reviewId: string) =>
    desktopGateway.discardReview(workspaceId, reviewId),
  get: (reviewId: string) => desktopGateway.getReview(reviewId),
  listActive: (workspaceId: string) => desktopGateway.listActiveReviews(workspaceId),
  resolveConflict: (reviewId: string, workspaceId: string, resolution: ReviewConflictResolution) =>
    desktopGateway.resolveReviewConflict({ reviewId, workspaceId, resolution }),
  undoReview: (reviewId: string, workspaceId: string) =>
    desktopGateway.undoReview({ reviewId, workspaceId }),
  undo: (workspaceId: string, operationId: string) =>
    desktopGateway.undoDocumentPatch(workspaceId, operationId),
};
