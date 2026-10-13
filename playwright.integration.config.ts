import {defineConfig, devices} from '@playwright/test';
import * as dotenv from 'dotenv';

// Preserve the source suite's existing explicit environment selector and legacy
// opt-in flag. Loading configuration does not initialize or alter its schema.
dotenv.config({path: process.env.E2E_DOTENV_FILE ?? '.env.e2e'});

// Source-runtime integration uses an explicitly supplied development server and
// its owned disposable schema. It starts no process and never resets a database;
// the built-application E2E runner retains those separate responsibilities.
export default defineConfig({
    testDir: 'tests/integration/browser',
    testMatch: '**/*.spec.ts',
    outputDir: 'test-results/browser-integration',
    timeout: 30_000,
    expect: {timeout: 5_000},
    fullyParallel: false,
    workers: 1,
    reporter: [['list'], ['html', {open: 'never', outputFolder: 'playwright-report/browser-integration'}]],
    use: {
        // Preserve the existing selected-server URL; no implicit built-server
        // startup can replace the caller's owned development target.
        baseURL: process.env.ROOT_URL ?? `http://localhost:${process.env.APP_PORT ?? '3001'}`,
        extraHTTPHeaders: {Connection: 'close'},
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'off',
    },
    projects: [{name: 'chromium-integration', use: {...devices['Desktop Chrome']}}],
});
