// tests/client/flows/event-registration.test.ts
// Flow tests for event registration with mocked backend
import { screen, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { server } from '../msw/server';
import { http, HttpResponse } from 'msw';
import { post, get } from '../../../src/public/js/core/http';

describe('event registration flow', () => {
    describe('successful registration', () => {
        test('registers user for event', async () => {
            // Mock successful registration
            server.use(
                http.post('/api/event/123/register', async ({ request }) => {
                    const body = await request.json();
                    return HttpResponse.json({
                        status: 'success',
                        message: 'Successfully registered',
                        data: { eventId: '123', ...body },
                    });
                })
            );

            const result = await post('/api/event/123/register', {
                userId: 1,
                preferences: { dietary: 'vegetarian' },
            });

            expect(result.status).toBe('success');
            expect(result.message).toBe('Successfully registered');
            expect(result.data.eventId).toBe('123');
        });

        test('handles registration with guest information', async () => {
            server.use(
                http.post('/api/event/456/register', async ({ request }) => {
                    const body = await request.json() as any;
                    
                    // Validate guest data
                    if (!body.guestName || !body.guestEmail) {
                        return HttpResponse.json({
                            status: 'error',
                            message: 'Guest name and email are required',
                        }, { status: 400 });
                    }
                    
                    return HttpResponse.json({
                        status: 'success',
                        message: 'Guest registered successfully',
                        data: body,
                    });
                })
            );

            const result = await post('/api/event/456/register', {
                guestName: 'John Doe',
                guestEmail: 'john@example.com',
                preferences: {},
            });

            expect(result.status).toBe('success');
            expect(result.message).toBe('Guest registered successfully');
        });

        test('allows registration cancellation', async () => {
            server.use(
                http.post('/api/event/123/register/delete', () => {
                    return HttpResponse.json({
                        status: 'success',
                        message: 'Registration cancelled',
                    });
                })
            );

            const result = await post('/api/event/123/register/delete');

            expect(result.status).toBe('success');
            expect(result.message).toBe('Registration cancelled');
        });
    });

    describe('registration validation', () => {
        test('rejects registration without required fields', async () => {
            server.use(
                http.post('/api/event/123/register', () => {
                    return HttpResponse.json({
                        status: 'error',
                        message: 'Missing required fields',
                    }, { status: 400 });
                })
            );

            await expect(
                post('/api/event/123/register', {})
            ).rejects.toThrow('Missing required fields');
        });

        test('rejects invalid email format', async () => {
            server.use(
                http.post('/api/event/123/register', async ({ request }) => {
                    const body = await request.json() as any;
                    
                    if (body.email && !body.email.includes('@')) {
                        return HttpResponse.json({
                            status: 'error',
                            message: 'Invalid email format',
                        }, { status: 400 });
                    }
                    
                    return HttpResponse.json({ status: 'success' });
                })
            );

            await expect(
                post('/api/event/123/register', { email: 'invalid-email' })
            ).rejects.toThrow('Invalid email format');
        });

        test('handles duplicate registration gracefully', async () => {
            server.use(
                http.post('/api/event/123/register', () => {
                    return HttpResponse.json({
                        status: 'error',
                        message: 'You are already registered for this event',
                    }, { status: 409 });
                })
            );

            await expect(
                post('/api/event/123/register', { userId: 1 })
            ).rejects.toThrow('You are already registered for this event');
        });
    });

    describe('multi-step registration', () => {
        test('completes registration flow: check event -> register -> confirm', async () => {
            // Step 1: Get event details
            server.use(
                http.get('/api/event/789', () => {
                    return HttpResponse.json({
                        status: 'success',
                        data: {
                            id: '789',
                            title: 'Summer Camp 2025',
                            startDate: '2025-07-01',
                            endDate: '2025-07-07',
                            registrationOpen: true,
                        },
                    });
                })
            );

            // Use GET method since we're just fetching event details
            const eventData = await get('/api/event/789');
            expect(eventData.data.title).toBe('Summer Camp 2025');
            expect(eventData.data.registrationOpen).toBe(true);

            // Step 2: Register for event
            server.use(
                http.post('/api/event/789/register', () => {
                    return HttpResponse.json({
                        status: 'success',
                        message: 'Registration successful',
                        data: { registrationId: 'reg-123' },
                    });
                })
            );

            const registration = await post('/api/event/789/register', {
                userId: 1,
                arrivalDate: '2025-07-01',
                departureDate: '2025-07-07',
            });

            expect(registration.status).toBe('success');
            expect(registration.data.registrationId).toBe('reg-123');

            // Step 3: Verify registration was saved
            server.use(
                http.get('/api/event/789', () => {
                    return HttpResponse.json({
                        status: 'success',
                        data: {
                            id: '789',
                            title: 'Summer Camp 2025',
                            userRegistered: true,
                            registrationId: 'reg-123',
                        },
                    });
                })
            );

            const updatedEvent = await get('/api/event/789');
            expect(updatedEvent.data.userRegistered).toBe(true);
        });

        test('handles registration with preferences and updates', async () => {
            // Initial registration
            server.use(
                http.post('/api/event/456/register', async ({ request }) => {
                    const body = await request.json();
                    return HttpResponse.json({
                        status: 'success',
                        message: 'Registered',
                        data: { registrationId: 'reg-456', ...body },
                    });
                })
            );

            const initialReg = await post('/api/event/456/register', {
                userId: 1,
                preferences: { dietary: 'vegetarian' },
            });

            expect(initialReg.data.preferences.dietary).toBe('vegetarian');

            // Update preferences
            server.use(
                http.post('/api/event/456/update', async ({ request }) => {
                    const body = await request.json() as any;
                    return HttpResponse.json({
                        status: 'success',
                        message: 'Preferences updated',
                        data: { registrationId: 'reg-456', preferences: body.preferences },
                    });
                })
            );

            const update = await post('/api/event/456/update', {
                preferences: { dietary: 'vegan', roommate: 'John Doe' },
            });

            expect(update.data.preferences.dietary).toBe('vegan');
            expect(update.data.preferences.roommate).toBe('John Doe');
        });
    });

    describe('error handling', () => {
        test('handles server errors gracefully', async () => {
            server.use(
                http.post('/api/event/123/register', () => {
                    return HttpResponse.json({
                        status: 'error',
                        message: 'Internal server error',
                    }, { status: 500 });
                })
            );

            await expect(
                post('/api/event/123/register', { userId: 1 })
            ).rejects.toThrow('Internal server error');
        });

        test('handles network errors', async () => {
            server.use(
                http.post('/api/event/123/register', () => {
                    return HttpResponse.error();
                })
            );

            await expect(
                post('/api/event/123/register', { userId: 1 })
            ).rejects.toThrow();
        });

        test('handles closed registration', async () => {
            server.use(
                http.post('/api/event/123/register', () => {
                    return HttpResponse.json({
                        status: 'error',
                        message: 'Registration is closed for this event',
                    }, { status: 403 });
                })
            );

            await expect(
                post('/api/event/123/register', { userId: 1 })
            ).rejects.toThrow('Registration is closed for this event');
        });

        test('handles full event capacity', async () => {
            server.use(
                http.post('/api/event/123/register', () => {
                    return HttpResponse.json({
                        status: 'error',
                        message: 'Event is at full capacity',
                    }, { status: 409 });
                })
            );

            await expect(
                post('/api/event/123/register', { userId: 1 })
            ).rejects.toThrow('Event is at full capacity');
        });
    });

    describe('permission-based registration', () => {
        test('allows registration when user has authentication cookie', async () => {
            // In a real app, auth is handled by session cookies, not headers
            // This test just verifies successful registration flow
            server.use(
                http.post('/api/event/123/register', () => {
                    return HttpResponse.json({
                        status: 'success',
                        message: 'Registered successfully',
                    });
                })
            );

            const result = await post('/api/event/123/register', { userId: 1 });
            expect(result.status).toBe('success');
        });

        test('rejects registration without authentication', async () => {
            server.use(
                http.post('/api/event/123/register', () => {
                    return HttpResponse.json({
                        status: 'error',
                        message: 'Authentication required',
                    }, { status: 401 });
                })
            );

            await expect(
                post('/api/event/123/register', {})
            ).rejects.toThrow('Authentication required');
        });
    });
});
