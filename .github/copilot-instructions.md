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

- Write tests for all new features
- Place unit tests in `tests/unit/`
- Place controller tests in `tests/controller/`
- Place middleware tests in `tests/middleware/`
- Place database integration tests in `tests/database/`
- Place E2E tests in `tests/e2e/`
- Mock external dependencies and use the existing mock utilities in `tests/util/`
- Database tests must use the MariaDB test datasource mock
- E2E tests must use the `.env.e2e` configuration

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

### Unit Tests

- Mock all external dependencies
- Use existing stubs from `tests/util/stubs/`
- Test individual functions and methods in isolation

### Integration Tests

- Test interaction between multiple components
- Use the MariaDB test database
- Clean up test data after each test

### E2E Tests

- Test complete user workflows
- Use Playwright test framework
- Tests run against the built application
- Configure test data through the E2E database initialization script

## CI Pipeline

The GitHub Actions CI pipeline:

- Runs on push to `main` or `develop` branches
- Runs on pull requests to `main` or `develop`
- Sets up MariaDB 10.11 service container
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