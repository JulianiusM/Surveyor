import {renderToString} from 'vue/server-renderer';
import type {FrontendPilotBootstrap, FrontendPilotRenderResult} from '../../types/FrontendPilotTypes';
import {createPilotApp} from './createApp';
import {serializeBootstrap} from './serializeBootstrap';

/** Express supplies the already-authorized session/help projection; SSR never calls its own HTTP server. */
export async function render(url: string, bootstrap: FrontendPilotBootstrap): Promise<FrontendPilotRenderResult> {
    const initial: FrontendPilotBootstrap = {session: bootstrap.session, initialUrl: url,
        ...(bootstrap.help ? {help: bootstrap.help} : {}),
        ...(bootstrap.identityProblem ? {identityProblem: bootstrap.identityProblem} : {}),
        ...(bootstrap.identityFields ? {identityFields: bootstrap.identityFields} : {}),
        ...(bootstrap.identityFormProblem ? {identityFormProblem: bootstrap.identityFormProblem} : {}),
        ...(bootstrap.identityFeedback ? {identityFeedback: bootstrap.identityFeedback} : {}),
        ...(bootstrap.guestEntry ? {guestEntry: bootstrap.guestEntry} : {}),
        ...(bootstrap.personalLink ? {personalLink: bootstrap.personalLink} : {}),
        ...(bootstrap.overview ? {overview: bootstrap.overview} : {}),
        ...(bootstrap.passwordReset ? {passwordReset: bootstrap.passwordReset} : {})};
    const {app, router, context} = createPilotApp(initial, false);
    try {
        await router.push(url);
        await router.isReady();
        const html = await renderToString(app);
        return {html, title: context.pageTitle.value, state: serializeBootstrap(initial)};
    } finally { context.start()(); }
}
