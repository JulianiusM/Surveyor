import {nextTick, watch} from 'vue';
import type {NavigationFailure, RouteLocationNormalized} from 'vue-router';
import {decodeBootstrap} from './serializeBootstrap';
import {createPilotApp, initializePilotApp} from './createApp';
import {hasHydrationDrafts} from './mountPreservingDrafts';
import {createTranslator, localeManifest} from '../../modules/localization/translator';
import type {Locale} from '../../types/LocalizationTypes';
import type {PilotContext} from '../../types/FrontendPilotUiTypes';
// Client loading and SSR links consume one frontend-owned cascade composition.
import '../styles/application.sass';

/** Keep the browser document's language and reading direction aligned with the
 * application locale, including the first hydrated render and later switches. */
function updateDocumentLanguage(locale: Locale): void {
    // Assistive technology reads the selected interface language from the document;
    // direction comes from the same generated catalog rather than a second registry.
    document.documentElement.lang = locale;
    document.documentElement.dir = localeManifest.find(entry => entry.locale === locale)?.direction ?? 'ltr';
}

/** Enable the shell's existing recovery control without replacing hydrated DOM.
 * The entry owns deliberate reload consent; independent startup attributes own
 * visibility, and the shell alone owns SSR/client markup and localized wording. */
function showStartupRecovery(container: Element, recover: () => void): void {
    // Static Help inputs and any partially mounted owners keep their original
    // nodes. Attach the guarded action before making that capability visible.
    const button = container.querySelector<HTMLButtonElement>('[data-pilot-startup-reload]');
    if (!button) return;
    button.addEventListener('click', recover);
    container.setAttribute('data-pilot-startup-recovery-ready', 'true');
}

/** Protect initial DOM drafts before Router starts loading, validate bootstrap,
 * and restore the same controls before handing protection to mounted owners.
 * Initial route/decoder failure retains those nodes and offers localized recovery. */
async function start(): Promise<void> {
    const container = document.getElementById('surveyor-pilot');
    if (!container) {
        console.error('The pilot application container is missing.');
        return;
    }
    const messages = createTranslator(document.documentElement.lang);
    let context: PilotContext | undefined;
    let discardApproved = false;

    /** Reuse hydration's exact editable-field rules without keeping a second draft. */
    function mayReloadInitialDocument(): boolean {
        return discardApproved || !hasHydrationDrafts(container!);
    }

    /** Browser refresh/leave also precedes mounted beforeunload protection.
     * Only a deliberately confirmed recovery may release these initial edits. */
    function protectInitialDrafts(event: BeforeUnloadEvent): void {
        // Consume explicit consent at the actual browser departure, which can
        // happen after location.reload returns. A canceled departure retains no lease.
        if (discardApproved) { discardApproved = false; return; }
        if (mayReloadInitialDocument()) return;
        event.preventDefault();
        event.returnValue = '';
    }

    /** A deliberate recovery can retry a failed automatic attempt. Initial draft
     * consent releases only this guard; other mounted/command guards still apply. */
    function recoverStartup(): void {
        // Read live controls, including files and autofill, at the decision boundary.
        // No form value is serialized or automatically submitted by recovery.
        if (!mayReloadInitialDocument() && !window.confirm(messages.t('draft.discard'))) return;
        discardApproved = true;
        let dispatched = false;
        try {
            if (context) dispatched = context.updates.requestRecoveryReload();
            else {
                window.location.reload();
                dispatched = true;
            }
        } finally {
            // A blocked attempt releases consent immediately. A dispatched reload
            // consumes it in beforeunload instead of triggering a second prompt.
            if (!dispatched) discardApproved = false;
        }
    }

    window.addEventListener('beforeunload', protectInitialDrafts);
    try {
        // Bootstrap must validate before any private application owner exists.
        // Its own lazy validator can fail before Router/context construction.
        const node = document.getElementById('surveyor-pilot-state');
        const value: unknown = JSON.parse(node?.textContent ?? 'null');
        const bootstrap = await decodeBootstrap(value);
        const application = createPilotApp(bootstrap, true, mayReloadInitialDocument);
        const {router} = application;
        context = application.context;
        await router.isReady();
        watch(context.locale, updateDocumentLanguage, {immediate: true});
        const stop = await initializePilotApp(application, container);
        // Mounted guards now protect the restored models. Only after that handoff
        // may the temporary DOM guard and its beforeunload listener retire.
        container.setAttribute('data-pilot-hydrated', 'true');
        // The same success marker dismisses the safe-default notice even when
        // the independent inline monitor could not execute. Vue owns no hidden prop.
        application.releaseInitialReloadGuard();
        window.removeEventListener('beforeunload', protectInitialDrafts);

        // A bfcache restore resumes this same application; disposing a persisted
        // pagehide would leave visible controls with permanently obsolete transport.
        window.addEventListener('pagehide', event => { if (!event.persisted) stop(); });
        window.addEventListener('pageshow', event => {
            if (event.persisted) window.dispatchEvent(new Event('focus'));
        });

        /** Move focus only after actual destination commitment, preserving the
         * current draft/focus during canceled, obsolete or failed lazy navigation. */
        async function focusDestination(to: RouteLocationNormalized, from: RouteLocationNormalized,
                                        failure?: NavigationFailure | void): Promise<void> {
            // Path/query owners handle their own unchanged-document interaction.
            if (failure || to.path === from.path) return;
            await nextTick();
            if (router.currentRoute.value.fullPath !== to.fullPath) return;
            document.getElementById('pilot-main')?.focus({preventScroll: true});
        }
        router.afterEach(focusDestination);
    } catch (error) {
        // Keep available initial controls and surface recovery even when no component
        // mounted. Existing partial command owners, if any, retain their guards.
        showStartupRecovery(container, recoverStartup);
        container.setAttribute('data-pilot-startup-failed', 'true');
        console.error('Frontend startup failed.', error);
    }
}

void start();
