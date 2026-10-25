import type {Request} from 'express';

export function createApiRequest(overrides: {
    body?: Request['body'];
    profileId?: string;
} = {}): Request {
    return {
        body: overrides.body ?? {title: 'Summer Camp'},
        session: {
            profile: overrides.profileId ? {id: overrides.profileId} : undefined,
        },
    } as Request;
}
