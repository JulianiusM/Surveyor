# Testing Quick Reference

## Strategy

Surveyor uses **Vitest** for fast backend/API/frontend regression tests and **Playwright** for focused E2E workflows.

Use the cheapest stable test that protects the use case. Do not add every layer for every feature.

## Commands

```bash
npm test                    # Fast Vitest suite
npm run test:quick          # Fast backend + frontend examples
npm run test:unit           # Backend-focused Vitest tests
npm run test:api            # API contract Vitest tests
npm run test:frontend       # Frontend Vitest tests
npm run test:integration    # Fast non-E2E regression set
npm run e2e                 # Playwright E2E tests
npm run test:all            # Vitest + build + Playwright E2E
```

## Structure

- `tests/backend/` - Fast Vitest tests for backend transformations, permissions, and services.
- `tests/api/` - Fast Vitest API contract/input-shaping tests.
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
