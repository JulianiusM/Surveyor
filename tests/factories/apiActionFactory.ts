import type {Request} from 'express';
import type {performAPIAction} from '../../src/modules/lib/util';

type ApiAction = Parameters<typeof performAPIAction>[1];

export interface ApiActionCase {
    description: string;
    request: Request;
    expectedBody?: Request['body'];
    expectedProfileId?: string;
    expectedError?: {
        message: string;
        status: number;
    };
}

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

export function createApiActionCase(overrides: Partial<ApiActionCase> = {}): ApiActionCase {
    const profileId = 'profile-1';
    const request = createApiRequest({profileId});

    return {
        description: 'passes the request body and profile id to the API action',
        request,
        expectedBody: request.body,
        expectedProfileId: profileId,
        ...overrides,
    };
}

export function createRecordingAction(): ApiAction & {calls: {body: Request['body']; profileId: string}[]} {
    const calls: {body: Request['body']; profileId: string}[] = [];
    const action = async (body: Request['body'], profileId: string): Promise<void> => {
        calls.push({body, profileId});
    };

    return Object.assign(action, {calls});
}
