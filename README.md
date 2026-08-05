# Surveyor

A comprehensive event and collaboration management application built with TypeScript, Express, and TypeORM.

## Features

- 📊 **Surveys** - Create surveys with ranked-choice voting
- 🎉 **Events** - Manage events with registration and participant tracking
- 📦 **Packing Lists** - Collaborate on shared packing coordination
- 📅 **Activity Plans** - Schedule activities with role-based assignments
- 🚗 **Drivers Lists** - Coordinate transportation and carpooling

## Documentation

Comprehensive documentation is available in the [`docs/`](docs/) directory:

- **[Getting Started Guide](docs/user-guide/GETTING_STARTED.md)** - New user onboarding
- **[Architecture](docs/ARCHITECTURE.md)** - System design and patterns
- **[Development Guide](docs/DEVELOPMENT.md)** - Development workflow
- **[Testing Guide](docs/TESTING_GUIDE.md)** - Testing patterns and best practices
- **[User Guides](docs/user-guide/)** - Feature-specific documentation
- **[AI Agent Guide](AGENTS.md)** - For AI coding assistants

## Quick Start

### Prerequisites

- Node.js 24 or higher
- MariaDB 10.4 or higher
- npm

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up your database configuration (see Database Setup below)

4. Build the application:
   ```bash
   npm run build
   ```

5. Start the application:
   ```bash
   npm run run
   ```

## Database Setup

The application requires MariaDB for both development and testing.

### Testing Setup

#### Unit and Integration Tests

Create a `tests/.env.test` file based on `tests/.env.test.example`:

```bash
cp tests/.env.test.example tests/.env.test
```

The test database should be configured with:

- Database name: `surveyor_test`
- User: `surveyor`
- Password: `surveyor`

#### E2E Tests

Create a `.env.e2e` file based on `.env.e2e.example`:

```bash
cp .env.e2e.example .env.e2e
```

The E2E database should be configured with:

- Database name: `surveyor_e2e` (must contain 'e2e' for safety)
- User: `surveyor`
- Password: `surveyor`

## Running Tests

Surveyor uses a **two-runner test strategy** designed to keep useful regression coverage fast for daily work while keeping full browser checks focused on critical user journeys:

- **Vitest** runs fast backend, API-contract, and frontend-helper tests against production TypeScript code.
- **Playwright** runs E2E browser/API checks against the built application.

All test files use the `*.spec.ts` suffix. Prefer testing expected production input/output transformations and user-visible behavior instead of implementation details.

### Quick Start

```bash
npm test
```

This runs the fast Vitest suite. Use it during normal development.

```bash
npm run test:all
```

This runs Vitest, builds the app, initializes the E2E database, starts the built server, and runs the Playwright E2E suite. Use it before releases or in CI.

### Test Organization

Tests are organized around regression value and runtime cost:

- **Backend tests** (`tests/backend/`) - Pure transformations, permissions, services, and backend behavior that can run without a browser.
- **API contract tests** (`tests/api/`) - HTTP/API-facing input and response contracts.
- **Frontend tests** (`tests/frontend/`) - Client-side helpers, DOM/component behavior, and future SPA behavior.
- **E2E tests** (`tests/e2e/`) - A small set of critical workflows run with Playwright.
- **Factories** (`tests/factories/`) - Reusable data builders for realistic production inputs, including shared entity factories before specialized builders.
- **Keywords** (`tests/keywords/`) - Reusable smoke-test workflow/assertion keywords used only when they clarify intent and reduce repetition.
- **Fixtures** (`tests/fixtures/`) - Shared fixture assets and seed data.
- **Support** (`tests/support/`) - Runner setup, environment loading, and shared utilities.

Keep E2E broad and shallow, prefer API/database setup over UI setup, and avoid brittle selectors or snapshots unless the markup itself is the contract.

### Individual Test Commands

```bash
npm test                    # Fast Vitest suite
npm run test:ci             # Fast Vitest suite with JUnit report for CI/SonarQube
npm run test:quick          # Fast backend + frontend examples
npm run test:unit           # Backend-focused Vitest tests
npm run test:api            # API contract Vitest tests
npm run test:integration    # Fast non-E2E regression set
npm run test:frontend       # Frontend Vitest tests
npm run e2e                 # Playwright E2E with managed web server
```

**Manual E2E setup (if needed):**

```bash
npm run build
npm run e2e:prepare
npx playwright install chromium
npm run e2e
```

## CI Pipeline

The project includes a GitHub Actions CI pipeline that:

1. Sets up a MariaDB 10.11 service container
2. Creates and configures both test and E2E databases
3. Installs dependencies and builds the application
4. Runs all unit and integration tests
5. Runs Playwright E2E tests
6. Uploads test reports as artifacts

The CI pipeline runs on:

- Push to `main` or `develop` branches
- Pull requests targeting `main` or `develop` branches

### Database Setup in CI

The CI pipeline automatically:

- Creates `surveyor_test` database for fast backend/API tests that need persistence
- Creates `surveyor_e2e` database for E2E tests
- Sets up required users and permissions
- Initializes the test database schema using `npm run typeorm -- schema:sync`
- Creates `.env.test` and `.env.e2e` files with appropriate credentials

## Development Scripts

- `npm run server:dev` - Run the server in development mode
- `npm run server:client` - Build client-side assets in watch mode
- `npm run server` - Run both server and client in development mode
- `npm run build` - Build the entire application (includes SASS compilation)
- `npm run build:server` - Build server-side code only
- `npm run build:sass` - Compile SASS files to CSS
- `npm run build:client` - Build client-side assets only
- `npm run typeorm` - Run TypeORM migrations
- `npm run generate` - Generate database indexes

## Frontend Architecture

The frontend uses modular TypeScript organized under `src/public/js/` with reusable building blocks:

- **core/** – foundational utilities (HTTP client, navigation helpers, form utilities, formatting, permission loader).
- **shared/** – UI behaviors shared across pages (alerts, drag-and-drop, assignment helpers, inline editing, list actions, UI helpers).
- **modules/** – feature-specific widgets (e.g., timezone-select, entity-select) composed from core/shared pieces.
- **feature files** – page-level scripts such as `activity.ts`, `packing.ts`, and `events.ts` that orchestrate DOM bindings using the shared helpers.

When adding or updating frontend code:

- Reuse the core and shared helpers instead of re-implementing HTTP, drag-and-drop, inline editing, or permission checks.
- Load permissions with `loadPerms()` and gate UI actions using `requireEntityPerm`/`requireItemPerm` before calling protected endpoints.
- Keep new components documented with JSDoc comments and prefer type-safe DOM queries (`querySelector`/`closest` with element type casting) over `any`.
- Expose initialization via `window.Surveyor.init` for consistent page bootstrapping.

## Project Structure

- `src/` - Application source code
    - `modules/` - Application modules
    - `migrations/` - Database migrations
    - `public/` - Static assets
    - `views/` - View templates
- `tests/` - Test files
    - `backend/` - Fast Vitest backend transformations, permissions, and services
    - `api/` - Fast Vitest API contract/input-shaping tests
    - `frontend/` - Fast Vitest frontend helper/component tests
    - `e2e/` - Focused Playwright critical-flow tests
    - `factories/` - Reusable production-shaped data builders
    - `fixtures/` - Shared fixture assets and seed data
    - `support/` - Runner setup and shared utilities
- `scripts/` - Utility scripts

## License

Private - All rights reserved
