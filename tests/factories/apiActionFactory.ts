import type {Request} from 'express';
import type {performAPIAction} from '../../src/modules/lib/util';

type ApiAction = Parameters<typeof performAPIAction>[1];

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

export function createRecordingAction(): ApiAction & {calls: {body: Request['body']; profileId: string}[]} {
    const calls: {body: Request['body']; profileId: string}[] = [];
    const action = async (body: Request['body'], profileId: string): Promise<void> => {
        calls.push({body, profileId});
    };

    return Object.assign(action, {calls});
}
