// jest.client.config.ts
// Jest configuration for frontend (client-side) tests
import type {Config} from 'jest';

const config: Config = {
    displayName: 'client',
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    rootDir: '.',
    roots: ['<rootDir>/src/public/js', '<rootDir>/tests/client'],
    testMatch: ['<rootDir>/tests/client/**/*.(test|spec).ts'],
    
    // Setup files
    setupFilesAfterEnv: ['<rootDir>/tests/client/setupTests.ts'],
    
    // Module resolution
    moduleFileExtensions: ['ts', 'js', 'json'],
    moduleNameMapper: {
        // Handle CSS imports (ignore them in tests)
        '\\.(css|less|scss|sass)$': '<rootDir>/tests/client/mocks/styleMock.ts',
        // Keep the UUID stub from main config
        '^uuid$': '<rootDir>/tests/util/stubs/uuid.ts',
    },
    
    // Transform MSW and its dependencies
    transformIgnorePatterns: [
        'node_modules/(?!(msw|@mswjs|@bundled-es-modules|until-async|strict-event-emitter|@open-draft)/)',
    ],
    
    // Transform configuration
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                target: 'ES2020',
                module: 'ESNext',
                moduleResolution: 'node',
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
                strict: true,
                skipLibCheck: true,
                resolveJsonModule: true,
                isolatedModules: true,
                lib: ['ES2020', 'DOM', 'DOM.Iterable'],
                types: ['jest', 'node', 'jsdom', '@testing-library/jest-dom'],
            }
        }],
        '^.+\\.jsx?$': ['ts-jest', {
            tsconfig: {
                target: 'ES2020',
                module: 'ESNext',
                moduleResolution: 'node',
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
                allowJs: true,
                skipLibCheck: true,
            }
        }],
    },
    
    // Coverage configuration
    collectCoverageFrom: [
        'src/public/js/**/*.{ts,js}',
        '!src/public/js/**/*.d.ts',
        '!src/public/js/**/*.gen.js',
        '!src/public/js/**/stub.ts',
    ],
    coverageDirectory: 'coverage/client',
    coverageReporters: ['text', 'lcov', 'html'],
    coverageThreshold: {
        global: {
            branches: 50,
            functions: 50,
            lines: 50,
            statements: 50,
        },
    },
    
    // Test timeout
    testTimeout: 10000,
    
    // Globals for jsdom
    testEnvironmentOptions: {
        url: 'http://localhost',
        // Add custom properties to window if needed
    },
};

export default config;
