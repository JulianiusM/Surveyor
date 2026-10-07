import type {ComputedRef, Ref, ShallowRef} from 'vue';
import type {QueryClient} from '@tanstack/vue-query';
import type {components} from './api/v1';
import type {LocalizationContext, Locale, MessageKey} from './LocalizationTypes';
import type {FrontendPilotBootstrap} from './FrontendPilotTypes';
import type {PilotApi} from '../frontend/app/api';

/** Browser-only collaborators must never enter the backend bootstrap declaration's import graph. */
export interface PilotRequestScope {
    context: string;
    epoch: number;
    locale: string;
    csrfToken: string;
}

export interface PilotRead<T> { data: T; etag: string | null; }

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
    personalLink: Ref<string | null>;
    messages: ComputedRef<LocalizationContext>;
    capture(): PilotRequestScope;
    isCurrent(scope: PilotRequestScope, checkLocale?: boolean): boolean;
    refreshSession(): Promise<void>;
    acceptIdentity(result: components['schemas']['IdentityResult']): Promise<void>;
    registerIdentityGuard(guard: () => boolean): () => void;
    mayChangeIdentity(): boolean;
    changeLocale(locale: Locale): Promise<void>;
    invalidateIdentity(): void;
    start(): () => void;
}
