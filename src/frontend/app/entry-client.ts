import {nextTick, watch} from 'vue';
import type {NavigationFailure, RouteLocationNormalized} from 'vue-router';
import {decodeBootstrap} from './serializeBootstrap';
import {createPilotApp} from './createApp';
import {mountPreservingDrafts} from './mountPreservingDrafts';
import {localeManifest} from '../../modules/localization/translator';
import type {Locale} from '../../types/LocalizationTypes';
import '../styles/pilot.css';

/** Keep the browser document's language and reading direction aligned with the
 * application locale, including the first hydrated render and later switches. */
function updateDocumentLanguage(locale: Locale): void {
    // Assistive technology reads the selected interface language from the document;
    // direction comes from the same generated catalog rather than a second registry.
    document.documentElement.lang = locale;
    document.documentElement.dir = localeManifest.find(entry => entry.locale === locale)?.direction ?? 'ltr';
}

/** Validate the server bootstrap before creating any browser owner, then restore
 * pre-hydration controls before publishing readiness. Page lifecycle listeners
 * preserve the same application when the browser restores its back-forward cache. */
async function start(): Promise<void> {
    const node = document.getElementById('surveyor-pilot-state');
    const value: unknown = JSON.parse(node?.textContent ?? 'null');
    const bootstrap = await decodeBootstrap(value);
    const {app, router, context} = createPilotApp(bootstrap, true);
    await router.isReady();

    const container = document.getElementById('surveyor-pilot');
    if (!container) throw new Error('The pilot application container is missing.');
    await mountPreservingDrafts(app, container);

    watch(context.locale, updateDocumentLanguage, {immediate: true});
    const stop = context.start();
    // Mount installs listeners before draft restoration finishes. Publish readiness only
    // after restored models and the ordinary request/identity lifecycle are both active.
    container.setAttribute('data-pilot-hydrated', 'true');
    // A bfcache restore resumes this same application; disposing it on a persisted pagehide would
    // leave a visible page whose transport permanently rejects every response as obsolete.
    window.addEventListener('pagehide', event => { if (!event.persisted) stop(); });
    window.addEventListener('pageshow', event => {
        if (event.persisted) window.dispatchEvent(new Event('focus'));
    });

    /** Loading feedback preserves the current draft/focus. Move focus only after a
     * destination actually commits, never for cancellation or an obsolete completion. */
    async function focusDestination(to: RouteLocationNormalized, from: RouteLocationNormalized,
                                    failure?: NavigationFailure | void): Promise<void> {
        if (failure || to.path === from.path) return;
        await nextTick();
        if (router.currentRoute.value.fullPath !== to.fullPath) return;
        document.getElementById('pilot-main')?.focus({preventScroll: true});
    }
    router.afterEach(focusDestination);
}

void start();
