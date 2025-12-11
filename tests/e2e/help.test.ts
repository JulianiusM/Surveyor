import {test, expect} from '@playwright/test';
import {loginUser} from '../keywords/e2e/authKeywords';
import {helpNavigationData, helpDocsData, helpButtonData} from '../data/e2e/helpData';
import {testCredentials} from '../data/e2e/authData';

test.describe('Help System', () => {
    test.beforeEach(async ({page}) => {
        // Clear cookies to start fresh
        await page.context().clearCookies();
    });

    test.describe('Help Navigation', () => {
        for (const data of helpNavigationData) {
            test(data.description, async ({page}) => {
                await page.goto('/');
                
                // Click help link in navigation
                await page.getByRole('link', {name: data.navLinkText}).click();
                
                // Verify we're on the help page
                await expect(page).toHaveURL(data.expectedUrl);
                
                // Verify the help index is displayed
                await expect(page.getByRole('heading', {name: data.expectedHeading, level: 1})).toBeVisible();
            });
        }
    });

    test.describe('Help Documentation Pages', () => {
        for (const data of helpDocsData) {
            test(data.description, async ({page}) => {
                await page.goto(`/help/${data.docName}`);
                
                // Verify the document title is displayed
                await expect(page.getByRole('heading', {name: data.expectedTitle, level: 1})).toBeVisible();
                
                // Verify sidebar navigation is present
                await expect(page.getByText('Documentation')).toBeVisible();
                
                // Verify there are doc links in the sidebar
                await expect(page.locator('.list-group-item').first()).toBeVisible();
            });
        }
    });

    test.describe('Contextual Help Buttons', () => {
        for (const data of helpButtonData) {
            test(data.description, async ({page}) => {
                await loginUser(page, testCredentials.username, testCredentials.password);
                
                // Navigate to create page
                await page.goto(data.createUrl);
                
                // Find and click the help button
                await page.getByRole('link', {name: /help/i}).first().click();
                
                // Verify we're on the correct help page
                await expect(page).toHaveURL(data.helpUrl);
            });
        }
    });

    test('should navigate between help docs using sidebar', async ({page}) => {
        await page.goto('/help');
        
        // Click on "Getting Started" in the sidebar
        await page.getByRole('link', {name: /Getting Started/i}).click();
        
        // Verify we navigated to the getting started page
        await expect(page).toHaveURL(/\/help\/getting_started/i);
        await expect(page.getByRole('heading', {name: /Getting Started/i, level: 1})).toBeVisible();
        
        // Click on "Surveys" in the sidebar
        await page.getByRole('link', {name: /Surveys/i}).first().click();
        
        // Verify we navigated to the surveys page
        await expect(page).toHaveURL(/\/help\/surveys/i);
        await expect(page.getByRole('heading', {name: /Surveys/i, level: 1})).toBeVisible();
    });

    test('should render markdown content correctly', async ({page}) => {
        await page.goto('/help/getting_started');
        
        // Check that markdown is rendered as HTML
        // Headings should be rendered
        await expect(page.locator('h2').first()).toBeVisible();
        
        // Links should be rendered
        await expect(page.locator('a').first()).toBeVisible();
        
        // Paragraphs should be rendered
        await expect(page.locator('p').first()).toBeVisible();
    });
});
