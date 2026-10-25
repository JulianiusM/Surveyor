import type {components, paths} from '../../../types/api/v1';
import type {FrontendContext, FrontendRequestScope} from '../../../types/FrontendUiTypes';
import type {FrontendApi} from '../../app/api';
import type {LocationQuery} from 'vue-router';
import {validateOverviewRegion} from '../../../../.generated/api/v1/browser/validateOverviewRegion.mjs';
import {validateOverviewVisibilityResult} from '../../../../.generated/api/v1/browser/validateOverviewVisibilityResult.mjs';

/** Decode one region's durable URL into its generated read parameters. SSR seeds
 * and mounted navigation must use the exact same key, including omitted fields;
 * another collection's query fields never enter this feature request. */
export function overviewQueryParameters(values: LocationQuery, collection: components['schemas']['OverviewRegion']['collection'],
                                        region: components['schemas']['OverviewRegion']['region']): NonNullable<paths['/overview']['get']['parameters']['query']> {
    const prefix = collection + '_' + region + '_';

    // Bookmarked values admit only a single string. The server remains
    // responsible for type validation, normalization, paging and canonical results.
    function field(name: string): string | undefined {
        const value = values[prefix + name];
        return typeof value === 'string' ? value : undefined;
    }

    return {collection, region, q: field('q'), type: field('type') as components['schemas']['OverviewRegion']['type'] | undefined,
        page: field('page'), childPage: field('childPage'), eventId: field('event')};
}

/** Feature operations own their generated validators; transport and actor admission are shared. */
export class OverviewApi {
    constructor(private transport: FrontendApi) {}

    /** Fetch only the requested collection/region/filter projection. The query
     * identifies its recovery deadline; the mounted region separately fences
     * navigation generation and adopts the server's canonical page/query state. */
    async overview(query: NonNullable<paths['/overview']['get']['parameters']['query']>, scope: FrontendRequestScope, signal?: AbortSignal) {
        const transport = this.transport;
        async function readOverview(): Promise<components['schemas']['OverviewRegion']> {
            const response = await transport.client.GET('/overview', {
                params: {query, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read('getOverview', {...response, signal}, validateOverviewRegion, scope).data;
        }
        return transport.allowedRead('overview/' + JSON.stringify(query), scope, readOverview, signal);
    }

    async visibility(type: components['schemas']['OverviewCard']['type'], entityId: string, visibility: components['schemas']['OverviewVisibilityInput']['visibility'], scope: FrontendRequestScope) {
        return this.transport.read('setOverviewVisibility', await this.transport.client.PUT('/overview/{entityType}/{entityId}/visibility', {
            params: {path: {entityType: type, entityId}, header: this.transport.headers(scope)}, body: {visibility}, cache: 'no-store',
        }), validateOverviewVisibilityResult, scope).data;
    }
}

// The transport is application/request-local and survives each component's useFrontend wrapper.
const owners = new WeakMap<FrontendApi, OverviewApi>();
/** Reuse the request/application transport owner through component-local translation bindings. */
export function useOverviewApi(context: FrontendContext): OverviewApi {
    let owner = owners.get(context.api);
    if (!owner) { owner = new OverviewApi(context.api); owners.set(context.api, owner); }
    return owner;
}
