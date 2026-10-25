import type {components} from './api/v1';
import type {FrontendRequestScope} from './FrontendUiTypes';

/** Resource intent comes from the admitted router record, independently of the
 * equivalent case/trailing-slash spelling used for the current URL. */
export type EntityRouteIntent = 'detail' | 'guest' | 'admin';

/** Features select affected query families; the shared admission presentation owns
 * their cancellation/removal. Inactive copies can retire without discarding an
 * already mounted creation draft or canceling the denial-producing admission. */
export interface EntityEntryRetirement {
    families: readonly (readonly unknown[])[];
    inactiveFamilies?: readonly (readonly unknown[])[];
}

/** Resource families share an admission envelope while retaining their own reads
 * and denial invalidation. No guest capability is consumed by this presentation. */
export interface EntityEntryPageProps {
    queryKey: readonly unknown[];
    initial?: components['schemas']['PackingResourceEntry'];
    read: (scope: FrontendRequestScope, signal: AbortSignal) => Promise<components['schemas']['PackingResourceEntry']>;
    deniedQueries: (entry: {readonly status: number}, scope: FrontendRequestScope) => EntityEntryRetirement;
}
