import type {components, operations} from '../../../types/api/v1';
import type {FrontendContext, FrontendRequestScope} from '../../../types/FrontendUiTypes';
import type {FrontendApi} from '../../app/api';
import {validateHelpPageData} from '../../../../.generated/api/v1/browser/validateHelpPageData.mjs';

type Help = components['schemas']['HelpPageData'];
// The authored operation remains the single owner of both accepted query fields.
type HelpQuery = NonNullable<operations['getHelpPage']['parameters']['query']>;

/** Feature operations own their generated validators; transport and actor admission are shared. */
export class HelpApi {
    constructor(private transport: FrontendApi) {}

    /** Help bodies belong to the captured interface locale as well as the actor.
     * Validate both before adoption, including visible fallback/source metadata;
     * the shared transport owns cancellation and this query's recovery deadline. */
    async help(query: HelpQuery, scope: FrontendRequestScope, signal?: AbortSignal): Promise<Help> {
        const transport = this.transport;
        async function readHelp(): Promise<Help> {
            const response = await transport.client.GET('/help', {
                params: {query, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getHelpPage', {...response, signal}, validateHelpPageData, scope, undefined, true).data;
        }
        return transport.allowedRead(`help/${JSON.stringify(query)}`, scope, readHelp, signal);
    }
}

// The transport is application/request-local and survives each component's useFrontend wrapper.
const owners = new WeakMap<FrontendApi, HelpApi>();

/** Reuse this application/request's Help adapter through component-local translation
 * wrappers. Its shared transport identity keeps actors from sharing another app's owner. */
export function useHelpApi(context: FrontendContext): HelpApi {
    let owner = owners.get(context.api);

    // Construct only for a new transport. Remounts retain the same adapter while
    // the WeakMap lets disposal release an otherwise unreachable application owner.
    if (!owner) {
        owner = new HelpApi(context.api);
        owners.set(context.api, owner);
    }

    return owner;
}
