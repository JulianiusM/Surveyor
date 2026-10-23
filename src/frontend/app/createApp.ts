import {createSSRApp, nextTick} from 'vue';
import {createMemoryHistory, createRouter, createWebHistory, type RouteRecordRaw} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {FrontendPilotBootstrap} from '../../types/FrontendPilotTypes';
import type {PilotLoadingSkeleton} from '../../types/FrontendPilotUiTypes';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';
import {resolvePilotHelpQuery} from '../../modules/lib/helpNavigation';
import {createPilotContext, observeInitialDocument, pilotContextKey} from './context';
import App from './App.vue';
// The shell also renders admitted common outcomes, so this shared view is
// already part of the entry bundle rather than an independent route chunk.
import CommonPage from '../features/common/CommonPage.vue';
import {mountPreservingDrafts} from './mountPreservingDrafts';
import {createPageReadiness, pageReadinessKey} from '../composables/pageNavigation';

// Route chunks own their feature validators and views. The initial shell remains
// small, and a later feature migration does not enlarge every visitor's entry bundle.
const PackingEntry = () => import('../features/packing/PackingEntry.vue');
const IdentityPage = () => import('../features/identity/IdentityPage.vue');
const PackingCreatePage = () => import('../features/packing/PackingCreatePage.vue');
const OverviewPage = () => import('../features/overview/OverviewPage.vue');
const HelpPage = () => import('../features/help/HelpPage.vue');
const ProfileAdministrationPage = () => import('../features/identity/ProfileAdministrationPage.vue');
const ProfileWorkflowPage = () => import('../features/identity/ProfileWorkflowPage.vue');
const LandingPage = () => import('../features/common/LandingPage.vue');
const EventEntry = () => import('../features/event/EventEntry.vue');
const EventCreatePage = () => import('../features/event/EventCreatePage.vue');
const DriversEntry = () => import('../features/drivers/DriversEntry.vue');
const DriversCreatePage = () => import('../features/drivers/DriversCreatePage.vue');
const SurveyEntry = () => import('../features/surveys/SurveyEntry.vue');
const SurveyCreatePage = () => import('../features/surveys/SurveyCreatePage.vue');
const ActivityEntry = () => import('../features/activity/ActivityEntry.vue');
const ActivityCreatePage = () => import('../features/activity/ActivityCreatePage.vue');

// One route declaration drives the initial skeleton for every interactive page.
// Readable admitted errors/completions are classified by the shared context owner.
function javascriptPage(loadingSkeleton: PilotLoadingSkeleton) {
    return {javascriptRequired: true, loadingSkeleton};
}

// Presentation declarations contain only static geometry. Matching cold reads
// consume this same metadata after initialization; they cannot grant admission.
const overviewPage = javascriptPage({variant: 'overview'});
const packingPage = javascriptPage({variant: 'list-detail', rows: 4, columns: 6});
const driversPage = javascriptPage({variant: 'list-detail', rows: 4, columns: 5});
const surveyPage = javascriptPage({variant: 'survey', rows: 2, columns: 4});
const surveyCreatePage = javascriptPage({variant: 'survey-create'});
const activityPage = javascriptPage({variant: 'activity', rows: 2, columns: 7});
const activityCreatePage = javascriptPage({variant: 'activity-create', footer: 'full'});
const listCreatePage = javascriptPage({variant: 'list-create'});
const packingCreatePage = javascriptPage({variant: 'packing-create'});
const eventPage = javascriptPage({variant: 'event'});
const eventAdminPage = javascriptPage({variant: 'event-admin'});
const eventCreatePage = javascriptPage({variant: 'event-create'});
const guestPage = javascriptPage({variant: 'guest', rows: 2});
const profilePage = javascriptPage({variant: 'profile', rows: 1});
const profileRosterPage = javascriptPage({variant: 'roster', rows: 3});
const workflowPage = javascriptPage({variant: 'workflow'});
const loginPage = javascriptPage({variant: 'login', rows: 2});
const registerPage = javascriptPage({variant: 'identity', rows: 5});
const identityMessagePage = javascriptPage({variant: 'workflow'});
const forgotPage = javascriptPage({variant: 'identity', rows: 1, footer: 'full'});
const resetPage = javascriptPage({variant: 'identity', rows: 2, footer: 'full'});

/** Static page declarations are shared by application initialization and
 * component fixtures; reading layout metadata never constructs an application. */
export const pilotRoutes: readonly RouteRecordRaw[] = [
    // Only shared content which another actor can change opts into
    // automatic document replacement. New routes default to explicit recovery.
    {path: '/frontend-pilot', component: OverviewPage, meta: {...overviewPage, dynamicContent: true}},
    {path: '/frontend-pilot/home', component: LandingPage},
    {path: '/frontend-pilot/message', component: CommonPage},
    {path: '/frontend-pilot/users/profile', component: ProfileAdministrationPage, meta: {...profilePage, profileMode: 'edit'}},
    {path: '/frontend-pilot/users/profile/manage', component: ProfileAdministrationPage, meta: {...profileRosterPage, profileMode: 'manage'}},
    {path: '/frontend-pilot/users/profile/create', component: ProfileAdministrationPage, meta: {...profilePage, profileMode: 'create'}},
    // Warm workflow visits share read-only admission and command lifecycles.
    // Explicit issuance/confirmation never belongs to Query or route refresh.
    {path: '/frontend-pilot/users/profile/migrate/request', component: ProfileWorkflowPage, meta: {...workflowPage, profileWorkflow: 'token'}},
    {path: '/frontend-pilot/users/profile/migrate/show', component: ProfileWorkflowPage,
        meta: {...workflowPage, profileWorkflow: 'entry', profilePreviewHash: '#migration-preview'}},
    {path: '/frontend-pilot/users/profile/delete', component: ProfileWorkflowPage, meta: {...workflowPage, profileWorkflow: 'deactivate'}},
    {path: '/frontend-pilot/users/account/delete', component: ProfileWorkflowPage, meta: {...workflowPage, profileWorkflow: 'delete-account'}},
    {path: '/frontend-pilot/packing/create', component: PackingCreatePage, meta: packingCreatePage},
    {path: '/frontend-pilot/packing/:listId/duplicate', component: PackingCreatePage, meta: packingCreatePage},
    {path: '/frontend-pilot/packing/:listId/guest', component: PackingEntry, meta: guestPage},
    {path: '/frontend-pilot/packing/:listId', component: PackingEntry, meta: {...packingPage, dynamicContent: true}},
    {path: '/frontend-pilot/event/create', component: EventCreatePage, meta: eventCreatePage},
    {path: '/frontend-pilot/event/:eventId/duplicate', component: EventCreatePage, meta: eventCreatePage},
    {path: '/frontend-pilot/event/:eventId/guest', component: EventEntry, meta: guestPage},
    {path: '/frontend-pilot/event/:eventId/admin', component: EventEntry, meta: {...eventAdminPage, dynamicContent: true}},
    {path: '/frontend-pilot/event/:eventId', component: EventEntry, meta: {...eventPage, dynamicContent: true}},
    {path: '/frontend-pilot/drivers/create', component: DriversCreatePage, meta: listCreatePage},
    {path: '/frontend-pilot/drivers/:listId/duplicate', component: DriversCreatePage, meta: listCreatePage},
    {path: '/frontend-pilot/drivers/:listId/guest', component: DriversEntry, meta: guestPage},
    {path: '/frontend-pilot/drivers/:listId', component: DriversEntry, meta: {...driversPage, dynamicContent: true}},
    {path: '/frontend-pilot/survey/create', component: SurveyCreatePage, meta: surveyCreatePage},
    {path: '/frontend-pilot/survey/:surveyId/duplicate', component: SurveyCreatePage, meta: surveyCreatePage},
    {path: '/frontend-pilot/survey/:surveyId/guest', component: SurveyEntry, meta: guestPage},
    {path: '/frontend-pilot/survey/:surveyId', component: SurveyEntry, meta: {...surveyPage, dynamicContent: true}},
    {path: '/frontend-pilot/activity/create', component: ActivityCreatePage, meta: activityCreatePage},
    {path: '/frontend-pilot/activity/:planId/duplicate', component: ActivityCreatePage, meta: activityCreatePage},
    {path: '/frontend-pilot/activity/:planId/guest', component: ActivityEntry, meta: guestPage},
    {path: '/frontend-pilot/activity/:planId', component: ActivityEntry, meta: {...activityPage, dynamicContent: true}},
    {path: '/frontend-pilot/users/login', component: IdentityPage, meta: {...loginPage, identityMode: 'login'}},
    {path: '/frontend-pilot/users/register', component: IdentityPage, meta: {...registerPage, identityMode: 'register'}},
    {path: '/frontend-pilot/users/oidc/login', component: IdentityPage, meta: {...identityMessagePage, identityMode: 'oidc'}},
    {path: '/frontend-pilot/users/forgot-password', component: IdentityPage, meta: {...forgotPage, identityMode: 'forgot'}},
    {path: '/frontend-pilot/users/reset-password/:token', component: IdentityPage, meta: {...resetPage, identityMode: 'reset'}},
    {path: '/frontend-pilot/users/activate/:token', component: IdentityPage, meta: {...identityMessagePage, identityMode: 'activate'}},
    {path: '/frontend-pilot/guest/:guestId/login/:token', component: IdentityPage, meta: {...identityMessagePage, identityMode: 'guest-login'}},
    {path: '/frontend-pilot/guest/recovery', component: IdentityPage, meta: {...guestPage, identityMode: 'recovery'}},
    {path: '/frontend-pilot/help', component: HelpPage},
    {path: '/frontend-pilot/help/:doc', component: HelpPage},
    // Unknown opt-in destinations retain a readable 404 presentation;
    // Express owns the corresponding HTTP status on document requests.
    {path: '/frontend-pilot/:pathMatch(.*)*', component: CommonPage},

];

/** Browsers report retired module URLs differently. Recognize their load failures
 * specifically, so an ordinary component bug does not suggest a release reload. */
function isRouteModuleLoadFailure(error: unknown): boolean {
    return /(?:Failed to fetch|error loading) dynamically imported module|Importing a module script failed|Loading chunk|Failed to load module script/i.test(String(error));
}

/** Server and browser construct the same component tree with separate application-owned state. */
export function createPilotApp(bootstrap: FrontendPilotBootstrap, browser: boolean,
                               initialReloadGuard?: () => boolean) {
    const context = createPilotContext(bootstrap, browser, undefined, mayReloadAutomatically);
    // Register initial DOM protection before Router can start a failing import.
    // The browser entry releases it only after mounted draft restoration finishes.
    const releaseInitialReloadGuard = initialReloadGuard
        ? context.updates.registerGuard(initialReloadGuard) : () => {};
    const app = createSSRApp(App);
    // Identity, Overview, Help and every entity family share this router.
    // Default routing retains its separately authorized cutover.
    const router = createRouter({
        history: browser ? createWebHistory() : createMemoryHistory(),
        routes: pilotRoutes,
        /** Browser history owns saved positions. Local query/preview changes
         * preserve the viewport; deliberate anchors and new pages retain navigation. */
        async scrollBehavior(to, from, saved) {
            // Only the admitted renderer can say when a delayed article exists.
            // Restore history after that render; a feature must not re-anchor
            // after Router has restored the reader's actual saved offset.
            if (to.path.startsWith('/frontend-pilot/help') && (saved || to.hash)
                && (saved || to.path !== from.path || to.hash !== from.hash
                    || JSON.stringify(resolvePilotHelpQuery(to.params.doc, to.query))
                        !== JSON.stringify(resolvePilotHelpQuery(from.params.doc, from.query)))) {
                if (!await pageReadiness.wait(to)) return false;
                await nextTick();
                if (router.currentRoute.value !== to) return false;
                if (saved) return saved;
                // Invalid or missing authored headings are harmless. Select by
                // actual ID rather than allowing a fragment to become CSS syntax.
                try {
                    const target = document.getElementById(decodeURIComponent(to.hash.slice(1)));
                    return target ? {el: target, top: Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0} : false;
                } catch { return false; }
            }
            if (saved) return saved;
            // Help's query identifies a real article/search visit as well as its
            // selected locale. Only a different normalized document starts at top;
            // a locale-only URL synchronization must retain the reader's position.
            if (to.path === from.path && to.path.startsWith('/frontend-pilot/help')
                && JSON.stringify(resolvePilotHelpQuery(to.params.doc, to.query))
                    !== JSON.stringify(resolvePilotHelpQuery(from.params.doc, from.query))) {
                return to.hash ? false : {top: 0};
            }
            // Locale synchronization, filters and read results are SPA state,
            // not new documents that need the native submit/reload jump.
            if (to.path === from.path && to.hash === from.hash) return false;
            // This fragment records a local preview visit, not a DOM anchor.
            // Loading or retiring a receipt must not imitate native POST scrolling.
            const previewHash = to.meta.profilePreviewHash;
            if (to.path === from.path && typeof previewHash === 'string'
                && (to.hash === previewHash || from.hash === previewHash)) return false;
            if (to.hash) return {el: to.hash};
            return {top: 0};
        },
    });
    const pageReadiness = createPageReadiness(router);

    /** Resolve startup and mounted eligibility from the same route declarations.
     * This callback is installed before app.use(router) can load a failing chunk;
     * no mounted feature or duplicate endpoint inventory grants reload authority. */
    function mayReloadAutomatically(): boolean {
        // A first lazy-route failure precedes currentRoute commitment. Resolve
        // that document's URL without importing its component; later visits must
        // instead consult the actual committed route, including warm static pages.
        const current = router.currentRoute.value;
        const route = current.matched.length ? current
            : router.resolve(bootstrap.initialUrl ?? router.options.history.location);

        // Back/Forward changes the address before asynchronous navigation settles.
        // Do not reload a target document using the previous page's classification.
        if (browser && frontendDocumentUrl(route.fullPath) !== frontendDocumentUrl(router.options.history.location)) return false;

        // A server-admitted error/completion remains static even at a dynamic URL.
        // Reuse rendering's existing outcome policy and its live document lifetime.
        return route.meta.dynamicContent === true
            && !context.hasStaticPageOutcome(route);
    }

    observeInitialDocument(context, router);
    app.provide(pilotContextKey, context);
    app.provide(pageReadinessKey, pageReadiness);
    app.onUnmount(pageReadiness.dispose);
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
