import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        include: [
            'tests/backend/**/*.spec.ts',
            'tests/api/**/*.spec.ts',
            'tests/frontend/**/*.spec.ts',
        ],
        globals: false,
        environment: 'node',
        setupFiles: ['tests/support/env.ts'],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'coverage',
        },
    },
});
