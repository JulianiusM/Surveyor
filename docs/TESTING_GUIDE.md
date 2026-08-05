# Testing Guide

Surveyor uses a pragmatic two-runner strategy:

- **Vitest** for fast backend, API-contract, and frontend-helper tests that run against production TypeScript code.
- **Playwright** for a small E2E suite that verifies critical workflows against the built application.

The goal is useful regression signal with low maintenance overhead. Prefer tests that describe expected input/output transformations or user-visible outcomes. Avoid tests that assert private implementation details, fragile DOM structure, broad snapshots, or test-only helpers.

## Test Structure

```
tests/
├── backend/               # Fast Vitest tests for backend transformations, permissions, and services
│   ├── permissions/       # Permission mask and access logic
│   └── transformations/   # Pure data transformations used by the app
├── api/                   # Fast Vitest API-contract/input-shaping tests
│   └── contracts/         # API-facing contracts and request/response shapes
├── frontend/              # Fast Vitest frontend helper/component tests
│   └── helpers/           # Client-side helper behavior
├── e2e/                   # Focused Playwright critical-flow tests
├── factories/             # Reusable production-shaped test data builders
├── fixtures/              # Shared fixture assets and seed data
└── support/               # Runner setup and shared test utilities
```

All test files use the `*.spec.ts` suffix.

## What to Test

Choose the cheapest stable test that catches the regression:

| Risk | Preferred test |
| --- | --- |
| Date, permission, recommendation, invoice, or dashboard transformation is wrong | Vitest backend test |
| API input shaping or response contract changes | Vitest API contract test |
| Frontend helper/component behavior changes | Vitest frontend test |
| Main user workflow is unusable | Playwright E2E test |

Do not add every layer for every feature. Add one high-value test at the layer that best protects the use case.

## Anti-Brittleness Rules

1. Test production behavior, not implementation details or convenience wrappers that mostly delegate to third-party code.
2. Prefer realistic factories in `tests/factories/` over hard-coded inline objects, and reuse common entity factories such as `createEntityBase()` before adding specialized factories.
3. Put reusable smoke-test workflow/assertion keywords in `tests/keywords/` only when they clarify intent and remove real repetition.
4. Keep E2E broad and shallow; do not cover every validation branch in E2E.
5. Prefer API/database setup over UI setup for E2E prerequisites.
6. Use accessibility selectors or stable `data-testid` anchors for E2E; avoid Bootstrap class and DOM-depth selectors.
7. Avoid broad snapshots. Assert the behavior or contract that matters.
8. Keep helpers small. A helper should reduce brittle repetition, not hide the purpose of the test.
9. Do not create one spec file per assertion. Group related examples by stable production behavior or use case, then use parameterized cases inside that spec.
10. Add a short comment to each grouped smoke assertion explaining the user-facing regression it protects.
11. Keep test imports order-independent: production modules must be safe to import before test setup, so browser globals need guards such as `typeof window !== 'undefined'`.

## Running Tests

```bash
npm test                    # Fast Vitest suite
npm run test:ci             # Fast Vitest suite with JUnit report for CI/SonarQube
npm run test:quick          # Fast backend + frontend examples
npm run test:unit           # Backend-focused Vitest tests
npm run test:api            # API contract Vitest tests
npm run test:frontend       # Frontend Vitest tests
npm run test:integration    # Fast non-E2E regression set
npm run e2e                 # Playwright E2E tests
npm run test:all            # Vitest + build + Playwright E2E
```

## Example Patterns

### Factory-backed Vitest test

```typescript
import {describe, expect, it} from 'vitest';
import {buildDateTotals} from '../../src/modules/lib/util';
import {createDateTotalsCase} from '../factories/dateTotalsFactory';

const cases = [createDateTotalsCase()];

describe('date totals transformation', () => {
    it.each(cases)('$description', (testCase) => {
        expect(buildDateTotals(
            testCase.eventStart,
            testCase.eventEnd,
            testCase.registrations,
        )).toEqual(testCase.expectedTotals);
    });
});
```

### Focused Playwright E2E test

```typescript
import {test, expect} from '@playwright/test';
import {createHealthCase} from '../factories/healthFactory';

const cases = [createHealthCase()];

test.describe('application health', () => {
    for (const testCase of cases) {
        test(testCase.description, async ({request}) => {
            const response = await request.get(testCase.endpoint);
            expect(response.status()).toBe(testCase.expectedStatus);
            expect(await response.text()).toBe(testCase.expectedBody);
        });
    }
});
```

## Current Example Coverage

The scaffold includes useful production-code examples for:

- Backend transformations: date totals and dashboard entity flattening.
- Backend permissions: posted permission values to masks.
- API contracts: query limit coercion.
- Frontend canaries: authentication validation, permission guards, event registration payloads, invoice pool settings, activity slot payloads, recommendation matching, packing items, driver items, and survey combinations.
- E2E: public availability and critical core workflow creation checks.

For future tests, keep the same canary model: protect the most important Surveyor workflows first, keep setup factory-backed, and avoid detailed edge-case matrices unless a real regression justifies them.

## Architecture Review Checklist

- **Single-developer maintainability**: keep the default signal in `npm test`, group related checks in canary suites, and place reusable production-shaped data in factories so updates usually happen in one place.
- **Resistance to small implementation changes**: tests assert public payloads, permission outcomes, and user-visible workflow availability instead of class member counts, private methods, DOM depth, or styling details.
- **Core regression value**: current canaries cover authentication, permissions, event registration, invoice pool settings, surveys, activity plans, recommendations, packing lists, drivers lists, API contracts, backend transformations, and focused E2E availability/workflow checks.
- **Passing tests expectation**: CI runs the fast Vitest suite with JUnit output, builds the app, installs/caches Playwright browsers, runs focused Playwright E2E with JUnit output, uploads all test reports, and passes the package version plus JUnit report paths to SonarQube.
- **Low-overhead goal**: add future coverage as broad smoke cases first; only add detailed edge-case tests when a real bug proves the broad canary is insufficient.
