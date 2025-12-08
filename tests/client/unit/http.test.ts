// tests/client/unit/http.test.ts
// Unit tests for core/http.ts utilities
import { http, get, post, del, patch } from '../../../src/public/js/core/http';
import { server } from '../msw/server';
import { http as mswHttp, HttpResponse } from 'msw';

describe('HTTP client utilities', () => {
    describe('http', () => {
        test('makes successful GET request', async () => {
            server.use(
                mswHttp.get('/api/test', () => {
                    return HttpResponse.json({ status: 'success', data: 'test data' });
                })
            );

            const result = await http('GET', '/api/test');
            expect(result.status).toBe('success');
            expect(result.data).toBe('test data');
        });

        test('makes successful POST request with JSON body', async () => {
            server.use(
                mswHttp.post('/api/test', async ({ request }) => {
                    const body = await request.json();
                    return HttpResponse.json({ status: 'success', data: body });
                })
            );

            const result = await http('POST', '/api/test', { foo: 'bar' });
            expect(result.status).toBe('success');
            expect(result.data.foo).toBe('bar');
        });

        test('includes correct headers for JSON requests', async () => {
            let capturedHeaders: Headers | null = null;
            
            server.use(
                mswHttp.post('/api/test', async ({ request }) => {
                    capturedHeaders = request.headers;
                    return HttpResponse.json({ status: 'success' });
                })
            );

            await http('POST', '/api/test', { foo: 'bar' });
            
            expect(capturedHeaders?.get('content-type')).toBe('application/json');
            expect(capturedHeaders?.get('x-requested-with')).toBe('XMLHttpRequest');
        });

        test('handles FormData body correctly', async () => {
            let capturedHeaders: Headers | null = null;
            
            server.use(
                mswHttp.post('/api/test', async ({ request }) => {
                    capturedHeaders = request.headers;
                    return HttpResponse.json({ status: 'success' });
                })
            );

            const formData = new FormData();
            formData.append('key', 'value');
            
            await http('POST', '/api/test', formData);
            
            // FormData should have multipart/form-data content-type with boundary
            expect(capturedHeaders?.get('content-type')).toContain('multipart/form-data');
            expect(capturedHeaders?.get('x-requested-with')).toBe('XMLHttpRequest');
        });

        test('throws error for HTTP error status', async () => {
            server.use(
                mswHttp.get('/api/test', () => {
                    return HttpResponse.json({ status: 'error', message: 'Not found' }, { status: 404 });
                })
            );

            await expect(http('GET', '/api/test')).rejects.toThrow('Not found');
        });

        test('throws error when response has error status', async () => {
            server.use(
                mswHttp.get('/api/test', () => {
                    return HttpResponse.json({ status: 'error', message: 'Something went wrong' });
                })
            );

            await expect(http('GET', '/api/test')).rejects.toThrow('Something went wrong');
        });

        test('throws generic error for HTTP error without message', async () => {
            server.use(
                mswHttp.get('/api/test', () => {
                    return new HttpResponse(null, { status: 500 });
                })
            );

            await expect(http('GET', '/api/test')).rejects.toThrow('HTTP 500');
        });

        test('parses JSON response', async () => {
            server.use(
                mswHttp.get('/api/test', () => {
                    return HttpResponse.json({ status: 'success', data: { nested: 'value' } });
                })
            );

            const result = await http('GET', '/api/test');
            expect(result.data.nested).toBe('value');
        });

        test('handles text response', async () => {
            server.use(
                mswHttp.get('/api/test', () => {
                    return new HttpResponse('Plain text response', {
                        headers: { 'Content-Type': 'text/plain' },
                    });
                })
            );

            const result = await http('GET', '/api/test');
            expect(result).toBe('Plain text response');
        });
    });

    describe('get', () => {
        test('makes GET request', async () => {
            server.use(
                mswHttp.get('/api/test', () => {
                    return HttpResponse.json({ status: 'success', data: 'get data' });
                })
            );

            const result = await get('/api/test');
            expect(result.status).toBe('success');
            expect(result.data).toBe('get data');
        });
    });

    describe('post', () => {
        test('makes POST request with payload', async () => {
            server.use(
                mswHttp.post('/api/test', async ({ request }) => {
                    const body = await request.json();
                    return HttpResponse.json({ status: 'success', data: body });
                })
            );

            const result = await post('/api/test', { key: 'value' });
            expect(result.status).toBe('success');
            expect(result.data.key).toBe('value');
        });

        test('makes POST request with empty payload', async () => {
            server.use(
                mswHttp.post('/api/test', () => {
                    return HttpResponse.json({ status: 'success' });
                })
            );

            const result = await post('/api/test');
            expect(result.status).toBe('success');
        });
    });

    describe('del', () => {
        test('makes DELETE request', async () => {
            server.use(
                mswHttp.delete('/api/test/123', () => {
                    return HttpResponse.json({ status: 'success', message: 'Deleted' });
                })
            );

            const result = await del('/api/test/123');
            expect(result.status).toBe('success');
            expect(result.message).toBe('Deleted');
        });

        test('makes DELETE request with body', async () => {
            server.use(
                mswHttp.delete('/api/test/123', async ({ request }) => {
                    const body = await request.json();
                    return HttpResponse.json({ status: 'success', data: body });
                })
            );

            const result = await del('/api/test/123', { reason: 'cleanup' });
            expect(result.status).toBe('success');
            expect(result.data.reason).toBe('cleanup');
        });
    });

    describe('patch', () => {
        test('makes PATCH request with payload', async () => {
            server.use(
                mswHttp.patch('/api/test/123', async ({ request }) => {
                    const body = await request.json();
                    return HttpResponse.json({ status: 'success', data: body });
                })
            );

            const result = await patch('/api/test/123', { updated: 'value' });
            expect(result.status).toBe('success');
            expect(result.data.updated).toBe('value');
        });

        test('makes PATCH request with empty payload', async () => {
            server.use(
                mswHttp.patch('/api/test/123', () => {
                    return HttpResponse.json({ status: 'success' });
                })
            );

            const result = await patch('/api/test/123');
            expect(result.status).toBe('success');
        });
    });

    describe('error handling', () => {
        test('handles network errors gracefully', async () => {
            server.use(
                mswHttp.get('/api/test', () => {
                    return HttpResponse.error();
                })
            );

            await expect(get('/api/test')).rejects.toThrow();
        });

        test('handles 404 errors', async () => {
            server.use(
                mswHttp.get('/api/notfound', () => {
                    return HttpResponse.json({ status: 'error', message: 'Not found' }, { status: 404 });
                })
            );

            await expect(get('/api/notfound')).rejects.toThrow('Not found');
        });

        test('handles 500 errors', async () => {
            server.use(
                mswHttp.get('/api/error', () => {
                    return HttpResponse.json({ status: 'error', message: 'Server error' }, { status: 500 });
                })
            );

            await expect(get('/api/error')).rejects.toThrow('Server error');
        });
    });
});
