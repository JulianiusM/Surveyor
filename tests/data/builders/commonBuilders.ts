/**
 * Common test data builders and utilities for creating test data consistently.
 * These builders use the Builder pattern to create test objects with sensible defaults.
 */

/**
 * Counter for generating unique test identifiers
 */
let counter = 0;

/**
 * Reset the counter (useful for test isolation)
 */
export function resetCounter(): void {
    counter = 0;
}

/**
 * Get next unique ID
 */
export function nextId(): number {
    return ++counter;
}

/**
 * Generate a unique test string with optional prefix
 */
export function uniqueString(prefix = 'test'): string {
    return `${prefix}_${nextId()}_${Date.now()}`;
}

/**
 * Generate a mock UUID for testing
 */
export function mockUuid(prefix = '00000000-0000-4000-8000'): string {
    const suffix = nextId().toString().padStart(12, '0');
    return `${prefix}-${suffix}`;
}

/**
 * Builder for creating user test data
 */
export class UserBuilder {
    private data: any = {
        id: nextId(),
        username: uniqueString('user'),
        email: `${uniqueString('user')}@example.com`,
        name: 'Test User',
        isActive: true,
        isAdmin: false,
    };

    withId(id: number): this {
        this.data.id = id;
        return this;
    }

    withUsername(username: string): this {
        this.data.username = username;
        return this;
    }

    withEmail(email: string): this {
        this.data.email = email;
        return this;
    }

    withName(name: string): this {
        this.data.name = name;
        return this;
    }

    asActive(): this {
        this.data.isActive = true;
        return this;
    }

    asInactive(): this {
        this.data.isActive = false;
        return this;
    }

    asAdmin(): this {
        this.data.isAdmin = true;
        return this;
    }

    asRegularUser(): this {
        this.data.isAdmin = false;
        return this;
    }

    build(): any {
        return { ...this.data };
    }
}

/**
 * Builder for creating guest test data
 */
export class GuestBuilder {
    private data: any = {
        id: nextId(),
        username: uniqueString('guest'),
    };

    withId(id: number): this {
        this.data.id = id;
        return this;
    }

    withUsername(username: string): this {
        this.data.username = username;
        return this;
    }

    build(): any {
        return { ...this.data };
    }
}

/**
 * Builder for creating session test data
 */
export class SessionBuilder {
    private data: any = {};

    withUser(user?: any): this {
        if (user) {
            this.data.user = user;
        } else {
            this.data.user = new UserBuilder().build();
        }
        return this;
    }

    withGuest(guest?: any): this {
        if (guest) {
            this.data.guest = guest;
        } else {
            this.data.guest = new GuestBuilder().build();
        }
        return this;
    }

    withUserId(userId: number): this {
        if (!this.data.user) {
            this.data.user = {};
        }
        this.data.user.id = userId;
        return this;
    }

    withGuestId(guestId: number): this {
        if (!this.data.guest) {
            this.data.guest = {};
        }
        this.data.guest.id = guestId;
        return this;
    }

    asUnauthenticated(): this {
        this.data = {};
        return this;
    }

    build(): any {
        return { ...this.data };
    }
}

/**
 * Builder for creating Express request mock
 */
export class RequestBuilder {
    private data: any = {
        body: {},
        params: {},
        query: {},
        session: {},
        flash: jest.fn(),
    };

    withBody(body: any): this {
        this.data.body = body;
        return this;
    }

    withParams(params: any): this {
        this.data.params = params;
        return this;
    }

    withQuery(query: any): this {
        this.data.query = query;
        return this;
    }

    withSession(session: any): this {
        this.data.session = session;
        return this;
    }

    withResource(resource: any): this {
        this.data.resource = resource;
        return this;
    }

    withAdditional(additional: any[]): this {
        this.data.additional = additional;
        return this;
    }

    build(): any {
        return this.data;
    }
}

/**
 * Builder for creating Express response mock
 */
export class ResponseBuilder {
    private data: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
        redirect: jest.fn().mockReturnThis(),
        render: jest.fn().mockReturnThis(),
    };

    build(): any {
        return this.data;
    }
}

/**
 * Convenience functions for creating common test objects
 */
export const testData = {
    user: (overrides?: any) => new UserBuilder().build(),
    guest: (overrides?: any) => new GuestBuilder().build(),
    session: (overrides?: any) => new SessionBuilder().build(),
    userSession: (userId?: number) => {
        const builder = new SessionBuilder().withUser();
        if (userId !== undefined) {
            builder.withUserId(userId);
        }
        return builder.build();
    },
    guestSession: (guestId?: number) => {
        const builder = new SessionBuilder().withGuest();
        if (guestId !== undefined) {
            builder.withGuestId(guestId);
        }
        return builder.build();
    },
    request: (overrides?: any) => new RequestBuilder().build(),
    response: () => new ResponseBuilder().build(),
};

/**
 * Helper to create a date string in ISO format
 */
export function isoDate(dateString: string): string {
    return new Date(dateString).toISOString();
}

/**
 * Helper to create a date string in local ISO format (YYYY-MM-DD)
 */
export function localDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
}

/**
 * Helper to create a local datetime string (YYYY-MM-DDTHH:MM:SS)
 */
export function localDateTime(dateString: string): string {
    return new Date(dateString).toISOString().slice(0, 19);
}
