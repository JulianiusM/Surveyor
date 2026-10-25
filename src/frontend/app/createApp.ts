import {createSSRApp, nextTick} from 'vue';
import {createMemoryHistory, createRouter, createWebHistory} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {FrontendBootstrap} from '../../types/FrontendTypes';
import {frontendDocumentUrl} from '../../modules/lib/frontendIdentity';
import {resolveFrontendHelpQuery} from '../../modules/lib/helpNavigation';
import {createFrontendContext, observeInitialDocument, frontendContextKey} from './context';
import App from './App.vue';
import {mountPreservingDrafts} from './mountPreservingDrafts';
import {createPageReadiness, pageReadinessKey} from '../composables/pageNavigation';
import {frontendRoutes} from '../routes';

/** Browsers report retired module URLs differently. Recognize their load failures
 * specifically, so an ordinary component bug does not suggest a release reload. */
function isRouteModuleLoadFailure(error: unknown): boolean {
    return /(?:Failed to fetch|error loading) dynamically imported module|Importing a module script failed|Loading chunk|Failed to load module script/i.test(String(error));
}

/** Server and browser construct the same component tree with separate application-owned state. */
export function createFrontendApp(bootstrap: FrontendBootstrap, browser: boolean,
                               initialReloadGuard?: () => boolean) {
    const context = createFrontendContext(bootstrap, browser, undefined, mayReloadAutomatically);
    // Register initial DOM protection before Router can start a failing import.
    // The browser entry releases it only after mounted draft restoration finishes.
    const releaseInitialReloadGuard = initialReloadGuard
        ? context.updates.registerGuard(initialReloadGuard) : () => {};
    const app = createSSRApp(App);
    // Identity, Overview, Help and every entity family share this router.
    // Domain declarations share this application-owned navigation lifecycle.
    const router = createRouter({
        history: browser ? createWebHistory() : createMemoryHistory(),
        routes: frontendRoutes,
        /** Browser history owns saved positions. Local query/preview changes
         * preserve the viewport; deliberate anchors and new pages retain navigation. */
        async scrollBehavior(to, from, saved) {
            // Only the admitted renderer can say when a delayed article exists.
            // Restore history after that render; a feature must not re-anchor
            // after Router has restored the reader's actual saved offset.
            // Router matching admits equivalent URL spellings. Only its Help
            // records have an article readiness owner; catch-all errors do not.
            if (to.meta.helpPage && (saved || to.hash)
                && (saved || to.path !== from.path || to.hash !== from.hash
                    || JSON.stringify(resolveFrontendHelpQuery(to.params.doc, to.query))
                        !== JSON.stringify(resolveFrontendHelpQuery(from.params.doc, from.query)))) {
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
            if (to.path === from.path && to.meta.helpPage
                && JSON.stringify(resolveFrontendHelpQuery(to.params.doc, to.query))
                    !== JSON.stringify(resolveFrontendHelpQuery(from.params.doc, from.query))) {
                return to.hash ? false : {top: 0};
            }
            // Locale synchronization, filters and read results are SPA state,
            // not new documents that require a submit/reload jump.
            if (to.path === from.path && to.hash === from.hash) return false;
            // This fragment records a local preview visit, not a DOM anchor.
            // Loading or retiring a receipt must preserve the current scroll position.
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
    app.provide(frontendContextKey, context);
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
export async function initializeFrontendApp(application: ReturnType<typeof createFrontendApp>, container: Element): Promise<() => void> {
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
