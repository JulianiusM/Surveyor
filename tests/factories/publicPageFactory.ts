export interface PublicPageCase {
    description: string;
    path: string;
    expectedStatus: number;
    expectedText: string;
    textMatch: 'contains' | 'exact';
}

export function createPublicPageCase(overrides: Partial<PublicPageCase> = {}): PublicPageCase {
    return {
        description: 'renders the public landing page',
        path: '/',
        expectedStatus: 200,
        expectedText: 'Organize and coordinate group activities',
        textMatch: 'contains',
        ...overrides,
    };
}
