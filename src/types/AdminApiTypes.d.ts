import type {Request} from 'express';
import type {operations} from './api/v1';
import type {ApiResponseBody} from './ApiTransportTypes';
import type {SessionLike} from './PermissionTypes';
import type {EntityType} from './UtilTypes';

/** Existing generated endpoints remain bound to their actual feature contracts. */
export interface AdminApiOperations {
    packing: {
        adminBaseline: 'getPackingAdminBaseline'; addAdmin: 'addPackingAdmin';
        updateAdmin: 'updatePackingAdmin'; removeAdmin: 'deletePackingAdmin';
        metadata: 'getPackingMetadata'; updateMetadata: 'updatePackingMetadata'; event: 'changePackingEvent';
        archive: 'archivePackingList'; restore: 'restorePackingList'; automatic: never; search: 'searchPackingProfiles';
    };
    drivers: {
        adminBaseline: 'getDriversAdminBaseline'; addAdmin: 'addDriversAdmin';
        updateAdmin: 'updateDriversAdmin'; removeAdmin: 'deleteDriversAdmin';
        metadata: 'getDriversMetadata'; updateMetadata: 'updateDriversMetadata'; event: 'changeDriversEvent';
        archive: 'archiveDriversList'; restore: 'restoreDriversList'; automatic: never; search: 'searchDriversProfiles';
    };
    survey: {
        adminBaseline: never; addAdmin: never; updateAdmin: never; removeAdmin: never;
        metadata: 'getSurveyMetadata'; updateMetadata: 'updateSurveyMetadata'; event: never;
        archive: 'archiveSurvey'; restore: 'restoreSurvey'; automatic: never; search: never;
    };
    activity: {
        adminBaseline: 'getActivityAdminBaseline'; addAdmin: 'addActivityAdmin';
        updateAdmin: 'updateActivityAdmin'; removeAdmin: 'deleteActivityAdmin';
        metadata: 'getActivityMetadata'; updateMetadata: 'updateActivityMetadata'; event: 'updateActivityEvent';
        archive: 'archiveActivityPlan'; restore: 'restoreActivityPlan'; automatic: 'setActivityAutomaticArchival'; search: 'searchActivityProfiles';
    };
    event: {
        adminBaseline: 'getEventAdminBaseline'; addAdmin: 'addEventAdmin';
        updateAdmin: 'updateEventAdmin'; removeAdmin: 'deleteEventAdmin';
        metadata: never; updateMetadata: never; event: never;
        archive: 'archiveEvent'; restore: 'restoreEvent'; automatic: 'setEventAutomaticArchival'; search: 'searchEventProfiles';
    };
}

export type AdminApiOperation = AdminApiOperations[EntityType][keyof AdminApiOperations[EntityType]];
export type AdminApiResult<Operation extends AdminApiOperation> = ApiResponseBody<Operation, 200>;
export type AdminApiBody<Operation extends AdminApiOperation> = operations[Operation] extends {requestBody: {content: infer Content}}
    ? Content[keyof Content] : undefined;

/** Only already validated transport values cross into a named business hook. */
export interface AdminApiInput<Operation extends AdminApiOperation> {
    id: string;
    profileId: string;
    actor: SessionLike;
    body: AdminApiBody<Operation>;
    query: Request['query'];
    ifMatch?: string;
}

/** ETags are delivered after the same read/command that produced their wire data. */
export interface AdminApiRepresentation<Result> {
    data: Result;
    etag?: string;
}

export interface AdminApiRead<Operation extends AdminApiOperation> {
    operation: Operation;
    requireProfile: boolean;
    read(input: AdminApiInput<Operation>): Promise<AdminApiRepresentation<AdminApiResult<Operation>>>;
}

/** The original command determines when response bytes can still reject a write. */
export type AdminApiCommand<Operation extends AdminApiOperation> = {
    operation: Operation;
    requireProfile: boolean;
    normalize?: (body: unknown) => unknown;
} & ({
    delivery: 'result';
    execute(input: AdminApiInput<Operation>): Promise<AdminApiRepresentation<AdminApiResult<Operation>>>;
} | {
    delivery: 'controller';
    execute(input: AdminApiInput<Operation>, prepare: (result: AdminApiResult<Operation>) => void): Promise<{etag?: string} | void>;
} | {
    delivery: 'invariant';
    result: AdminApiResult<Operation>;
    execute(input: AdminApiInput<Operation>): Promise<unknown>;
});

/** Four features retain administrator management; Survey deliberately has none. */
export interface EntityAdminApiConfiguration<Type extends Exclude<EntityType, 'survey'>> {
    entityType: Type;
    parameter: string;
    baseline: AdminApiRead<AdminApiOperations[Type]['adminBaseline']>;
    add: AdminApiCommand<AdminApiOperations[Type]['addAdmin']>;
    update: AdminApiCommand<AdminApiOperations[Type]['updateAdmin']>;
    remove: AdminApiCommand<AdminApiOperations[Type]['removeAdmin']>;
}

/** Lifecycle route composition never changes a controller's scheduling support. */
export interface EntityArchiveApiConfiguration<Type extends EntityType> {
    entityType: Type;
    parameter: string;
    archive: AdminApiCommand<AdminApiOperations[Type]['archive']>;
    restore: AdminApiCommand<AdminApiOperations[Type]['restore']>;
    automatic?: AdminApiCommand<AdminApiOperations[Type]['automatic']>;
}

/** The historical property composer excludes Event's distinct metadata workflow. */
export interface EntityPropertyApiConfiguration<Type extends Exclude<EntityType, 'event'>> {
    entityType: Type;
    parameter: string;
    read: AdminApiRead<AdminApiOperations[Type]['metadata']>;
    update: AdminApiCommand<AdminApiOperations[Type]['updateMetadata']>;
    event?: AdminApiCommand<AdminApiOperations[Type]['event']>;
}

/** Discovery keeps feature scope and one shared per-IP budget without a global user list. */
export interface UserSearchApiConfiguration<Type extends Exclude<EntityType, 'survey'>> {
    entityType: Type;
    parameter: string;
    search: AdminApiRead<AdminApiOperations[Type]['search']>;
}
