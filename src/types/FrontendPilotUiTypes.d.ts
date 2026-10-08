import type {ComputedRef, Ref, ShallowRef} from 'vue';
import type {QueryClient} from '@tanstack/vue-query';
import type {i18n} from 'i18next';
import type {components, paths} from './api/v1';
import type {LocalizationContext, Locale, MessageKey} from './LocalizationTypes';
import type {FrontendPageCompletion, FrontendPilotBootstrap} from './FrontendPilotTypes';
import type {PilotApi} from '../frontend/app/api';

/** Browser-only collaborators must never enter the backend bootstrap declaration's import graph. */
export interface PilotRequestScope {
    context: string;
    epoch: number;
    locale: string;
    csrfToken: string;
}

export interface PilotRead<T> { data: T; etag: string | null; }

/** A confirmed command retries only its canonical navigation. The shared owner retains the
 * actor/route receipt across identity remounts without persisting inputs or replaying writes. */
export interface PilotConfirmedNavigation {
    pending: Ref<boolean>;
    target: ComputedRef<string | null>;
    fallbackTarget: ComputedRef<string | null>;
    navigate(destination: string, scope?: PilotRequestScope, origin?: string,
             notice?: components['schemas']['EntryNotice'] | null): Promise<boolean>;
    retry(): Promise<boolean>;
    retryFallback(): Promise<boolean>;
}

/** An entry owner supplies its existing API read and cache family; the shared navigation
 * helper retires outcomes when that route or identity is no longer current. */
export interface PilotPageEntrySource<T extends {entry: components['schemas']['PageEntryOutcome']}> {
    key: ComputedRef<readonly unknown[]>;
    enabled?: ComputedRef<boolean>;
    read(scope: PilotRequestScope, signal: AbortSignal): Promise<T>;
    initial?: T;
}

/** Optional form state joins the command owner's route, identity, update and unload guards.
 * The owner resets its draft only after successful navigation or a confirmed form result. */
export interface PilotCommandDraft {
    dirty(): boolean;
    busy?(): boolean;
    uncertain?(): boolean;
    unknownMessage: MessageKey;
}

/** Command confirmation and its following read are independent outcomes. The result returned
 * by run remains compatible with existing callers; editors use this state when adopting authority. */
export interface PilotCommandOutcome {
    confirmation: 'pending' | 'confirmed' | 'rejected' | 'unknown' | 'obsolete';
    refresh: 'not-requested' | 'pending' | 'succeeded' | 'failed';
}

/** Reuse the authored wire shapes while the caller owns its discovery endpoint and cache family.
 * These aliases are UI contracts, not a second definition of the event response. */
export type PilotEventPickerQuery = NonNullable<paths['/packing-lists/events']['get']['parameters']['query']>;
export type PilotEventPickerOption = components['schemas']['PackingEventOption'];
export type PilotEventPickerSelection = Pick<components['schemas']['PackingCurrentEvent'], 'id' | 'title'>
    & Partial<Pick<PilotEventPickerOption, 'archived'>>;
export interface PilotEventPickerSource {
    search(query: PilotEventPickerQuery, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PackingEventOptions']>;
    pageKey(context: string | undefined, locale: string, filters: string, parameters: PilotEventPickerQuery): readonly unknown[];
    filterKey(context: string | undefined, locale: string, filters: string): readonly unknown[];
}

/** Guards describe mounted drafts only. No recovery data or old release assets are persisted. */
export interface PilotUpdateCoordinator {
    available: Ref<boolean>;
    incompatible: Ref<boolean>;
    registerGuard(guard: () => boolean): () => void;
    commandStarted(): () => void;
    observe(deployment: components['schemas']['DeploymentView']): void;
    chunkFailed(): void;
    requestReload(): boolean;
    dispose(): void;
}

export interface PilotContext {
    api: PilotApi;
    bootstrap: FrontendPilotBootstrap;
    browser: boolean;
    queryClient: QueryClient;
    session: ShallowRef<components['schemas']['SessionView'] | null>;
    epoch: Ref<number>;
    locale: Ref<Locale>;
    visible: Ref<boolean>;
    hydrated: Ref<boolean>;
    ready: Ref<boolean>;
    notice: Ref<MessageKey | null>;
    pageNotice: Ref<components['schemas']['EntryNotice'] | null>;
    pageCompletion: Ref<FrontendPageCompletion | null>;
    personalLink: Ref<string | null>;
    messages: ComputedRef<LocalizationContext>;
    i18next: i18n;
    pageTitle: Ref<string>;
    updates: PilotUpdateCoordinator;
    capture(): PilotRequestScope;
    /** Initial native presentation belongs to one actor and one committed visit. */
    initialDocumentFor(url: string): FrontendPilotBootstrap | undefined;
    retireInitialDocument(destination: string): void;
    isCurrent(scope: PilotRequestScope, checkLocale?: boolean): boolean;
    refreshSession(): Promise<void>;
    acceptIdentity(result: components['schemas']['IdentityResult']): Promise<void>;
    registerIdentityGuard(guard: () => boolean): () => void;
    mayChangeIdentity(): boolean;
    changeLocale(locale: Locale): Promise<void>;
    invalidateIdentity(): void;
    start(): () => void;
}
