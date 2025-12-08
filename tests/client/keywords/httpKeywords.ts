/**
 * Test keywords for HTTP client and API mocking
 * Reusable test actions for HTTP client tests and flow tests
 */

import { server } from '../msw/server';
import { http, HttpResponse } from 'msw';
import { post, get, del, patch } from '../../../src/public/js/core/http';

/**
 * Setup a mock API endpoint
 */
export function setupMockEndpoint(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    url: string,
    response: any,
    status: number = 200
): void {
    const httpMethod = method === 'GET' ? http.get
        : method === 'POST' ? http.post
        : method === 'DELETE' ? http.delete
        : http.patch;
    
    server.use(
        httpMethod(url, () => {
            return HttpResponse.json(response, { status });
        })
    );
}

/**
 * Setup a mock endpoint with custom handler
 */
export function setupMockEndpointWithHandler(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    url: string,
    handler: (info: { request: Request }) => Response | Promise<Response>
): void {
    const httpMethod = method === 'GET' ? http.get
        : method === 'POST' ? http.post
        : method === 'DELETE' ? http.delete
        : http.patch;
    
    server.use(httpMethod(url, handler));
}

/**
 * Make API call and verify success response
 */
export async function expectApiSuccess(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    url: string,
    payload?: any,
    expectedStatus: string = 'success'
): Promise<any> {
    const httpCall = method === 'GET' ? get
        : method === 'POST' ? post
        : method === 'DELETE' ? del
        : patch;
    
    const result = payload !== undefined ? await httpCall(url, payload) : await httpCall(url);
    expect(result.status).toBe(expectedStatus);
    return result;
}

/**
 * Make API call and expect error
 */
export async function expectApiError(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    url: string,
    payload: any,
    expectedError: string
): Promise<void> {
    const httpCall = method === 'POST' ? post
        : method === 'DELETE' ? del
        : method === 'PATCH' ? patch
        : get;
    
    await expect(
        httpCall(url, payload)
    ).rejects.toThrow(expectedError);
}

/**
 * Verify response structure
 */
export function verifyResponseStructure(response: any, expectedKeys: string[]): void {
    expectedKeys.forEach(key => {
        expect(response).toHaveProperty(key);
    });
}

/**
 * Verify response data matches expected values
 */
export function verifyResponseData(response: any, expectedData: Record<string, any>): void {
    Object.entries(expectedData).forEach(([key, value]) => {
        expect(response.data).toHaveProperty(key, value);
    });
}
