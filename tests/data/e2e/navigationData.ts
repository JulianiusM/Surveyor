/**
 * Test data for navigation and UI E2E tests
 * Data-driven test cases for page navigation, UI elements, and accessibility
 */

/**
 * Test cases for home page structure
 */
export const homePageData = [
    {
        description: 'home page loads correctly',
        url: '/',
        expectedBodyAttached: true,
        expectedLoginLinkVisible: true,
        loginLinkSelector: 'nav',
    },
];

/**
 * Test cases for navigation bar items (authenticated and unauthenticated states)
 */
export const navigationBarData = [
    {
        description: 'navigation bar shows create survey link when authenticated',
        isAuthenticated: true,
        linkName: /create survey/i,
        shouldBeVisible: true,
    },
    {
        description: 'navigation bar shows create packing link when authenticated',
        isAuthenticated: true,
        linkName: /create packing/i,
        shouldBeVisible: true,
    },
    {
        description: 'navigation bar shows create activity link when authenticated',
        isAuthenticated: true,
        linkName: /create activity/i,
        shouldBeVisible: true,
    },
    {
        description: 'navigation bar shows create drivers link when authenticated',
        isAuthenticated: true,
        linkName: /create drivers/i,
        shouldBeVisible: true,
    },
];

/**
 * Test cases for dashboard entity sections
 */
export const dashboardEntitySectionsData = [
    {
        description: 'dashboard shows surveys section',
        sectionText: /your surveys/i,
    },
    {
        description: 'dashboard shows packing lists section',
        sectionText: /your packing lists/i,
    },
    {
        description: 'dashboard shows activity plans section',
        sectionText: /your activity plans/i,
    },
    {
        description: 'dashboard shows drivers lists section',
        sectionText: /your drivers lists/i,
    },
];

/**
 * Test cases for responsive design
 */
export const responsiveDesignData = [
    {
        description: 'page is responsive and accessible',
        url: '/',
        viewportMetaName: 'viewport',
        expectedContent: 'width=device-width',
    },
];

/**
 * Test cases for footer links
 */
export const footerLinksData = [
    {
        description: 'footer contains imprint link',
        linkName: /imprint/i,
    },
    {
        description: 'footer contains privacy policy link',
        linkName: /privacy policy/i,
    },
];

/**
 * Test cases for page titles
 */
export const pageTitlesData = [
    {
        description: 'login page has appropriate title',
        url: '/users/login',
        expectedTitle: /login|surveyor/i,
    },
    {
        description: 'register page has appropriate title',
        url: '/users/register',
        expectedTitle: /register|surveyor/i,
    },
];

/**
 * Test cases for logo and branding
 */
export const logoData = [
    {
        description: 'logo is present and links to home',
        logoHref: '/',
        expectVisible: true,
    },
];

/**
 * Test cases for form accessibility
 */
export const formAccessibilityData = [
    {
        description: 'login form has proper labels',
        url: '/users/login',
        labels: [
            { for: 'username' },
            { for: 'password' },
        ],
    },
];

/**
 * Test cases for entity navigation flow
 */
export const entityNavigationFlowData = [
    {
        description: 'can navigate between different entity creation pages',
        steps: [
            { linkName: /create survey/i, expectedUrl: /\/survey\/create/ },
            { linkName: /create packing/i, expectedUrl: /\/packing\/create/ },
            { linkName: /create activity/i, expectedUrl: /\/activity\/create/ },
            { linkName: /create drivers/i, expectedUrl: /\/drivers\/create/ },
        ],
        finalStep: {
            url: '/users/dashboard',
            expectedHeading: /welcome/i,
        },
    },
];

/**
 * Test cases for browser back button
 */
export const browserBackButtonData = [
    {
        description: 'browser back button navigates correctly',
        startUrl: '/survey/create',
        expectedUrlAfterBack: /\/users\/dashboard/,
    },
];
