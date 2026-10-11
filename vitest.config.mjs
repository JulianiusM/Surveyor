import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
    plugins: [vue()],
    test: {
        globals: false,
        environment: 'node',
        // Date fixtures and the database contract use UTC, as CI already does.
        // Apply that contract in each worker so a developer's local zone cannot
        // turn an unchanged serializer into a misleading regression failure.
        env: { TZ: 'UTC' },
        // Database-free files have isolated workers and restore their own globals.
        // Bound concurrency for ordinary two-core CI runners instead of serializing
        // those files behind a restriction required only by the shared test schema.
        isolate: true,
        maxWorkers: 2,
        hookTimeout: 30_000,
        setupFiles: ['tests/support/env.ts'],
        projects: [
            {
                extends: true,
                test: {
                    name: 'database-free',
                    include: ['tests/unit/**/*.spec.ts', 'tests/frontend/**/*.spec.ts'],
                    fileParallelism: true,
                    sequence: { groupOrder: 0 },
                },
            },
            {
                extends: true,
                test: {
                    name: 'integration',
                    include: ['tests/integration/**/*.spec.ts'],
                    // Every file rebuilds the same disposable schema. This project
                    // must own a single worker, after the independent files finish;
                    // no suite may reset rows while another suite uses them.
                    fileParallelism: false,
                    sequence: { groupOrder: 1 },
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
