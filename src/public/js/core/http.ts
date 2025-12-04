/**
 * Core HTTP client utilities
 * Provides a consistent API for making HTTP requests across the application
 */

/**
 * Make an HTTP request
 * @param method HTTP method (GET, POST, DELETE, etc.)
 * @param url Request URL
 * @param body Request body (optional)
 * @returns Response data
 */
export async function http(method: string, url: string, body?: any): Promise<any> {
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await fetch(url, {
        method,
        headers: isFormData ? {'X-Requested-With': 'XMLHttpRequest'} : {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'same-origin',
        body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `HTTP ${res.status}`);
    }

    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    
    if (data?.status === 'error') {
        throw new Error(data.message || 'Request failed');
    }
    
    return data;
}

/**
 * Make a POST request to an API endpoint (prefixed with /api)
 * @param url API endpoint path
 * @param payload Request payload
 * @returns Response data
 */
export async function post(url: string, payload: any = {}): Promise<any> {
    return http('POST', '/api' + url, payload);
}

/**
 * Make a GET request
 * @param url Request URL
 * @returns Response data
 */
export async function get(url: string): Promise<any> {
    return http('GET', url);
}

/**
 * Make a DELETE request
 * @param url Request URL
 * @param body Request body (optional)
 * @returns Response data
 */
export async function del(url: string, body?: any): Promise<any> {
    return http('DELETE', url, body);
}
