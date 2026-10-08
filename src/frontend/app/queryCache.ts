import type {QueryClient} from '@tanstack/vue-query';
import {belongsToQueryFamily, overviewKeys, packingKeys} from './queryKeys';

/** A denied list can also appear in overview cards and event selection results. Discard those
 * bounded query families instead of attempting to redact nested DTOs into a new, unauthoritative
 * snapshot. Cancel first so an earlier successful read cannot restore the removed private data. */
export async function evictPackingResource(client: QueryClient, context: string, listId: string): Promise<void> {
    const families = [packingKeys.resource(context, listId), packingKeys.events(context), overviewKeys.all(context)];
    const filter = {predicate: (query: Parameters<typeof belongsToQueryFamily>[0]) =>
        families.some(family => belongsToQueryFamily(query, family))};
    await client.cancelQueries(filter);
    client.removeQueries(filter);
}
