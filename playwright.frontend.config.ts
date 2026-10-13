import type {ReporterDescription} from '@playwright/test';
import {defineConfig, devices} from '@playwright/test';

// Client browser fixtures own every document/asset/read response. This runner
// deliberately has no application process, environment loader or database setup;
// genuine built-server workflows remain in the separate E2E runner.
const isCi = process.env.CI === 'true' || process.env.CI === '1';
const reporters: ReporterDescription[] = [[isCi ? 'line' : 'list'], ['html', {
    open: 'never', outputFolder: process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? 'playwright-report/frontend',
}]];
if (process.env.PLAYWRIGHT_JUNIT_OUTPUT) {
    reporters.push(['junit', {outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT}]);
}

export default defineConfig({
    testDir: 'tests/frontend/browser',
    testMatch: '**/*.spec.ts',
    outputDir: 'test-results/frontend',
    timeout: 30_000,
    expect: {timeout: 5_000},
    fullyParallel: true,
    reporter: reporters,
    use: {
        baseURL: 'http://surveyor-client.test',
        // A fixture must never depend on an application or an external resource.
        // Asset delivery and refusal of commands remain explicit in each fixture.
        serviceWorkers: 'block',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'off',
    },
    projects: [{name: 'chromium-client', use: {...devices['Desktop Chrome']}}],
});
