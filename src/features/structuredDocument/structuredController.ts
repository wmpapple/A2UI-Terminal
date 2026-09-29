import { desktopGateway } from '../../shared/platform/gateway';
import { reviewController } from '../diff/reviewController';
import type { DocumentSnapshot } from '../../shared/types/document';
import type { StructuredOperation } from '../../shared/types/structuredDocument';
import type { ReviewRequest } from '../../shared/types/domain';

export const structuredController = {
  inspect: (snapshot: DocumentSnapshot) =>
    desktopGateway.inspectStructuredDocument(snapshot.target),
  propose: (snapshot: DocumentSnapshot, operations: StructuredOperation[]) =>
    desktopGateway.proposeStructuredPatch({
      schemaVersion: 2,
      target: snapshot.target,
      baseHash: snapshot.contentHash,
      baseRevisionId: snapshot.revisionId,
      operations,
    }),
  import: (snapshot: DocumentSnapshot) => desktopGateway.importStructuredDocument(snapshot),
  image: () => desktopGateway.pickDocumentImage(),
  discard: (review: ReviewRequest) => reviewController.discard(review.workspaceId, review.id),
  async accept(review: ReviewRequest) {
    await reviewController.decide(
      review.id,
      review.workspaceId,
      review.blocks.map((block) => ({ blockId: block.id, accepted: true }))
    );
    return reviewController.apply(review.id, review.workspaceId);
  },
};
