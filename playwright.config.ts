import type {ReporterDescription} from '@playwright/test';
import {defineConfig, devices} from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config({path: process.env.E2E_DOTENV_FILE ?? '.env.e2e'});

const PORT = Number.parseInt(process.env.APP_PORT ?? '3001', 10);
const BASE_URL = process.env.ROOT_URL ?? `http://localhost:${PORT}`;
const IS_CI = process.env.CI === 'true' || process.env.CI === '1';
const HTML_REPORT_DIR = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? 'playwright-report';
let junitReporter: ReporterDescription | null = null;
if (process.env.PLAYWRIGHT_JUNIT_OUTPUT) {
    junitReporter = ['junit', {outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT}];
} else if (IS_CI) {
    junitReporter = ['junit'];
}

const reporters: ReporterDescription[] = IS_CI || junitReporter
    ? [[IS_CI ? 'line' : 'list'], ...(junitReporter ? [junitReporter] : []), ['html', {
        open: 'never',
        outputFolder: HTML_REPORT_DIR
    }]]
    : [['list'], ['html', {open: 'never'}]];

export default defineConfig({
    testDir: 'tests/e2e',
    testMatch: '**/*.spec.ts',
    timeout: 30_000,
    expect: {timeout: 5_000},
    fullyParallel: true,
    // Parallel system runs on Windows have exited in the native worker runtime
    // without an assertion result. Default to the measured one-worker mode there;
    // the precise native cause remains unknown. Explicit CLI overrides still work,
    // and Linux CI retains its existing two-worker selection and in-test races.
    workers: process.platform === 'win32' ? 1 : undefined,
    reporter: reporters,
    use: {
        baseURL: BASE_URL,
        // Playwright pools API sockets across actor contexts without an idle deadline.
        // Close transports to avoid server idle-expiry races, keeping commands single attempts.
        // The runner supplies these headers to both fixtures and additional actor contexts.
        extraHTTPHeaders: {Connection: 'close'},
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'off',
    },
    webServer: {
        command: 'npm run e2e:init',
        // Historical fixtures must only change lifecycle when a test requests it.
        // E2E owns the built server. A selected dotenv file or inherited HMR flag
        // must not replace its production assets with a source-development renderer.
        env: {
            AUTO_ARCHIVE_ENABLED: 'false', NODE_ENV: 'e2e', SURVEYOR_FRONTEND_DEV: '0',
            // Exercise production delivery failure against a refused local socket.
            // System fixtures must never send activation/recovery mail externally.
            E2E_SMTP_HOST: '127.0.0.1', E2E_SMTP_PORT: '1', E2E_SMTP_SECURE: 'false', E2E_SMTP_POOL: 'false',
        },
        url: `${BASE_URL}/healthz`,
        // Reusing an arbitrary local process would lose proof of the system-test
        // boundary. Source-server checks use playwright.integration.config.ts.
        reuseExistingServer: false,
        timeout: 180_000,
        stderr: 'pipe',
        stdout: 'pipe',
    },
    projects: [
        {name: 'chromium', use: {...devices['Desktop Chrome']}},
    ],
});
