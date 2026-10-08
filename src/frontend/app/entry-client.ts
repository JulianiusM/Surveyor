import {nextTick, watch} from 'vue';
import type {NavigationFailure, RouteLocationNormalized} from 'vue-router';
import {decodeBootstrap} from './serializeBootstrap';
import {createPilotApp} from './createApp';
import {mountPreservingDrafts} from './mountPreservingDrafts';
import {localeManifest} from '../../modules/localization/translator';
import '../styles/pilot.css';

async function start(): Promise<void> {
    const node = document.getElementById('surveyor-pilot-state');
    const value: unknown = JSON.parse(node?.textContent ?? 'null');
    const bootstrap = await decodeBootstrap(value);
    const {app, router, context} = createPilotApp(bootstrap, true);
    await router.isReady();
    const container = document.getElementById('surveyor-pilot');
    if (!container) throw new Error('The pilot application container is missing.');
    mountPreservingDrafts(app, container);
    watch(context.locale, locale => {
        document.documentElement.lang = locale;
        document.documentElement.dir = localeManifest.find(entry => entry.locale === locale)?.direction ?? 'ltr';
    }, {immediate: true});
    const stop = context.start();
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
