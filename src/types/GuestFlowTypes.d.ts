import type {Request, Response} from 'express';
import type {EntityManager} from 'typeorm';
import type {components} from './api/v1';
import type {ApiOperationId, PreparedApiJsonResponse} from './ApiTransportTypes';
import type {EventLinkOption} from './EventTypes';
import type {FrontendBootstrap} from './FrontendTypes';
import type {SessionLike} from './PermissionTypes';
import type {EntityBase, EntityViewAdmission} from './UserTypes';
import type {EntityType} from './UtilTypes';

/** The declared operation fixes the wire contract before a shared handler runs. */
export interface GuestFlowResponse<Result> {
    operation: ApiOperationId;
    prepare(request: Request, result: Result): PreparedApiJsonResponse;
    send(request: Request, response: Response, result: Result, etag?: string): void;
}

/** Feature contracts remain distinct while their HTTP workflow has one owner. */
export interface GuestFlowSchemas {
    packing: {
        context: components['schemas']['EntityCreationContext'];
        input: components['schemas']['PackingCreateInput'];
        created: components['schemas']['EntityCreationResult'];
        duplicate: components['schemas']['PackingDuplicate'];
        detail: components['schemas']['PackingListView'];
    };
    drivers: {
        context: components['schemas']['DriversCreateContext'];
        input: components['schemas']['DriversCreateInput'];
        created: components['schemas']['DriversCreated'];
        duplicate: components['schemas']['DriversDuplicate'];
        detail: components['schemas']['DriversListView'];
    };
    survey: {
        context: components['schemas']['SurveyCreateContext'];
        input: components['schemas']['SurveyCreateInput'];
        created: components['schemas']['SurveyCreated'];
        duplicate: components['schemas']['SurveyDuplicate'];
        detail: components['schemas']['SurveyView'];
    };
    activity: {
        context: components['schemas']['ActivityCreateContext'];
        input: components['schemas']['ActivityCreateInput'];
        created: components['schemas']['ActivityCreated'];
        duplicate: components['schemas']['ActivityDuplicate'];
        detail: components['schemas']['ActivityView'];
    };
    event: {
        context: components['schemas']['EventCreateContext'];
        input: components['schemas']['EventCreateInput'];
        created: components['schemas']['EventCreated'];
        duplicate: components['schemas']['EventDuplicate'];
        detail: components['schemas']['EventView'];
    };
}

/** Page entry never discloses protected detail rows or mutates identity. */
export interface GuestFlowResourceEntry {
    entry: components['schemas']['PageEntryOutcome'];
    guest: components['schemas']['GuestEntry'] | null;
}

/** An initial Event query is a permitted form seed, never a persisted association. */
export interface GuestFlowCreateEntry<Context> {
    entry: components['schemas']['PageEntryOutcome'];
    context: Context | null;
    selectedEvent?: components['schemas']['EventPickerOption'] | null;
}

/** Existing controllers notify the adapter at their actual persistence boundary. */
export interface GuestFlowCreationLifecycle<Type extends EntityType> {
    prepare(result: GuestFlowSchemas[Type]['created']): void;
    retainImage(): void;
}

/** One entity's hooks contain domain values, never another complete HTTP handler. */
export interface GuestFlowConfig<Type extends EntityType, Root extends EntityBase> {
    entityType: Type;
    parameter: string;
    apiPath: string;
    loadRoot(id: string): Promise<Root | null>;
    withRoot<Result>(id: string, operation: (root: Root | null, manager?: EntityManager) => Promise<Result>): Promise<Result>;
    pageAdmission(root: Root, actor: SessionLike, manager?: EntityManager): Promise<EntityViewAdmission>;
    adminAdmission?(root: Root, actor: SessionLike, manager?: EntityManager): Promise<boolean>;
    detailAddress: 'stored' | 'requested';
    guestAddress: 'stored' | 'requested';
    profiles: {duplicate: boolean; header: boolean};
    formContext(): GuestFlowSchemas[Type]['context'];
    readCreateContext?(actor: SessionLike): GuestFlowSchemas[Type]['context'];
    requireCreation(actor: SessionLike): void;
    selectEvent?(input: unknown, actor: SessionLike): Promise<EventLinkOption | null>;
    searchEvents?(query: unknown, actor: SessionLike): Promise<components['schemas']['EventPickerOptions']>;
    create(input: GuestFlowSchemas[Type]['input'], file: Express.Multer.File | undefined, actor: SessionLike,
        lifecycle: GuestFlowCreationLifecycle<Type>): Promise<GuestFlowSchemas[Type]['created']>;
    creation: {
        imageOwnership: 'success' | 'controller-entry' | 'controller-notification';
        receipt: 'after-success' | 'controller';
        location: boolean;
    };
    duplicate(id: string, actor: SessionLike, eventId?: unknown): Promise<GuestFlowSchemas[Type]['duplicate']>;
    detail(id: string, actor: SessionLike, view?: 'detail' | 'admin', query?: Readonly<Record<string, unknown>>): Promise<{data: GuestFlowSchemas[Type]['detail']; etag?: string}>;
    header(id: string, actor: SessionLike): Promise<string>;
    remove(id: string, actor: SessionLike, prepare: (result: components['schemas']['MutationResult']) => void): Promise<components['schemas']['MutationResult']>;
    deletion: {profile: boolean; receipt: 'before-command' | 'controller' | 'after-success'};
    operations: {
        createEntry: GuestFlowResponse<GuestFlowCreateEntry<GuestFlowSchemas[Type]['context']>>;
        resourceEntry: GuestFlowResponse<GuestFlowResourceEntry>;
        createContext?: GuestFlowResponse<GuestFlowSchemas[Type]['context']>;
        events?: GuestFlowResponse<components['schemas']['EventPickerOptions']>;
        create: GuestFlowResponse<GuestFlowSchemas[Type]['created']>;
        duplicate: GuestFlowResponse<GuestFlowSchemas[Type]['duplicate']>;
        detail: GuestFlowResponse<GuestFlowSchemas[Type]['detail']>;
        remove: GuestFlowResponse<components['schemas']['MutationResult']>;
        guest: GuestFlowResponse<components['schemas']['GuestEntry']>;
        registerGuest: 'registerPackingGuest' | 'registerDriversGuest' | 'registerSurveyGuest' | 'registerActivityGuest' | 'registerEventGuest';
        header: 'getPackingHeader' | 'getDriversHeader' | 'getSurveyHeader' | 'getActivityHeader' | 'getEventHeader';
    };
    document: {
        preload: boolean;
        admin: boolean;
        duplicatePageEntry: boolean;
        seedCreate(state: FrontendBootstrap, result: GuestFlowCreateEntry<GuestFlowSchemas[Type]['context']>): void;
        seedDuplicate(state: FrontendBootstrap, result: GuestFlowSchemas[Type]['duplicate']): void;
        seedResource?(state: FrontendBootstrap, result: GuestFlowResourceEntry): void;
        duplicateError?(error: unknown): unknown;
    };
}

/** Both actual route adapters consume this same configured flow and read policy. */
export interface GuestFlow<Type extends EntityType, Root extends EntityBase> {
    config: GuestFlowConfig<Type, Root>;
    readCreateEntry(actor: SessionLike, returnTo?: unknown, eventId?: unknown): Promise<GuestFlowCreateEntry<GuestFlowSchemas[Type]['context']>>;
    readResourceEntry(id: string, view: 'detail' | 'guest' | 'admin', actor: SessionLike, regToken?: string): Promise<GuestFlowResourceEntry>;
    readGuestEntry(id: string): Promise<components['schemas']['GuestEntry']>;
}




export type GuestRegistrationNags = {
    accountRecommendationTitle?: string;
    accountRecommendation?: string;
    linkWarning: string;
    emailRecommendation: string;
    submitConfirmation?: string;
};
