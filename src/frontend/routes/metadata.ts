import type {FrontendLoadingSkeleton} from '../../types/FrontendUiTypes';

/** Static skeleton geometry describes pending presentation only. Document and
 * command controllers remain responsible for actual page admission. */
export function javascriptPage(loadingSkeleton: FrontendLoadingSkeleton) {
    return {javascriptRequired: true, loadingSkeleton};
}

// Shared identity surfaces keep one geometry definition across their domains.
export const guestPage = javascriptPage({variant: 'guest', rows: 2});
export const identityMessagePage = javascriptPage({variant: 'workflow'});
