"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
var base = {
    testEnvironment: 'node',
    rootDir: '.',
    moduleFileExtensions: ['ts', 'js', 'json'],
    setupFiles: ['<rootDir>/tests/env.load.ts'],
    setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
    },
    moduleNameMapper: {
        '^openid-client$': '<rootDir>/tests/util/stubs/openid-client.ts',
        '^oauth4webapi$': '<rootDir>/tests/util/stubs/oauth4webapi.ts',
        '^uuid$': '<rootDir>/tests/util/stubs/uuid.ts',
        '^nodemailer$': '<rootDir>/tests/util/stubs/nodemailer.ts',
        '^connect-typeorm$': '<rootDir>/tests/util/stubs/connect-typeorm.ts',
        '^morgan$': '<rootDir>/tests/util/stubs/morgan.ts',
    },
};
var config = {
    // Split into two projects so we can serialize DB tests only
    projects: [
        __assign(__assign({}, base), { displayName: 'unit', testMatch: ['<rootDir>/tests/unit/**/*.(test|spec).ts'] }),
        __assign(__assign({}, base), { displayName: 'controller', testMatch: ['<rootDir>/tests/controller/**/*.(test|spec).ts'] }),
        __assign(__assign({}, base), { displayName: 'middleware', testMatch: ['<rootDir>/tests/middleware/**/*.(test|spec).ts'] }),
        __assign(__assign({}, base), { displayName: 'frontend', testMatch: ['<rootDir>/tests/frontend/**/*.(test|spec).ts'] }),
        __assign(__assign({}, base), { displayName: 'db', testMatch: ['<rootDir>/tests/database/**/*.(test|spec).ts'], 
            // serialize DB tests to avoid cross-test interference
            maxWorkers: 1, runner: 'jest-serial-runner', 
            // optional: add DB-specific setup (e.g., per-worker DB/envs) if you have it
            setupFilesAfterEnv: [
                '<rootDir>/tests/jest.setup.ts',
                '<rootDir>/tests/jest.setup.db.ts', // create this if you need DB hooks
            ], 
            // optional: give integration tests more time
            testTimeout: 30000 }),
    ],
};
exports.default = config;
