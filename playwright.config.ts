import {defineConfig, devices} from '@playwright/test';
import * as dotenv from 'dotenv';

// Load E2E env before anything else
dotenv.config({path: process.env.E2E_DOTENV_FILE ?? '.env.e2e'});

const PORT = parseInt(process.env.APP_PORT ?? '3001', 10);
const BASE_URL = process.env.ROOT_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 30_000,
    expect: {timeout: 5_000},
    fullyParallel: true,
    reporter: [['list'], ['html', {open: 'never'}]],
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'off', // Disable video to avoid ffmpeg dependency
    },

    // Start your real server; we chain DB init before launching the app.
    webServer: {
        command: `npm run e2e:init`,
        url: `${BASE_URL}/healthz`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stderr: 'pipe',
        stdout: 'pipe',
    },

    projects: [
        {name: 'chromium', use: {...devices['Desktop Chrome']}},
        // Add firefox/webkit if you want cross-browser
    ],
});
