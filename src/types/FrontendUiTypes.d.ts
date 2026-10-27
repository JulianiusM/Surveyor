import type {ComponentPublicInstance, ComputedRef, Ref, ShallowRef} from 'vue';
import type {QueryClient} from '@tanstack/vue-query';
import type {i18n} from 'i18next';
import type {NavigationFailure, RouteLocationNormalized} from 'vue-router';
import type {components} from './api/v1';
import type {LocalizationContext, Locale, MessageKey, MessageParameters, RichMessageKey} from './LocalizationTypes';
import type {FrontendPageCompletion, FrontendBootstrap} from './FrontendTypes';
import type {FrontendApi} from '../frontend/app/api';
import type {HeadersOptions, Middleware} from 'openapi-fetch';

/** A controlled checkbox list renders values supplied by its feature owner.
 * Submitted spelling may differ from the domain value without another local draft. */
export interface FrontendCheckboxChoice<Value extends string = string> {
    value: Value;
    label: string;
    inputValue?: string;
}

/** Runtime interception preserves the generated client's typed public methods. */
export interface FrontendDispatchOptions extends Omit<RequestInit, 'body' | 'headers'> {
    params?: {header?: HeadersOptions; path?: object; query?: object};
    headers?: HeadersOptions;
    body?: unknown;
    bodySerializer?: (body: unknown, headers: Headers) => unknown;
    middleware?: Middleware[];
}

/** Saved-data review owns no draft, row matching or retry policy. */
export interface FrontendCommandReviewOptions {
    eligible: () => boolean;
    release: () => void;
    afterInspect?: (readSaved: () => Promise<unknown>) => unknown | Promise<unknown>;
    blocked?: () => boolean;
}

/** Loading geometry is public route presentation, never a projection of admission,
 * records or capabilities. Matching page and scoped reads consume this same shape. */
export interface FrontendLoadingSkeleton {
    variant?: 'lines' | 'form' | 'table' | 'cards' | 'article' | 'overview' | 'list-detail'
        | 'list-create' | 'packing-create' | 'survey' | 'survey-create' | 'activity' | 'activity-create'
        | 'event' | 'event-admin' | 'event-create' | 'identity'
        | 'login' | 'profile' | 'roster' | 'workflow' | 'guest';
    rows?: number;
    columns?: number;
    hideColumnOnMobile?: number;
    footer?: 'compact' | 'half' | 'two-thirds' | 'full';
    /** Match shared page headings without projecting any action authority. */
    balancedHeader?: boolean;
    headerActions?: boolean;
}

/** Entity and account headings share intrinsic desktop tracks and phone action rows. */
export interface FrontendPageHeadingProps {
    title: string;
    icon?: string;
}

declare module 'vue-router' {
    interface RouteMeta {
        /** The declared page family owns both SSR and cold client placeholders. */
        loadingSkeleton?: FrontendLoadingSkeleton;
        /** Only a matched Help renderer supplies article/anchor readiness. */
        helpPage?: boolean;
    }
}

/** Browser-only collaborators must never enter the backend bootstrap declaration's import graph. */
export type FrontendRequestScope = Pick<components['schemas']['SessionView'], 'context' | 'csrfToken'> & {
    epoch: number;
    locale: string;
};

/** Confirmation supplies only the resulting actor comparison and optional handoff.
 * The existing session reader remains authoritative for every private projection;
 * legacy workflow adapters must not manufacture a SessionView after committing work. */
export type FrontendIdentityConfirmation = Pick<components['schemas']['IdentityResult'], 'personalLink' | 'emailDelivery'>
    & Partial<Pick<components['schemas']['IdentityResult'], 'redirect'>> & {
    session: Pick<components['schemas']['SessionView'], 'context'>;
};

/** A control and its handler read the same derived operation state. Each owner
 * supplies its existing admission and locks; initialization is shared, while
 * drafts, query receipts and command outcomes remain with their current owners. */
export interface FrontendActionInputs {
    eligible?(): boolean;
    pending?(): boolean;
    blocked?(): boolean;
}

export interface FrontendActionState {
    available: ComputedRef<boolean>;
    disabled: ComputedRef<boolean>;
    pending: ComputedRef<boolean>;
    isAvailable(): boolean;
}

/** Native pending disabling can release focus on actions and retained fields.
 * Their shared presentation lifetime keeps no draft, request or authority state. */
export type FrontendPendingFocusControl = HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export interface FrontendPendingFocusSource {
    element: Readonly<Ref<FrontendPendingFocusControl | null>>;
    pending: Readonly<Ref<boolean>>;
    isAvailable(): boolean;
}

/** A distinct field keeps its existing directives and attributes while
 * explicitly supplying its actual control to the common focus lifetime. */
export interface FrontendFormFieldControlSlot {
    controlRef(control: Element | ComponentPublicInstance | null): void;
}

export interface FrontendRead<T> { data: T; etag: string | null; }

/** Fetch decoding remains untrusted until the existing transport admits it. */
export interface FrontendDecodedResponse {
    data?: unknown;
    error?: unknown;
    response: Response;
    signal?: AbortSignal;
}

/** A required authority family must perform a read. A separately confirmed owner
 * may also refresh optional dependents; their absence supplies no new authority. */
export interface FrontendQueryRefreshOptions {
    allowEmpty?: boolean;
}

/** Query metadata describes the owning observer's current dispatch eligibility.
 * It contains no DTO, grants or draft fields; the cache owner checks each actual
 * observer independently when a confirmed command names a read dependency. */
export interface FrontendQueryReadPolicy {
    mayRead(key: readonly unknown[]): boolean;
}

/** Automatic terminal suspension belongs to one mounted key visit. A fresh visit
 * still obtains GET admission; explicit reads consult the same observer's eligibility. */
export interface FrontendQueryAdmission {
    enabled: ComputedRef<boolean>;
    meta: {surveyorRead: FrontendQueryReadPolicy};
}

/** Features supply their own authorized binary endpoint; the shared image owner
 * manages only actor/version lifetime, cancellation and object URL disposal. */
export type FrontendImageRead = (id: string, scope: FrontendRequestScope, signal: AbortSignal) => Promise<Blob>;

/** Ordinary successful resource reads can recover a missing authorized image even when
 * its version is unchanged. Healthy URLs and in-flight reads remain owned by the helper. */
export interface FrontendAuthorizedImage {
    source: Ref<string | null>;
    refresh(): Promise<void>;
}

/** Recovery reads never replay a write. Their owner checks the captured actor, document
 * and mounted lifetime before starting a resource follow-up or publishing feedback. */
export type FrontendRecoveryRead = (scope: FrontendRequestScope, isCurrent: () => boolean) => Promise<unknown>;

/** An operation may project a validated known problem onto its presentation.
 * Future safe details and unrelated API messages retain their existing fallback. */
export type FrontendProblemPresentation = (problem: components['schemas']['Problem']) => MessageKey | undefined;

/** The feature owns its generated snapshot and wire values. Shared reconciliation needs
 * only the allowed field names and their values, never a particular feature's DTO. */
export type FrontendMetadataField<TValues extends object> = Extract<keyof TValues, string>;
export interface FrontendMetadataSnapshot<TValues extends object> {
    values: TValues;
    editableFields: FrontendMetadataField<TValues>[];
}

/** Optional field normalization defines comparison and sparse PATCH meaning together.
 * Omitted policies use identity comparison; each supplied policy retains that field's type. */
export type FrontendMetadataFieldPolicy<TValues extends object> = {
    readonly [TField in keyof TValues]?: (value: TValues[TField]) => TValues[TField];
};

/** A confirmed command retries its selected eligible reads and canonical navigation. The shared owner retains the
 * actor/route receipt across identity remounts without persisting inputs or replaying writes. */
export interface FrontendConfirmedNavigation {
    pending: Ref<boolean>;
    /** Existing shared receipt capacity, not another command/permission lock. */
    available: ComputedRef<boolean>;
    retryAction: FrontendActionState;
    fallbackRetryAction: FrontendActionState;
    retryAt: ComputedRef<number | undefined>;
    fallbackRetryAt: ComputedRef<number | undefined>;
    target: ComputedRef<string | null>;
    notice: ComputedRef<components['schemas']['EntryNotice'] | null>;
    fallbackTarget: ComputedRef<string | null>;
    /** The shell observes the existing receipt across every mounted origin.
     * Recovery repeats reads/navigation only; it never repeats the command. */
    recoveryTarget: ComputedRef<string | null>;
    recoveryAction: FrontendActionState;
    recoveryRetryAt: ComputedRef<number | undefined>;
    recoveryReadError: ComputedRef<Error | null>;
    navigate(destination: string, scope?: FrontendRequestScope, origin?: string,
             notice?: components['schemas']['EntryNotice'] | null, refreshSession?: boolean,
             readFamilies?: readonly (readonly unknown[])[]): Promise<boolean>;
    retry(): Promise<boolean>;
    retryFallback(): Promise<boolean>;
    retryRecovery(): Promise<boolean>;
}

export type FrontendPageEntryDenial = Extract<components['schemas']['PageEntryOutcome'], {kind: 'denied'}>;

/** An entry owner supplies its existing API read and language-independent admission family.
 * The shared owner scopes routes/actors/locales and retires superseded admission snapshots.
 * Feature policy selects any additional projections invalidated by an authoritative denial.
 * Only the confirmed status crosses that boundary; a typed entry and a validated read
 * failure retain their different presentation owners instead of forging a wire outcome. */
export interface FrontendPageEntrySource<T extends {entry: components['schemas']['PageEntryOutcome']}> {
    key: ComputedRef<readonly unknown[]>;
    enabled?: ComputedRef<boolean>;
    read(scope: FrontendRequestScope, signal: AbortSignal): Promise<T>;
    initial?: T;
    onDenied?(entry: {readonly status: number}, scope: FrontendRequestScope): Promise<void>;
}

/** Optional form state joins the command owner's route, identity, update and unload guards.
 * The owner resets its draft only after successful navigation or a confirmed form result. */
export interface FrontendCommandDraft {
    dirty(): boolean;
    busy?(): boolean;
    uncertain?(): boolean;
    unknownMessage: MessageKey;
    problemKey?: FrontendProblemPresentation;
    /** Recovery may establish session admission itself. The owner supplies its
     * actual read deadline without applying a resource-read barrier to bootstrap. */
    recoveryEligible?(): boolean;
}

/** A retained command exposes status only after its private editor retires. The root
 * departure owner aggregates this state without retaining submitted fields or authority. */
export interface FrontendDraftState {
    busy: boolean;
    dirty: boolean;
    unknownMessage: MessageKey | null;
}

/** Command confirmation and its following read are independent outcomes. The result returned
 * by run remains compatible with existing callers; editors use this state when adopting authority. */
export interface FrontendCommandOutcome {
    confirmation: 'pending' | 'confirmed' | 'rejected' | 'unknown' | 'obsolete';
    refresh: 'not-requested' | 'pending' | 'succeeded' | 'failed';
}

/** Shared notices accept complete catalog messages without required scalar values
 * or authored nodes; features cannot leave unresolved placeholders in feedback. */
export type FrontendPlainMessageKey = {
    [TKey in MessageKey]: TKey extends RichMessageKey ? never : {} extends MessageParameters[TKey] ? TKey : never;
}[MessageKey];

/** Features select successful feedback through the common notice lifecycle. */
export interface FrontendCommandFeedback {
    /** Null keeps successful maintenance silent; omission retains the ordinary saved notice. */
    success?: FrontendPlainMessageKey | null;
    /** Explicit known no-op rejections may be information. Unknown failures,
     * unrelated server codes and command confirmation retain their own semantics. */
    rejectionInformation?: Partial<Record<components['schemas']['Problem']['code'], FrontendPlainMessageKey>>;
}

/** Reuse neutral authored wire shapes while the caller owns its discovery endpoint,
 * authorization and cache family. Selectors do not depend on a particular feature path. */
export type FrontendEventPickerQuery = components['schemas']['EventPickerQuery'];
export type FrontendEventPickerOption = components['schemas']['EventPickerOption'];
/** A current relationship can expose its ID without a readable title. Preserve
 * that nullable display projection; discovery choices still have required titles. */
export type FrontendEventPickerSelection = Pick<FrontendEventPickerOption, 'id'>
    & {title: FrontendEventPickerOption['title'] | null}
    & Partial<Pick<FrontendEventPickerOption, 'archived'>>;
export interface FrontendEventPickerSource {
    search(query: FrontendEventPickerQuery, scope: FrontendRequestScope, signal?: AbortSignal): Promise<components['schemas']['EventPickerOptions']>;
    pageKey(context: string | null | undefined, locale: string, filters: string, parameters: FrontendEventPickerQuery): readonly unknown[];
    filterKey(context: string | null | undefined, locale: string, filters: string): readonly unknown[];
}

/** The card's host supplies feature operations and destination behavior. Cards
 * consume this bounded policy without importing another feature's API or choosing
 * an endpoint from its entity type; explicit document links retain ordinary navigation. */
export interface FrontendEntityCardInteraction {
    clientNavigation: boolean;
    lifecycle?: boolean;
    readHeader?: FrontendImageRead;
    duplicateUrl?: string;
    /** The owning collection identifies this Delete independently of sibling locks. */
    removePending?: boolean;
    /** Only the selected card's menu gesture presents the shared command's progress. */
    menuPending?: boolean;
    /** A retained confirmed destination pauses only another permanent deletion. */
    removeDisabled?: boolean;
    /** Optional collection freshness policy pauses mutations while preserving navigation. */
    writesDisabled?: boolean;
}

/** A parent collection derives membership aggregates from this admitted query.
 * The receipt carries lifetime/key evidence only; the authorized DTO stays in QueryClient. */
export interface FrontendOverviewCountRead {
    scope: FrontendRequestScope;
    key: readonly unknown[];
    updatedAt: number;
}

/** The existing region read owner can present its controls in the collection's
 * accordion heading. Collapse geometry does not change its admission/lifetime. */
export interface FrontendOverviewRegionProps {
    collection: components['schemas']['OverviewRegion']['collection'];
    region: components['schemas']['OverviewRegion']['region'];
    active?: boolean;
    collapseId?: string;
}

/** Guards cover initial DOM drafts, mounted drafts and unresolved status after an editor retires.
 * Only the automatic-attempt marker is persisted; form values/files and old assets are not. */
export interface FrontendUpdateCoordinator {
    available: Ref<boolean>;
    incompatible: Ref<boolean>;
    registerGuard(guard: () => boolean): () => void;
    commandStarted(): () => void;
    observe(deployment: components['schemas']['DeploymentView']): void;
    chunkFailed(): void;
    requestReload(): boolean;
    /** Deliberate recovery can retry startup or a consumed marker; live guards always apply. */
    requestRecoveryReload(): boolean;
    dispose(): void;
}

export interface FrontendContext {
    api: FrontendApi;
    bootstrap: FrontendBootstrap;
    browser: boolean;
    queryClient: QueryClient;
    session: ShallowRef<components['schemas']['SessionView'] | null>;
    epoch: Ref<number>;
    locale: Ref<Locale>;
    visible: Ref<boolean>;
    hydrated: Ref<boolean>;
    /** Initial features may mount before initialization succeeds; this releases
     * only their skeleton, never JS control/read readiness or request authority. */
    initialContentReady: Ref<boolean>;
    ready: Ref<boolean>;
    /** Session revalidation pauses new reads without unmounting admitted presentation
     * or drafts. Only a current successful bootstrap restores this admission. */
    readsReady: Readonly<Ref<boolean>>;
    /** The existing bootstrap owner keeps one current read receipt. Actor retirement
     * clears its error, deadline and successful timestamp together. */
    sessionRead: Readonly<ShallowRef<{error: Error | null; updatedAt?: number; pending: boolean}>>;
    notice: Ref<MessageKey | null>;
    pageNotice: Ref<components['schemas']['EntryNotice'] | null>;
    pageCompletion: Ref<FrontendPageCompletion | null>;
    personalLink: Ref<string | null>;
    messages: ComputedRef<LocalizationContext>;
    i18next: i18n;
    pageTitle: Ref<string>;
    updates: FrontendUpdateCoordinator;
    capture(): FrontendRequestScope;
    /** Initial presentation belongs to one actor and one committed visit. */
    initialDocumentFor(url: string): FrontendBootstrap | undefined;
    retireInitialDocument(destination?: string): void;
    /** Mounted admission contributes presentation only, without retaining its query payload.
     * Registration belongs to the captured actor and the source's current document visit. */
    registerPageOutcome(route: Readonly<Ref<string>>, isStatic: () => boolean): () => void;
    hasStaticPageOutcome(route: Pick<RouteLocationNormalized, 'meta' | 'fullPath'>): boolean;
    requiresClientInitialization(route: Pick<RouteLocationNormalized, 'meta' | 'fullPath'>): boolean;
    isCurrent(scope: FrontendRequestScope, checkLocale?: boolean): boolean;
    /** Check dispatch admission separately from a previously captured response's lifetime. */
    mayRead(scope?: FrontendRequestScope, checkLocale?: boolean): boolean;
    /** Automatic observer resume also respects its current terminal read rejection. */
    mayObserve(key: readonly unknown[], firstRead?: boolean): boolean;
    refreshSession(fresh?: boolean): Promise<void>;
    acceptIdentity(result: FrontendIdentityConfirmation): Promise<void>;
    registerIdentityGuard(guard: () => boolean): () => void;
    mayChangeIdentity(): boolean;
    changeLocale(locale: Locale): Promise<void>;
    invalidateIdentity(): void;
    start(): () => void;
}

/** Each consumer selects which navigation changes pause its work. Feature-specific
 * read retirement, locale synchronization and feedback remain explicit callbacks. */
export interface FrontendPageNavigationOptions {
    scope?: 'all' | 'document' | 'path';
    started?(to: RouteLocationNormalized, from: RouteLocationNormalized): void;
    finished?(to: RouteLocationNormalized, from?: RouteLocationNormalized, failure?: NavigationFailure | void): void;
}

/** Observe lazy delivery before Router commits, without clearing a newer target
 * when an older navigation is cancelled or fails. The caller owns disposal. */
export interface FrontendPageNavigation {
    destination: Readonly<ShallowRef<RouteLocationNormalized | undefined>>;
    pending(): boolean;
    dispose(): void;
}

/** A mounted page exposes only its existing presentation readiness. No query,
 * payload, authority or saved scroll position belongs to this handoff. */
export interface FrontendPageReadinessSource {
    destination: Readonly<Ref<string>>;
    ready: Readonly<Ref<boolean>>;
}

/** Router waits for readable content before restoring history or an anchor.
 * Superseded visits and application disposal release pending work without scroll. */
export interface FrontendPageReadiness {
    register(source: FrontendPageReadinessSource): () => void;
    wait(destination: RouteLocationNormalized): Promise<boolean>;
    dispose(): void;
}
