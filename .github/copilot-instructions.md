# GitHub Copilot Instructions for Surveyor

For comprehensive documentation, read:

- [docs/README.md](../docs/README.md)
- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md)
- [docs/TESTING_GUIDE.md](../docs/TESTING_GUIDE.md)
- [AGENTS.md](../AGENTS.md)

## Quick Reference

### Project Structure

- `src/modules/` - Application modules, database services, and utilities.
- `src/routes/` - Express routes.
- `src/controller/` - Controller/business orchestration.
- `src/public/js/` - Client-side TypeScript.
- `tests/unit/` - Vitest tests strictly limited to naturally isolated production utilities.
- `tests/integration/` - Vitest core-service smoke tests using the production TypeORM DataSource and MariaDB.
- `tests/frontend/` - Fast Vitest frontend helper/component tests.
- `tests/e2e/` - Focused Playwright critical-flow tests.
- `tests/factories/` - Reusable production-shaped test data builders.
- `tests/keywords/` - Reusable smoke-test workflow/assertion keywords when they clarify intent.
- `tests/support/` - Test runner setup and shared utilities.

### Key Principles

1. Use TypeScript with strict typing, interfaces over object-shape type aliases, and async/await.
2. Create migrations for database schema changes.
3. Use Vitest for isolated utilities, frontend helpers, and MariaDB-backed integration smoke tests; use Playwright for focused E2E workflows.
4. Test production behavior, not test-only helpers or private implementation details.
5. Prefer realistic factories in `tests/factories/` over hard-coded inline data.
6. Keep E2E broad and shallow; protect critical workflows rather than every branch.
7. Avoid brittle selectors, broad snapshots, and assertions tied to Bootstrap classes unless the class string is the explicit production contract.
8. Add comments to smoke assertions that explain which user-facing regression the case protects.
9. Keep imports order-independent; production browser modules must guard global `window` registration so tests do not rely on import order.
10. Never commit secrets or generated files ignored by `.gitignore`.

## Testing Rules

- All test files use `*.spec.ts`.
- Place naturally isolated utility/input-output tests in `tests/unit/`; do not unit-test service orchestration with mocks.
- Place core TypeORM service and entity-graph canaries in `tests/integration/` and use the disposable test database instead of repository mocks.
- Place frontend helper/component tests in `tests/frontend/`.
- Place Playwright E2E tests in `tests/e2e/`.
- Place reusable data builders in `tests/factories/`.
- Place reusable smoke-test keywords in `tests/keywords/` only when they reduce meaningful repetition.
- Place runner setup and small shared helpers in `tests/support/`.

Use the cheapest stable test that catches the regression. Do not add every layer for every feature.
