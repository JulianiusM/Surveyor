import type {components, paths} from '../../../types/api/v1';
import type {PilotContext, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {PilotApi} from '../../app/api';
import {validateOverviewRegion} from '../../../../.generated/api/v1/browser/validateOverviewRegion.mjs';
import {validateOverviewVisibilityResult} from '../../../../.generated/api/v1/browser/validateOverviewVisibilityResult.mjs';


/** Feature operations own their generated validators; transport and actor admission are shared. */
export class OverviewApi {
    constructor(private transport: PilotApi) {}

    /** Fetch only the requested collection/region/filter projection. The query
     * identifies its recovery deadline; the mounted region separately fences
     * navigation generation and adopts the server's canonical page/query state. */
    async overview(query: NonNullable<paths['/overview']['get']['parameters']['query']>, scope: PilotRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readOverview(): Promise<components['schemas']['OverviewRegion']> {
            const response = await transport.client.GET('/overview', {
                params: {query, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getOverview', {...response, signal}, validateOverviewRegion, scope).data;
        }
        return transport.allowedRead('overview/' + JSON.stringify(query), scope, readOverview, signal);
    }

    async visibility(type: components['schemas']['OverviewCard']['type'], entityId: string, visibility: components['schemas']['OverviewVisibilityInput']['visibility'], scope: PilotRequestScope) {
        return this.transport.read('setOverviewVisibility', await this.transport.client.PUT('/overview/{entityType}/{entityId}/visibility', {
            params: {path: {entityType: type, entityId}, header: this.transport.headers(scope)}, body: {visibility}, cache: 'no-store',
        }), validateOverviewVisibilityResult, scope).data;
    }
}

// The transport is application/request-local and survives each component's usePilot wrapper.
const owners = new WeakMap<PilotApi, OverviewApi>();
export function useOverviewApi(context: PilotContext): OverviewApi {
    let owner = owners.get(context.api);
    if (!owner) { owner = new OverviewApi(context.api); owners.set(context.api, owner); }
    return owner;
}
