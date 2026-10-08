import type {components} from '../../../types/api/v1';
import type {PilotContext, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {PilotApi} from '../../app/api';
import {validateHelpPageData} from '../../../../.generated/api/v1/browser/validateHelpPageData.mjs';

type Help = components['schemas']['HelpPageData'];

/** Feature operations own their generated validators; transport and actor admission are shared. */
export class HelpApi {
    constructor(private transport: PilotApi) {}

    async help(query: {q?: string; doc?: string}, scope: PilotRequestScope, signal?: AbortSignal): Promise<Help> {
        return this.transport.allowedRead(`help/${JSON.stringify(query)}`, scope, async () => this.transport.read('getHelpPage', await this.transport.client.GET('/help', {
            params: {query, header: this.transport.headers(scope)}, signal, cache: 'no-store',
        }), validateHelpPageData, scope, undefined, true).data);
    }
}

// The transport is application/request-local and survives each component's usePilot wrapper.
const owners = new WeakMap<PilotApi, HelpApi>();
export function useHelpApi(context: PilotContext): HelpApi {
    let owner = owners.get(context.api);
    if (!owner) { owner = new HelpApi(context.api); owners.set(context.api, owner); }
    return owner;
}
