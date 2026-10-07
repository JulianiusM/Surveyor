import type {QueryClient} from '@tanstack/vue-query';

/** A denied list can also appear in overview cards and event selection results. Discard those
 * bounded query families instead of attempting to redact nested DTOs into a new, unauthoritative
 * snapshot. Cancel first so an earlier successful read cannot restore the removed private data. */
export async function evictPackingResource(client: QueryClient, context: string, listId: string): Promise<void> {
    const filter = {predicate: (query: {queryKey: readonly unknown[]}) => {
        const key = query.queryKey;
        if (key[0] !== 'v1' || key[1] !== context) return false;
        // Detail/overview keys include locale; profile and guest-entry queries contain only
        // machine data and use the same feature/resource suffix without that locale segment.
        const featureIndex = key[2] === 'packing' ? 2 : key[3] === 'packing' ? 3 : -1;
        if (featureIndex === -1) return false;
        const resource = key[featureIndex + 1];
        return resource === listId || resource === 'overview' || resource === 'events';
    }};
    await client.cancelQueries(filter);
    client.removeQueries(filter);
}
