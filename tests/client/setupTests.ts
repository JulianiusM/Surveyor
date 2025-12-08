// tests/client/setupTests.ts
// Global test setup for frontend tests
import '@testing-library/jest-dom';

// Import polyfills first before anything else
import { TextEncoder, TextDecoder } from 'util';
import { ReadableStream, TransformStream, WritableStream } from 'stream/web';
import { MessageChannel, BroadcastChannel } from 'worker_threads';

// Set up global polyfills BEFORE importing undici
global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;
(global as any).ReadableStream = ReadableStream;
(global as any).WritableStream = WritableStream;
(global as any).TransformStream = TransformStream;
(global as any).MessageChannel = MessageChannel;
(global as any).MessagePort = MessageChannel.prototype as any;
(global as any).BroadcastChannel = BroadcastChannel;

// Now import fetch polyfills from undici
import { fetch, Request, Response, Headers, FormData } from 'undici';

// Set fetch globals
global.fetch = fetch as any;
global.Request = Request as any;
global.Response = Response as any;
global.Headers = Headers as any;
global.FormData = FormData as any;

// Now import MSW server after all polyfills are in place
import { server } from './msw/server';

/**
 * Setup MSW server for mocking HTTP requests
 * This runs before all tests and intercepts fetch/XHR calls
 */

// Start server before all tests
beforeAll(() => {
    server.listen({
        // Fail tests if an unhandled request is made
        // This ensures we mock all HTTP calls
        onUnhandledRequest: 'error',
    });
});

// Reset handlers after each test to avoid test interdependencies
afterEach(() => {
    server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
    server.close();
});

/**
 * Mock window.Surveyor global object
 * This is injected by the backend in production but needs to be mocked in tests
 */
beforeEach(() => {
    // Initialize window.Surveyor if it doesn't exist
    if (!window.Surveyor) {
        (window as any).Surveyor = {};
    }
    
    // Reset to clean state for each test
    window.Surveyor = {
        rawPermissions: undefined,
        permissions: undefined,
    };
});

/**
 * Mock jQuery if needed (some frontend code uses it)
 * You can expand this as needed for your specific use cases
 */
declare global {
    interface Window {
        Surveyor: {
            rawPermissions?: string;
            permissions?: any;
            [key: string]: any;
        };
        $?: any;
        jQuery?: any;
        bootstrap?: any;
    }
}

/**
 * Suppress console errors in tests unless explicitly testing error handling
 * Uncomment the lines below if you want to silence console output in tests
 */
// const originalError = console.error;
// beforeAll(() => {
//     console.error = jest.fn();
// });
// afterAll(() => {
//     console.error = originalError;
// });
