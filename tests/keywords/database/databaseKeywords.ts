/**
 * Keywords for database integration tests
 */

import request from 'supertest';
import type { Application } from 'express';

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
