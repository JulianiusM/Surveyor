import type {components} from './api/v1';
import type {FrontendRequestScope} from './FrontendUiTypes';

/** New manual rows have no persisted ID until the shared server saves the review. */
export type ActivityRecommendationRow = Omit<components['schemas']['ActivityRecommendations']['recommendations'][number], 'id' | 'profile'> & {
    id?: string;
    /** Only staged rows can copy an option's generated fallback. This presentation
     * origin is not a server profile field and never enters review/application. */
    profile: components['schemas']['ActivityRecommendationProfile'] & {nameIsFallback?: boolean};
};

/** A mounted review owns its local identity independently of saved/generated IDs. */
export interface ActivityRecommendationDraftRow {
    key: string;
    value: ActivityRecommendationRow;
    /** A local swap group binds exactly two reviewed operations. Null records an
     * explicitly independent move, including a retired swap leg; absent means
     * restored data has no pairing evidence. */
    swapGroup?: string | null;
}

/** One relationship owner supplies presentation and every local review mutation. */
export interface ActivityRecommendationRelationship {
    kind: 'single' | 'paired' | 'ambiguous';
    partners: ActivityRecommendationDraftRow[];
    candidates: ActivityRecommendationDraftRow[];
}

export type ActivityRecommendationReviewAction = {kind: 'status'; status: 'PENDING' | 'APPROVED' | 'REJECTED'}
    | {kind: 'remove'} | {kind: 'resolve'};

/** A chooser retains intent/evidence only. No draft row changes before confirmation. */
export interface ActivityRecommendationPairChoice {
    scope: FrontendRequestScope;
    rowIdentity: string;
    rowVersion: string;
    action: ActivityRecommendationReviewAction;
    candidates: {identity: string; version: string}[];
}

/** Manual construction distinguishes a new swap from independently staged moves. */
export interface ActivityManualRecommendation {
    targetSlotId: string;
    operation: 'ASSIGN' | 'REASSIGN' | 'SWAP';
    profileId: string;
    sourceItemId: string;
    swapProfileId: string;
}
