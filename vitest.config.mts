import {defineConfig} from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// Node threads inherit the process timezone before Vitest applies test.env.
// Establish the existing UTC test contract before workers start, including on
// Windows; the per-worker value below also keeps that contract explicit.
process.env.TZ = 'UTC';

// Genuine server-component integration without persistence belongs to the
// database-free project only. One inventory drives both project selections.
const databaseFreeIntegrationFiles = [
    'tests/integration/frontend-development-runtime.spec.ts',
    'tests/integration/frontend-session-admission.spec.ts',
];

export default defineConfig({
    plugins: [vue()],
    test: {
        globals: false,
        environment: 'node',
        // Date fixtures and the database contract use UTC, as CI already does.
        // Apply that contract in each worker so a developer's local zone cannot
        // turn an unchanged serializer into a misleading regression failure.
        env: {TZ: 'UTC'},
        // Database-free files have isolated workers and restore their own globals.
        // Bound concurrency for ordinary two-core CI runners instead of serializing
        // those files behind a restriction required only by the shared test schema.
        isolate: true,
        // Keep a fresh JavaScript isolate per file in bounded threads. Paired
        // coverage runs spent much less time preparing controller/entity imports
        // than forks, including serialized real persistence checks. The separate
        // integration project still owns only one schema-resetting worker.
        pool: 'threads',
        maxWorkers: 2,
        hookTimeout: 30_000,
        setupFiles: ['tests/support/env.ts'],
        projects: [
            {
                extends: true,
                test: {
                    name: 'database-free',
                    include: ['tests/unit/**/*.spec.ts', 'tests/frontend/**/*.spec.ts',
                        ...databaseFreeIntegrationFiles],
                    // Real-browser client fixtures share this layer's directory but
                    // run through their own Playwright configuration and built assets.
                    exclude: ['tests/frontend/browser/**'],
                    fileParallelism: true,
                    sequence: {groupOrder: 0},
                },
            },
            {
                extends: true,
                test: {
                    name: 'integration',
                    include: ['tests/integration/**/*.spec.ts'],
                    // The explicitly selected source-runtime browser integration
                    // uses its existing owned server/schema, rather than this resetter.
                    // These server-infrastructure fixtures need no ORM schema.
                    // Their exact files stay in the database-free project above.
                    exclude: ['tests/integration/browser/**', ...databaseFreeIntegrationFiles],
                    // Every file rebuilds the same disposable schema. This project
                    // must own a single worker, after the independent files finish;
                    // no suite may reset rows while another suite uses them.
                    fileParallelism: false,
                    sequence: {groupOrder: 1},
                },
            },
        ],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'coverage',
            reporter: ['text', 'lcov', 'json'],
            include: ['src/**/*.ts', 'src/frontend/**/*.vue'],
            exclude: [
                'src/migrations/**',
                'src/modules/database/__index__.ts',
                'src/types/**',
            ],
        },
    },
});
