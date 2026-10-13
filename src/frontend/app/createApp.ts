import {createSSRApp} from 'vue';
import {createMemoryHistory, createRouter, createWebHistory} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {FrontendPilotBootstrap} from '../../types/FrontendPilotTypes';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';
import {createPilotContext, observeInitialDocument, pilotContextKey} from './context';
import App from './App.vue';

// Route chunks own their feature validators and views. The initial shell remains
// small, and a later feature migration does not enlarge every visitor's entry bundle.
const PackingEntry = () => import('../features/packing/PackingEntry.vue');
const IdentityPage = () => import('../features/identity/IdentityPage.vue');
const PackingCreatePage = () => import('../features/packing/PackingCreatePage.vue');
const OverviewPage = () => import('../features/overview/OverviewPage.vue');
const HelpPage = () => import('../features/help/HelpPage.vue');

// One delivery declaration drives the message-only fallback for interactive
// pages. Existing server POST contracts remain independent of that presentation.
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
            // Native transition failures render the same localized message component and
            // hydrate at their actual POST URL instead of falling through to a Pug error page.
            {path: '/frontend-pilot/users/profile', component: IdentityPage, meta: {identityMode: 'error'}},
            {path: '/frontend-pilot/users/logout', component: IdentityPage, meta: {identityMode: 'error'}},
            {path: '/frontend-pilot/users/register', component: IdentityPage, meta: {...javascriptPage, identityMode: 'register'}},
            {path: '/frontend-pilot/users/oidc/login', component: IdentityPage, meta: {identityMode: 'oidc'}},
            {path: '/frontend-pilot/users/forgot-password', component: IdentityPage, meta: {...javascriptPage, identityMode: 'forgot'}},
            {path: '/frontend-pilot/users/reset-password/:token', component: IdentityPage, meta: {...javascriptPage, identityMode: 'reset'}},
            {path: '/frontend-pilot/users/activate/:token', component: IdentityPage, meta: {...javascriptPage, identityMode: 'activate'}},
            {path: '/frontend-pilot/guest/:guestId/login/:token', component: IdentityPage, meta: {...javascriptPage, identityMode: 'guest-login'}},
            {path: '/frontend-pilot/guest/recovery', component: IdentityPage, meta: {identityMode: 'recovery'}},
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
