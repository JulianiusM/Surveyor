import type {components} from './api/v1';

/** New manual rows have no persisted ID until the shared server saves the review. */
export type ActivityRecommendationRow = Omit<components['schemas']['ActivityRecommendations']['recommendations'][number], 'id'> & {id?: string};

/** A mounted review owns its local identity independently of saved/generated IDs. */
export interface ActivityRecommendationDraftRow {
    key: string;
    value: ActivityRecommendationRow;
}

/** Both swap legs share one local group; that identity never enters the wire contract. */
export interface ActivityManualRecommendation {
    targetSlotId: string;
    operation: 'ASSIGN' | 'REASSIGN' | 'SWAP';
    profileId: string;
    sourceItemId: string;
    swapProfileId: string;
}
