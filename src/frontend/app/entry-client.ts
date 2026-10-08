import {nextTick, watch} from 'vue';
import {validateSessionView} from '../../../.generated/api/v1/browser/validateSessionView.mjs';
import {validateProblem} from '../../../.generated/api/v1/browser/validateProblem.mjs';
import type {FrontendPilotBootstrap} from '../../types/FrontendPilotTypes';
import {createPilotApp} from './createApp';
import {mountPreservingDrafts} from './mountPreservingDrafts';
import {localeManifest} from '../../modules/localization/translator';
import {frontendIdentityFeedback} from '../../modules/lib/frontendIdentity';
import '../styles/pilot.css';

async function start(): Promise<void> {
    const node = document.getElementById('surveyor-pilot-state');
    const value: unknown = JSON.parse(node?.textContent ?? 'null');
    if (!value || typeof value !== 'object' || !('session' in value) || !validateSessionView(value.session)
        || ('identityProblem' in value && !validateProblem(value.identityProblem))
        || ('identityFormProblem' in value && !validateProblem(value.identityFormProblem))
        || ('identityFeedback' in value && !frontendIdentityFeedback.includes(value.identityFeedback as typeof frontendIdentityFeedback[number]))
        || ('personalLink' in value && typeof value.personalLink !== 'string')
        || ('identityFields' in value && (!value.identityFields || typeof value.identityFields !== 'object'
            || Object.entries(value.identityFields).some(([key, field]) => !['username', 'displayname', 'email'].includes(key) || typeof field !== 'string')))) {
        throw new Error('Invalid pilot bootstrap.');
    }
    // Initial native data owns feature validators only when that feature is present.
    // Ordinary packing entry therefore does not download the entire help/overview contract.
    if ('help' in value) {
        const {validateHelpPageData} = await import('../../../.generated/api/v1/browser/validateHelpPageData.mjs');
        if (!validateHelpPageData(value.help)) throw new Error('Invalid pilot help bootstrap.');
    }
    if ('passwordReset' in value) {
        const {validatePasswordResetCheck} = await import('../../../.generated/api/v1/browser/validatePasswordResetCheck.mjs');
        if (!validatePasswordResetCheck(value.passwordReset) && !validateProblem(value.passwordReset)) throw new Error('Invalid pilot reset bootstrap.');
    }
    if ('guestEntry' in value) {
        const {validateGuestEntry} = await import('../../../.generated/api/v1/browser/validateGuestEntry.mjs');
        if (!validateGuestEntry(value.guestEntry)) throw new Error('Invalid pilot guest bootstrap.');
    }
    if ('overview' in value) {
        const {validateOverviewRegion} = await import('../../../.generated/api/v1/browser/validateOverviewRegion.mjs');
        if (!Array.isArray(value.overview) || !value.overview.every(validateOverviewRegion)) throw new Error('Invalid pilot overview bootstrap.');
    }
    const bootstrap: FrontendPilotBootstrap = {session: value.session,
        ...('help' in value ? {help: value.help as FrontendPilotBootstrap['help']} : {}),
        ...('identityProblem' in value ? {identityProblem: value.identityProblem as FrontendPilotBootstrap['identityProblem']} : {}),
        ...('identityFormProblem' in value ? {identityFormProblem: value.identityFormProblem as FrontendPilotBootstrap['identityFormProblem']} : {}),
        ...('identityFeedback' in value ? {identityFeedback: value.identityFeedback as FrontendPilotBootstrap['identityFeedback']} : {}),
        ...('identityFields' in value ? {identityFields: value.identityFields as FrontendPilotBootstrap['identityFields']} : {}),
        ...('guestEntry' in value ? {guestEntry: value.guestEntry as FrontendPilotBootstrap['guestEntry']} : {}),
        ...('personalLink' in value ? {personalLink: value.personalLink as string} : {}),
        ...('overview' in value ? {overview: value.overview as FrontendPilotBootstrap['overview']} : {}),
        ...('passwordReset' in value ? {passwordReset: value.passwordReset as FrontendPilotBootstrap['passwordReset']} : {}),
        ...('initialUrl' in value && typeof value.initialUrl === 'string' ? {initialUrl: value.initialUrl} : {})};
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
    router.afterEach(async (to, from) => {
        if (to.path === from.path) return;
        await nextTick();
        document.getElementById('pilot-main')?.focus({preventScroll: true});
    });
}

void start();
