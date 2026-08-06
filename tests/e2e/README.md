# End-to-End Tests

This directory contains Playwright E2E tests for the Surveyor application.

## Quick Reference

**Run all E2E tests:**
```bash
npm run e2e
```

**Run with visible browser:**
```bash
npm run e2e:headed
```

**Interactive UI mode:**
```bash
npm run e2e:ui
```

## Test Files

- `auth.test.ts` - Authentication and user management (~17 tests)
- `survey.test.ts` - Survey entity management (~6 tests)
- `packing.test.ts` - Packing list management (~6 tests)
- `activity.test.ts` - Activity plan management (~6 tests)
- `drivers.test.ts` - Drivers list management (~6 tests)
- `navigation.test.ts` - UI navigation and accessibility (~10 tests)
- `error-handling.test.ts` - Error scenarios and validation (~13 tests)

**Total:** ~64 E2E tests

## Documentation

For comprehensive E2E testing documentation, including:
- Data-driven and keyword-driven patterns
- Test structure and organization
- Writing new tests
- Best practices
- Debugging and troubleshooting

See **[TESTING.md](../../TESTING.md)** in the project root.

## Quick Setup

1. Copy example environment file:
   ```bash
   cp .env.e2e.example .env.e2e
   ```

2. Prepare E2E database:
   ```bash
   npm run e2e:prepare
   ```

3. Run tests:
   ```bash
   npm run e2e
   ```

Or use the one-click setup:
```bash
npm run test:all  # Runs all tests including E2E
```
