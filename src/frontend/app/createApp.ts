import {createSSRApp, nextTick} from 'vue';
import {createMemoryHistory, createRouter, createWebHistory} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {FrontendPilotBootstrap} from '../../types/FrontendPilotTypes';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';
import {createPilotContext, observeInitialDocument, pilotContextKey} from './context';
import App from './App.vue';
import {mountPreservingDrafts} from './mountPreservingDrafts';

// Route chunks own their feature validators and views. The initial shell remains
// small, and a later feature migration does not enlarge every visitor's entry bundle.
const PackingEntry = () => import('../features/packing/PackingEntry.vue');
const IdentityPage = () => import('../features/identity/IdentityPage.vue');
const PackingCreatePage = () => import('../features/packing/PackingCreatePage.vue');
const OverviewPage = () => import('../features/overview/OverviewPage.vue');
const HelpPage = () => import('../features/help/HelpPage.vue');

// One route declaration drives the initial skeleton for every interactive page.
// Readable admitted errors/completions are classified by the shared context owner.
const javascriptPage = {javascriptRequired: true};

/** Browsers report retired module URLs differently. Recognize their load failures
 * specifically, so an ordinary component bug does not suggest a release reload. */
function isRouteModuleLoadFailure(error: unknown): boolean {
    return /(?:Failed to fetch|error loading) dynamically imported module|Importing a module script failed|Loading chunk|Failed to load module script/i.test(String(error));
}

/** Server and browser construct the same component tree with separate application-owned state. */
export function createPilotApp(bootstrap: FrontendPilotBootstrap, browser: boolean,
                               initialReloadGuard?: () => boolean) {
    const context = createPilotContext(bootstrap, browser);
    // Register initial DOM protection before Router can start a failing import.
    // The browser entry releases it only after mounted draft restoration finishes.
    const releaseInitialReloadGuard = initialReloadGuard
        ? context.updates.registerGuard(initialReloadGuard) : () => {};
    const app = createSSRApp(App);
    // TODO (docs/frontend-migration/FRONTEND_PILOT.md): Add the remaining native feature/account routes in
    // their migration increments before default-route cutover. This route table covers
    // help, packing and their necessary existing identity journeys, not the complete app.
    const router = createRouter({
        history: browser ? createWebHistory() : createMemoryHistory(),
        routes: [
            {path: '/frontend-pilot', component: OverviewPage, meta: {javascriptRequired: true}},
            {path: '/frontend-pilot/packing/create', component: PackingCreatePage, meta: {javascriptRequired: true}},
            {path: '/frontend-pilot/packing/:listId/duplicate', component: PackingCreatePage, meta: {javascriptRequired: true}},
            {path: '/frontend-pilot/packing/:listId/guest', component: PackingEntry, meta: {...javascriptPage}},
            {path: '/frontend-pilot/packing/:listId', component: PackingEntry, meta: {javascriptRequired: true}},
            {path: '/frontend-pilot/users/login', component: IdentityPage, meta: {...javascriptPage, identityMode: 'login'}},
            {path: '/frontend-pilot/users/register', component: IdentityPage, meta: {...javascriptPage, identityMode: 'register'}},
            {path: '/frontend-pilot/users/oidc/login', component: IdentityPage, meta: {...javascriptPage, identityMode: 'oidc'}},
            {path: '/frontend-pilot/users/forgot-password', component: IdentityPage, meta: {...javascriptPage, identityMode: 'forgot'}},
            {path: '/frontend-pilot/users/reset-password/:token', component: IdentityPage, meta: {...javascriptPage, identityMode: 'reset'}},
            {path: '/frontend-pilot/users/activate/:token', component: IdentityPage, meta: {...javascriptPage, identityMode: 'activate'}},
            {path: '/frontend-pilot/guest/:guestId/login/:token', component: IdentityPage, meta: {...javascriptPage, identityMode: 'guest-login'}},
            {path: '/frontend-pilot/guest/recovery', component: IdentityPage, meta: {...javascriptPage, identityMode: 'recovery'}},
            {path: '/frontend-pilot/help', component: HelpPage},
            {path: '/frontend-pilot/help/:doc', component: HelpPage},
        ],
        /** Browser history owns saved positions; independently loaded Overview
         * regions own query-transition focus/scroll. Ordinary fragments and new
         * documents retain Router's explicit target/top behavior. */
        scrollBehavior(to, from, saved) {
            if (saved) return saved;
            // Overview's independent regions restore focus/scroll after their authorized
            // read renders. A query transition must not jump to the top before that result.
            if (to.path === '/frontend-pilot' && from.path === to.path
                && frontendDocumentUrl(to.fullPath) !== frontendDocumentUrl(from.fullPath)) return false;
            if (to.hash) return {el: to.hash};
            return {top: 0};
        },
    });
    observeInitialDocument(context, router);
    app.provide(pilotContextKey, context);
    app.use(I18NextVue, {i18next: context.i18next});
    app.use(VueQueryPlugin, {queryClient: context.queryClient});
    app.use(router);
    router.onError(error => {
        // An open document may request a route chunk retired by a release replacement.
        // Preserve its mounted edits; the update owner decides when a reload is safe.
        if (isRouteModuleLoadFailure(error)) {
            context.updates.chunkFailed();
        }
    });
    return {app, router, context, releaseInitialReloadGuard};
}

/** Hydrate the matching shell, then mount initial features before declaring JS
 * controls/reads ready. Vue's production error boundary can consume lifecycle
 * failures instead of rejecting mount/nextTick, so capture that bounded startup
 * interval explicitly. It covers errors Vue reports through the initial mount
 * and first readiness render, not arbitrary later asynchronous feature work;
 * later feature/API failures keep their existing owners. */
export async function initializePilotApp(application: ReturnType<typeof createPilotApp>, container: Element): Promise<() => void> {
    const {app, context} = application;
    const previousErrorHandler = app.config.errorHandler;
    let failed = false;
    let initializationError: unknown;

    /** Retain the actual startup error without clearing drafts or replaying work. */
    function captureInitializationError(error: unknown): void {
        if (!failed) initializationError = error;
        failed = true;
    }

    app.config.errorHandler = captureInitializationError;
    try {
        // Static Help edits restore on their original controls. Interactive content
        // still matches SSR's skeleton, with no early feature fields to capture.
        await mountPreservingDrafts(app, container);
        context.initialContentReady.value = true;
        await nextTick();
        if (failed) throw initializationError;

        // Only a successfully mounted initial tree enables controls and scoped
        // reads. Include that first reactive render in the same error boundary.
        const stop = context.start();
        await nextTick();
        if (failed) throw initializationError;
        return stop;
    } catch (error) {
        // Keep partial owners and their command/draft guards alive. The document
        // entry surfaces recovery and hides incomplete interactive content.
        context.hydrated.value = false;
        throw error;
    } finally {
        app.config.errorHandler = previousErrorHandler;
    }
}
