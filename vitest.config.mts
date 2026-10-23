import {defineConfig} from 'vitest/config';
import {ForksPoolWorker} from 'vitest/node';
import type {PoolOptions, PoolRunnerInitializer} from 'vitest/node';
import vue from '@vitejs/plugin-vue';

const ipcForksName = 'forks-ipc';

/** Reuse Vitest's fork execution and isolation, delivering transformed source
 * through its existing IPC instead of optional temporary module-file copies.
 * The exported worker extension is experimental; review it on Vitest upgrades. */
class IpcForksWorker extends ForksPoolWorker {
    // Match the public factory identity so explicit non-isolated runs can reuse
    // workers through Vitest's ordinary equality check as well.
    override readonly name = ipcForksName;
    // Atomic file publication is valid for file transport, but each rename is
    // costly on the measured Windows host. IPC removes that transport entirely.
    override readonly cacheFs = false;
}

// A unique matching factory/worker name selects the public extension point;
// the inherited fork entrypoint, serialization and process lifecycle stay intact.
const ipcForks: PoolRunnerInitializer = {
    name: ipcForksName,
    createPoolWorker(options: PoolOptions): ForksPoolWorker {
        return new IpcForksWorker(options);
    },
};

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
        // Full threaded runs on Windows have exited inside the native runtime
        // without a test result (0xC0000409). Separate processes contain each
        // worker's native state there; Linux CI retains its measured thread
        // performance. Both pools keep fresh file isolation and the same bounded
        // concurrency; database-backed files still own one resetter at a time.
        pool: process.platform === 'win32' ? ipcForks : 'threads',
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
