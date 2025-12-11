// e2e/navigation.test.ts
// Tests for general navigation, UI elements, and user flow
// Migrated to data-driven and keyword-driven testing approach.

import {expect, test} from '@playwright/test';

import {testCredentials} from '../data/e2e/authData';

// Import test data
import {
    browserBackButtonData,
    dashboardEntitySectionsData,
    footerLinksData,
    formAccessibilityData,
    homePageData,
    logoData,
    pageTitlesData,
    responsiveDesignData,
} from '../data/e2e/navigationData';

// Import keywords
import {loginUser} from '../keywords/e2e/authKeywords';
import {
    goBackAndVerify,
    navigateAndVerify,
    verifyLabelExists,
    verifyLinkVisible,
    verifyMetaTagContent,
    verifyPageTitle,
    verifySelectorVisible,
    verifyTextVisible,
} from '../keywords/e2e/navigationKeywords';

test.beforeEach(async ({context}) => {
    await context.clearCookies();
});

// 1) Home page loads correctly
for (const data of homePageData) {
    test(data.description, async ({page}) => {
        await navigateAndVerify(page, data.url);

        if (data.expectedLoginLinkVisible) {
            await verifyLinkVisible(page, /login/i, data.loginLinkSelector);
        }
    });
}

// 3) Dashboard shows entity counts
for (const data of dashboardEntitySectionsData) {
    test(data.description, async ({page}) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await verifyTextVisible(page, data.sectionText);
    });
}

// 4) Page is responsive and accessible
for (const data of responsiveDesignData) {
    test(data.description, async ({page}) => {
        await page.goto(data.url);
        await verifyMetaTagContent(page, data.viewportMetaName, data.expectedContent);
    });
}

// 5) Footer contains required links
for (const data of footerLinksData) {
    test(data.description, async ({page}) => {
        await page.goto(data.footerUrl);
        const footer = page.locator(data.footerSelector);
        await verifySelectorVisible(page, data.footerSelector);
        await expect(footer.getByRole('link', {name: data.linkName})).toBeVisible();
    });
}

// 6) Pages have appropriate titles
for (const data of pageTitlesData) {
    test(data.description, async ({page}) => {
        await page.goto(data.url);
        await verifyPageTitle(page, data.expectedTitle);
    });
}

// 7) Logo is present and links to home
for (const data of logoData) {
    test(data.description, async ({page}) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        const logoLink = page.locator(`a[href="${data.logoHref}"]`).first();
        if (data.expectVisible) {
            await expect(logoLink).toBeVisible();
        }
    });
}

// 8) Login form has proper labels
for (const data of formAccessibilityData) {
    test(data.description, async ({page}) => {
        await page.goto(data.url);
        for (const label of data.labels) {
            await verifyLabelExists(page, label.for);
        }
    });
}

// 10) Browser back button navigates correctly
for (const data of browserBackButtonData) {
    test(data.description, async ({page}) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await page.goto(data.startUrl);
        await goBackAndVerify(page, data.expectedUrlAfterBack);
    });
}
