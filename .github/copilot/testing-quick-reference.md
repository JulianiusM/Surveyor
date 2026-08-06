# Testing Quick Reference

## Strategy

Surveyor uses **Vitest** for isolated utilities, frontend helpers, and MariaDB-backed service integration tests, plus **Playwright** for focused E2E workflows.

Use the cheapest stable test that protects the use case. Do not add every layer for every feature.

## Commands

```bash
npm test                    # Fast Vitest suite
npm run test:quick          # Database-free utility + frontend checks
npm run test:unit           # Isolated utilities only
npm run test:frontend       # Frontend Vitest tests
npm run test:integration    # MariaDB-backed service canaries
npm run e2e                 # Playwright E2E tests
npm run test:all            # Vitest + build + Playwright E2E
```

## Structure

- `tests/unit/` - Naturally isolated production utilities and input/output transformations.
- `tests/integration/` - Production TypeORM services exercised against the disposable MariaDB test schema.
- `tests/frontend/` - Fast Vitest frontend helper/component tests.
- `tests/e2e/` - Focused Playwright critical-flow tests.
- `tests/factories/` - Reusable production-shaped test data builders.
- `tests/fixtures/` - Shared fixture assets and seed data.
- `tests/support/` - Runner setup and shared utilities.

All test files use `*.spec.ts`.

## Anti-Brittleness Rules

- Test production behavior, not test-only helpers.
- Prefer user-visible outcomes and input/output contracts.
- Keep E2E broad and shallow.
- Use factories for realistic data with small overrides.
- Avoid broad snapshots and implementation-detail selectors.
- Use stable E2E selectors or role/name locators.
- Do not mock TypeORM repositories or core services; use the integration database.
