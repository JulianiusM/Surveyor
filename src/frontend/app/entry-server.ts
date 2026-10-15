import {renderToString} from 'vue/server-renderer';
import type {FrontendPilotBootstrap, FrontendPilotRenderResult} from '../../types/FrontendPilotTypes';
import {createPilotApp} from './createApp';
import {serializeBootstrap} from './serializeBootstrap';

/** Express supplies the already-authorized session/help projection; SSR never calls its own HTTP server. */
export async function render(url: string, bootstrap: FrontendPilotBootstrap): Promise<FrontendPilotRenderResult> {
    // The renderer already supplies the request-safe declaration. Preserve its complete
    // projection; the browser codec validates every declared field before hydration.
    const initial: FrontendPilotBootstrap = {...bootstrap, initialUrl: url};
    const {app, router, context} = createPilotApp(initial, false);
    try {
        await router.push(url);
        await router.isReady();
        const html = await renderToString(app);
        // App and the document renderer use the same route/evidence classification.
        // SSR remains the matching hydration tree, including readable Help/results.
        const javascriptRequired = context.requiresClientInitialization(router.currentRoute.value);
        return {html, title: context.pageTitle.value, state: serializeBootstrap(initial), javascriptRequired};
    } finally { context.start()(); }
}
