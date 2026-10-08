import {renderToString} from 'vue/server-renderer';
import type {FrontendPilotBootstrap, FrontendPilotRenderResult} from '../../types/FrontendPilotTypes';
import {createPilotApp} from './createApp';
import {serializeBootstrap} from './serializeBootstrap';
import {frontendIdentityMessageFeedback} from '../../modules/lib/frontendIdentity';

/** Express supplies the already-authorized session/help projection; SSR never calls its own HTTP server. */
export async function render(url: string, bootstrap: FrontendPilotBootstrap): Promise<FrontendPilotRenderResult> {
    const initial: FrontendPilotBootstrap = {session: bootstrap.session, initialUrl: url,
        ...(bootstrap.pageEntry ? {pageEntry: bootstrap.pageEntry} : {}),
        ...(bootstrap.pageNotice ? {pageNotice: bootstrap.pageNotice} : {}),
        ...(bootstrap.pageCompletion ? {pageCompletion: bootstrap.pageCompletion} : {}),
        ...(bootstrap.help ? {help: bootstrap.help} : {}),
        ...(bootstrap.identityProblem ? {identityProblem: bootstrap.identityProblem} : {}),
        ...(bootstrap.identityFields ? {identityFields: bootstrap.identityFields} : {}),
        ...(bootstrap.identityFormProblem ? {identityFormProblem: bootstrap.identityFormProblem} : {}),
        ...(bootstrap.identityFeedback ? {identityFeedback: bootstrap.identityFeedback} : {}),
        ...(bootstrap.guestEntry ? {guestEntry: bootstrap.guestEntry} : {}),
        ...(bootstrap.packingError ? {packingError: bootstrap.packingError} : {}),
        ...(bootstrap.packingCreateContext ? {packingCreateContext: bootstrap.packingCreateContext} : {}),
        ...(bootstrap.packingDuplicate ? {packingDuplicate: bootstrap.packingDuplicate} : {}),
        ...(bootstrap.personalLink ? {personalLink: bootstrap.personalLink} : {}),
        ...(bootstrap.overview ? {overview: bootstrap.overview} : {}),
        ...(bootstrap.passwordReset ? {passwordReset: bootstrap.passwordReset} : {})};
    const {app, router, context} = createPilotApp(initial, false);
    try {
        await router.push(url);
        await router.isReady();
        const html = await renderToString(app);
        // Admission notices remain readable. Interactive route metadata supplies
        // the message-only fallback without modifying the hydrated tree.
        const metadata = router.currentRoute.value.meta;
        const completion = initial.pageCompletion;
        // A confirmed native POST needs no further JavaScript to display its message.
        // Ordinary notices still accompany interactive pages; scoped receipts qualify
        // only for their actual actor and committed canonical destination.
        const messageCompleted = (!!initial.identityFeedback && frontendIdentityMessageFeedback.includes(initial.identityFeedback))
            || (!!completion && completion.context === initial.session.context
                && completion.destination === router.currentRoute.value.fullPath);
        const javascriptRequired = initial.pageEntry?.kind !== 'denied' && !initial.packingError
            && !initial.identityProblem && !(initial.passwordReset && 'status' in initial.passwordReset)
            && !messageCompleted
            && metadata.javascriptRequired === true;
        return {html, title: context.pageTitle.value, state: serializeBootstrap(initial), javascriptRequired};
    } finally { context.start()(); }
}
