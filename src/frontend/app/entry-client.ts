import {nextTick, watch} from 'vue';
import {validateHelpPageData, validateSessionView, validatePasswordResetCheck, validateProblem} from '../../../.generated/api/v1/browser.mjs';
import type {FrontendPilotBootstrap} from '../../types/FrontendPilotTypes';
import {createPilotApp} from './createApp';
import {localeManifest} from '../../modules/localization/translator';
import '../styles/pilot.css';

async function start(): Promise<void> {
    const node = document.getElementById('surveyor-pilot-state');
    const value: unknown = JSON.parse(node?.textContent ?? 'null');
    if (!value || typeof value !== 'object' || !('session' in value) || !validateSessionView(value.session)
        || ('help' in value && !validateHelpPageData(value.help))
        || ('identityProblem' in value && !validateProblem(value.identityProblem))
        || ('passwordReset' in value && !validatePasswordResetCheck(value.passwordReset)
            && !validateProblem(value.passwordReset))) throw new Error('Invalid pilot bootstrap.');
    const bootstrap: FrontendPilotBootstrap = {session: value.session,
        ...('help' in value ? {help: value.help as FrontendPilotBootstrap['help']} : {}),
        ...('identityProblem' in value ? {identityProblem: value.identityProblem as FrontendPilotBootstrap['identityProblem']} : {}),
        ...('passwordReset' in value ? {passwordReset: value.passwordReset as FrontendPilotBootstrap['passwordReset']} : {}),
        ...('initialUrl' in value && typeof value.initialUrl === 'string' ? {initialUrl: value.initialUrl} : {})};
    const {app, router, context} = createPilotApp(bootstrap, true);
    await router.isReady();
    app.mount('#surveyor-pilot');
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
    router.afterEach(async (to, from) => {
        if (to.path === from.path) return;
        await nextTick();
        document.getElementById('pilot-main')?.focus({preventScroll: true});
    });
}

void start();
