# GitHub Copilot Instructions for Surveyor

## Project Overview

Surveyor is a TypeScript-based survey management application built with:

- Express.js for the web server
- TypeORM for database operations
- MariaDB as the database
- Jest for unit and integration testing
- Playwright for end-to-end testing
- Pug for templating
- Bootstrap for styling

## Code Style Guidelines

### TypeScript

- Use TypeScript for all new code
- Follow existing type definitions and interfaces
- Use strict type checking
- Prefer interfaces over types for object shapes
- Use async/await over promises when possible

### File Organization

- Keep related functionality in modules under `src/modules/`
- Place database entities in `src/modules/database/entities/`
- Place migrations in `src/migrations/`
- Follow existing naming conventions

### Testing

The project uses **data-driven** and **keyword-driven** testing approaches. See [TESTING.md](../TESTING.md) for comprehensive guidelines.

#### Test Structure

- **Test data** is separated into `tests/data/` directory organized by test type (unit, controller, middleware, database, e2e)
- **Test keywords** (reusable actions) are in `tests/keywords/` directory
- **Test builders** for creating test objects are in `tests/data/builders/`

#### Test Organization

- Place unit tests in `tests/unit/`
- Place controller tests in `tests/controller/`
- Place middleware tests in `tests/middleware/`
- Place database integration tests in `tests/database/`
- Place E2E tests in `tests/e2e/`

#### Writing Tests

- **Use data-driven tests**: Externalize test data into data files, use `test.each()` for parameterized tests
- **Use test keywords**: Leverage reusable keywords from `tests/keywords/` for common operations
- **Use builders**: Use test data builders from `tests/data/builders/` for creating test objects
- **Separate concerns**: Test data in `tests/data/`, test logic in test files, test utilities in keywords
- **Mock wisely**: Mock external dependencies using existing mock utilities in `tests/util/`
- **Database tests**: Must use the MariaDB test datasource mock
- **E2E tests**: Must use the `.env.e2e` configuration

#### Test Data Guidelines

- Create test data files in `tests/data/<type>/` matching the test file name
- Export arrays of test cases with descriptive names
- Include both success and failure scenarios
- Cover edge cases and boundary conditions
- Use test builders for complex objects

#### Test Keywords Guidelines

- Create keywords in `tests/keywords/<type>/` for reusable test actions
- Use clear, action-oriented names (create*, verify*, setup*, expect*)
- Keywords should be composable and single-purpose
- Return useful data to enable further assertions
- Handle errors gracefully within keywords

## Database Guidelines

### Entities

- All entities should be in `src/modules/database/entities/`
- Use TypeORM decorators for entity definitions
- Include proper relationships between entities
- Use timezone 'Z' for consistent UTC handling

### Migrations

- Always create migrations for schema changes
- Never use `synchronize: true` in production
- Test migrations with both up and down operations
- Place migrations in `src/migrations/`

### Testing with Database

- Unit/integration tests use `surveyor_test` database
- E2E tests use `surveyor_e2e` database (name must contain 'e2e')
- Use the provided datasource mocks in tests
- Database tests run serially to avoid conflicts

## Testing Guidelines

For comprehensive testing guidelines, see [TESTING.md](../TESTING.md).

### Unit Tests

- Use **data-driven approach**: Extract test data to `tests/data/unit/`
- Use **test keywords**: Leverage keywords from `tests/keywords/common/`
- Mock all external dependencies using stubs from `tests/util/stubs/`
- Test individual functions and methods in isolation
- Use `test.each()` for parameterized tests with multiple data sets

### Controller Tests

- Use **data-driven approach**: Extract test data to `tests/data/controller/`
- Use **controller keywords**: Leverage keywords from `tests/keywords/common/controllerKeywords.ts`
- Mock service dependencies
- Focus on validation, orchestration, and error mapping
- No database interaction in controller tests

### Middleware Tests

- Use **data-driven approach**: Extract test data to `tests/data/middleware/`
- Use **middleware keywords**: Leverage keywords from `tests/keywords/middleware/`
- Test request/response handling
- Verify authentication and authorization logic
- Test error handling and redirection

### Integration Tests

- Use **data-driven approach** where applicable
- Test interaction between multiple components
- Use the MariaDB test database with provided mocks
- Clean up test data after each test using keywords
- Test complete workflows with real database operations

### E2E Tests

E2E tests follow the same **data-driven** and **keyword-driven** patterns as unit and integration tests:

- **Test data**: Externalized to `tests/data/e2e/*.ts`
- **Test keywords**: Reusable actions in `tests/keywords/e2e/*.ts`
- **For-loop pattern**: Use `for (const data of testData)` to iterate test cases

#### Test Structure

```typescript
// Import test data
import { surveyCreationData } from '../data/e2e/surveyData';
import { testCredentials } from '../data/e2e/authData';

// Import keywords
import { loginUser } from '../keywords/e2e/authKeywords';
import { createSurvey, generateEntityTitle } from '../keywords/e2e/entityKeywords';

// Data-driven test
for (const data of surveyCreationData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        const surveyTitle = generateEntityTitle(data.title);
        await createSurvey(page, surveyTitle, data.surveyDescription, data.submitButtonText);
        await page.waitForURL((url) => data.expectedRedirectPattern.test(url.pathname));
    });
}
```

#### Test Organization

- **Test files**: `tests/e2e/*.test.ts`
- **Test data**: `tests/data/e2e/*.ts` 
- **Keywords**: `tests/keywords/e2e/*.ts`
  - `authKeywords.ts` - Authentication operations (login, register, verify)
  - `entityKeywords.ts` - Entity management (create, navigate, verify)
  - `navigationKeywords.ts` - Navigation operations (links, pages, titles)
  - `validationKeywords.ts` - Validation operations (errors, fields, alerts)
  - `dbKeywords.ts` - Database helpers (tokens, queries)

- Test complete user workflows and frontend behavior
- Use Playwright test framework
- Tests run against the built application
- Configure test data through the E2E database initialization script
- Organize tests by feature area:
    - `auth.test.ts` - Authentication and session management (login, registration, password reset, tokens)
    - `survey.test.ts` - Survey creation, validation, and management
    - `packing.test.ts` - Packing list creation, validation, and management
    - `activity.test.ts` - Activity plan creation, validation, and management
    - `drivers.test.ts` - Drivers list creation, validation, and management
    - `navigation.test.ts` - UI navigation, accessibility, and page structure
    - `error-handling.test.ts` - Frontend validation, error handling, and exception scenarios
- Focus on frontend behavior, not backend logic (backend is covered by unit/integration tests)
- Test form validation, error messages, and user feedback
- Verify authentication gates and access control for all protected routes
- Test responsive design and accessibility features
- Test error scenarios: invalid tokens, non-existent resources, server errors, network failures
- Test HTML5 validation for required fields
- Test console error monitoring to catch JavaScript errors
- Mock OIDC for frontend testing without requiring a real provider
- All tests should pass in CI environment
- Use `.env.e2e` for configuration (never commit this file)
- OIDC configuration in E2E is for frontend testing only (button visibility, UI state)
- Do not test actual OIDC authentication flows in E2E tests
- Tests should be isolated and use `test.beforeEach` to clear cookies/session
- Use keywords for common operations instead of duplicating code
- Test both positive and negative paths (success and failure scenarios)

## CI Pipeline

The GitHub Actions CI pipeline:

- Runs on push to `main` or `develop` branches
- Runs on pull requests to `main` or `develop`
- Sets up MariaDB 10.11 service container
- Sets up Node.js 24
- Creates test and E2E databases with proper users
- Runs all unit, integration, and E2E tests
- Uploads Playwright reports as artifacts

### Environment Files

- `tests/.env.test` - Configuration for unit/integration tests
- `.env.e2e` - Configuration for E2E tests
- Both files are created automatically in CI

## Building and Running

### Development

```bash
npm run server          # Run server with client watch mode
npm run server:dev      # Run server only
npm run server:client   # Build client assets in watch mode
```

### Production Build

```bash
npm run build           # Build everything
npm run build:server    # Build server only
npm run build:client    # Build client only
```

### Testing

```bash
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
npm run e2e             # Run E2E tests
npm run e2e:headed      # Run E2E tests with browser
```

## Common Tasks

### Adding a New Feature

1. Create or update entities if needed
2. Create migration if database changes are required
3. Implement the feature in appropriate modules
4. Write unit tests for business logic
5. Write integration tests for database operations
6. Write E2E tests for user-facing functionality
7. Update documentation if needed

### Fixing a Bug

1. Write a failing test that reproduces the bug
2. Fix the bug
3. Ensure the test passes
4. Run full test suite to ensure no regressions

### Database Changes

1. Create a new migration file in `src/migrations/`
2. Test the migration locally
3. Update entities if needed
4. Run `npm run typeorm` to apply migrations
5. Test both up and down migrations

## Dependencies

### Key Production Dependencies

- node >= 24
- express - Web framework
- typeorm - ORM for database operations
- mysql2 - MariaDB driver
- bcryptjs - Password hashing
- express-session - Session management
- openid-client - OIDC authentication

### Key Development Dependencies

- typescript - Type checking and compilation
- jest - Testing framework
- @playwright/test - E2E testing
- ts-node - TypeScript execution
- supertest - HTTP testing

## Security Considerations

- Never commit `.env` files or credentials
- Use environment variables for all configuration
- Hash all passwords with bcrypt
- Validate and sanitize all user input
- Use express-validator for input validation
- Keep dependencies up to date

## Notes for Copilot

- When suggesting database changes, always remind about creating migrations
- When suggesting new features, remind about testing requirements
- The E2E database name must contain 'e2e' for safety
- All database operations should be timezone-aware (UTC)
- Mock external services in tests
- Use existing patterns and structures from the codebase