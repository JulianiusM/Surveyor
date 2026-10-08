import type {components, paths} from '../../../types/api/v1';
import type {PilotContext, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {PilotApi} from '../../app/api';
import {validateOverviewRegion} from '../../../../.generated/api/v1/browser/validateOverviewRegion.mjs';
import {validateOverviewVisibilityResult} from '../../../../.generated/api/v1/browser/validateOverviewVisibilityResult.mjs';


/** Feature operations own their generated validators; transport and actor admission are shared. */
export class OverviewApi {
    constructor(private transport: PilotApi) {}

    async overview(query: NonNullable<paths['/overview']['get']['parameters']['query']>, scope: PilotRequestScope, signal?: AbortSignal) {
        return this.transport.allowedRead('overview/' + JSON.stringify(query), scope, async () => this.transport.read('getOverview', await this.transport.client.GET('/overview', {
            params: {query, header: this.transport.headers(scope)}, signal, cache: 'no-store',
        }), validateOverviewRegion, scope).data);
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
