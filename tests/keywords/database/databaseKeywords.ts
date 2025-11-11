/**
 * Keywords for database integration tests
 */

import request from 'supertest';
import type { Application } from 'express';
import { AppDataSource } from '../../../src/modules/database/dataSource';
import { User } from '../../../src/modules/database/entities/user/User';
import { Guest } from '../../../src/modules/database/entities/user/Guest';
import { GuestLink } from '../../../src/modules/database/entities/user/GuestLink';

/**
 * Make HTTP request and verify status code
 */
export async function makeRequest(
    app: Application,
    method: string,
    path: string,
    expectedStatus: number
): Promise<request.Response> {
    const req = request(app);
    let response: request.Response;
    
    switch (method.toUpperCase()) {
        case 'GET':
            response = await req.get(path);
            break;
        case 'POST':
            response = await req.post(path);
            break;
        case 'PUT':
            response = await req.put(path);
            break;
        case 'DELETE':
            response = await req.delete(path);
            break;
        default:
            throw new Error(`Unsupported HTTP method: ${method}`);
    }
    
    expect(response.status).toBe(expectedStatus);
    return response;
}

/**
 * Verify response text matches pattern
 */
export function verifyTextMatch(response: request.Response, pattern: RegExp): void {
    expect(response.text).toMatch(pattern);
}

/**
 * Create a user in the database
 */
export async function createTestUser(userData: {
    id: number;
    username: string;
    name: string;
    email: string;
}) {
    const user = AppDataSource.getRepository(User).create(userData);
    return await AppDataSource.getRepository(User).save(user);
}

/**
 * Create a guest in the database
 */
export async function createTestGuest(guestData: {
    id: number;
    username: string;
}) {
    const guest = AppDataSource.getRepository(Guest).create(guestData);
    return await AppDataSource.getRepository(Guest).save(guest);
}

/**
 * Create a guest link in the database
 */
export async function createGuestLink(config: {
    guestId: number;
    entityType: string;
    entityId: number;
    token: string;
}) {
    return await AppDataSource.getRepository(GuestLink).save({
        guest: { id: config.guestId },
        entityType: config.entityType,
        entityId: config.entityId,
        token: config.token,
    });
}

/**
 * Verify that combinations are in expected order
 */
export function verifyCombinationsOrder(
    combinations: Array<{ weekday: string; nthWeek: string }>,
    expectedOrder: Array<[string, string]>
) {
    const actualOrder = combinations.map(c => [c.weekday, c.nthWeek]);
    expect(actualOrder).toEqual(expectedOrder);
}

/**
 * Verify grouped responses have expected structure
 */
export function verifyGroupedResponses(
    grouped: Record<string, any[]>,
    expectedKeys: string[]
) {
    expect(Object.keys(grouped).sort()).toEqual(expectedKeys.sort());
}

/**
 * Verify answers for a principal
 */
export function verifyAnswers(
    grouped: Record<string, any[]>,
    principalKey: string,
    expectedAnswers: string[]
) {
    const answers = grouped[principalKey]?.map(i => i.answer).sort() || [];
    expect(answers).toEqual(expectedAnswers.sort());
}
