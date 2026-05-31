import settings from '../settings';

export function buildGuestLink(entityType: string, entityId: string, token: string) {
    const pathSegments = [entityType, entityId, 'edit', token]
        .map(segment => encodeURIComponent(String(segment)))
        .join('/');
    let base = settings.value.rootUrl;
    base = base.endsWith('/') ? base : base + '/';
    return new URL(pathSegments, base).toString();
}
