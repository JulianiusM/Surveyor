import type {EntityManager} from 'typeorm';
import type {ActivityPlan} from '../modules/database/entities/activity/ActivityPlan';
import type {ActivitySlot} from '../modules/database/entities/activity/ActivitySlot';
import type {SessionLike} from './PermissionTypes';
import type {components} from './api/v1';

/** Transport preparation never performs a later mutable-session read. */
export type ActivityCommandPreparation<Result> = (result: Result) => void;

/** These established operations acknowledge success with the same invariant receipt. */
export type ActivitySimpleMutationOperation = 'updateActivityDefaults'
    | 'updateActivityRequirements'
    | 'setActivityAutomaticArchival'
    | 'addActivityTextField'
    | 'addActivityAdmin'
    | 'updateActivityAdmin'
    | 'deleteActivityAdmin'
    | 'uploadActivityHeader'
    | 'deleteActivityHeader'
    | 'archiveActivityPlan'
    | 'restoreActivityPlan'
    | 'deleteActivityPlan'
    | 'addActivitySlot'
    | 'updateActivitySlot'
    | 'deleteActivitySlot'
    | 'updateActivityOrder'
    | 'setActivityAssignment'
    | 'removeActivityAssignment'
    | 'addActivityRole'
    | 'updateActivityRoleAssignments'
    | 'updateActivityTextField'
    | 'deleteActivityTextField';

/** Optional v1 checks join the existing property transaction; direct callers omit this context. */
export interface ActivityPropertyTransportContext {
    session: SessionLike;
    token?: string;
    prepare?: ActivityCommandPreparation<components['schemas']['ActivityMetadata']>;
}

/** Existing slot persistence admits the captured v1 actor after acquiring its current root lock. */
export type ActivitySlotAdmission = (manager: EntityManager, plan: ActivityPlan, slot: ActivitySlot) => Promise<void>;
