import type { ReviewRequest } from '../../shared/types/domain';

// selected is a local edit; persisted block status is the fallback after restart.
export function reviewSelectionIsSaved(review: ReviewRequest): boolean {
  return (
    ['accepted', 'partially_accepted'].includes(review.status) &&
    review.blocks.every(
      (block) => (block.selected ?? block.status !== 'rejected') === (block.status === 'accepted')
    )
  );
}
