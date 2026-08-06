# AI Agent Guide for Surveyor

This document provides guidance for AI coding agents working on the Surveyor project. Whether you're using GitHub
Copilot, Cursor, Claude, or another AI assistant, this guide will help you understand the project structure and
conventions.

## Project Overview

Surveyor is a TypeScript-based event and collaboration management application with comprehensive testing and
documentation. The project uses:

- **Backend**: Express.js + TypeORM + MariaDB
- **Frontend**: Pug templates + Bootstrap + Vanilla TypeScript
- **Testing**: Vitest for isolated utilities/frontend helpers and MariaDB-backed service integration tests; Playwright for focused E2E workflows
- **Language**: TypeScript with strict type checking
- **Testing Approach**: Use-case-focused, factory-backed tests that avoid brittle implementation details

## Quick Start for AI Agents

1. **Read the documentation first**:
    - [README.md](README.md) - Project setup and quick start
    - [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - System architecture and design
    - [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - Development workflow and guidelines
    - [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) - Comprehensive testing guide
    - [.github/copilot-instructions.md](.github/copilot-instructions.md) - GitHub Copilot-specific instructions

2. **Understand the documentation structure**:
    - **Developer docs**: `docs/` directory - architecture, development, testing
    - **User guides**: `docs/user-guide/` - end-user documentation
    - **AI-specific**: `.github/copilot-instructions.md` and this file

3. **Understand the testing approach**:
    - Vitest runs isolated utility/frontend tests and production TypeORM service canaries against MariaDB
    - Playwright runs focused E2E workflows only
    - All test files use the `*.spec.ts` suffix
    - Reusable production-shaped factories live in `tests/factories/`; use common entity factories before specialized builders
    - Reusable workflow/assertion keywords live in `tests/keywords/` when they clarify smoke-test intent
    - Shared runner setup and small helpers live in `tests/support/`
    - Prefer stable use-case coverage over implementation-detail assertions
    - Add comments to grouped smoke assertions explaining the user-facing regression being protected
    - Keep imports order-independent; browser-facing production modules must guard global registration with `typeof window !== 'undefined'` so IDE import reordering cannot break tests
    - See [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) for comprehensive patterns

4. **Follow the conventions**:
    - TypeScript for all code
    - Async/await over promises
    - Interfaces over types
    - Always create migrations for database changes
    - Factory-backed data for realistic production scenarios
    - NEVER commit anything included in .gitignore, especially not generated files (like __index__.ts, *.ge.js, ...)

## Key Directories

```
surveyor/
├── docs/                # Documentation
│   ├── README.md            # Documentation index
│   ├── ARCHITECTURE.md      # System architecture
│   ├── DEVELOPMENT.md       # Development guide
│   ├── TESTING_GUIDE.md     # Testing documentation
│   ├── TEST_REVIEW.md       # Test quality review
│   ├── FRONTEND_TESTING.md  # Frontend testing guide
│   ├── user-guide/          # End-user documentation
│   └── archive/             # Historical documents
├── src/
│   ├── controller/      # Business logic controllers
│   ├── middleware/      # Express middleware
│   ├── migrations/      # TypeORM database migrations
│   ├── modules/         # Application modules
│   │   ├── activity/    # Activity plan logic
│   │   ├── database/    # Database entities and services
│   │   └── lib/         # Utility libraries
│   ├── public/          # Static assets
│   │   ├── js/          # Client-side TypeScript
│   │   │   ├── core/    # Core utilities
│   │   │   ├── shared/  # Shared UI behaviors
│   │   │   └── modules/ # Feature widgets
│   │   └── style/       # SASS stylesheets
│   ├── routes/          # Express routes
│   ├── views/           # Pug templates
│   └── server.ts        # Application entry point
├── tests/
│   ├── backend/         # Fast Vitest backend transformations, permissions, and services
│   ├── api/             # Fast Vitest API contract/input-shaping tests
│   ├── frontend/        # Fast Vitest frontend helper/component tests
│   ├── e2e/             # Focused Playwright critical-flow tests
│   ├── factories/       # Reusable production-shaped test data builders
│   ├── keywords/        # Reusable smoke-test workflow/assertion keywords
│   ├── fixtures/        # Shared fixture assets and seed data
│   └── support/         # Runner setup and shared test utilities
└── scripts/             # Build and utility scripts
```

## Coding Conventions

### TypeScript

```typescript
// ✅ Good: Async/await
async function getUser(id: number): Promise<User> {
    return await userRepository.findOne({where: {id}});
}

// ❌ Bad: Promises
function getUser(id: number): Promise<User> {
    return userRepository.findOne({where: {id}}).then(user => user);
}

// ✅ Good: Interface
interface CreateUserDto {
    username: string;
    email: string;
    password: string;
}

// ❌ Bad: Type (for object shapes)
type CreateUserDto = {
    username: string;
    email: string;
    password: string;
};
```

### Database

```typescript
// ✅ Good: Always create migrations
// 1. Create migration file in src/migrations/
// 2. Define up() and down() operations
// 3. Test both directions

// ❌ Bad: Never use synchronize in production
{
    synchronize: true  // DON'T DO THIS
}

// ✅ Good: Timezone-aware dates
@CreateDateColumn({type: 'datetime', precision: 0, default: () => 'CURRENT_TIMESTAMP'})
createdAt
:
Date;
```

### Testing

```typescript
// ✅ Good: factory-backed Vitest test against production code
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

// ❌ Bad: testing a test-only helper or an implementation detail
it('adds two numbers', () => {
    expect(addNumbers(2, 3)).toBe(5);
});
```

## Common Tasks

### Adding a New Feature

1. **Plan the feature**:
    - Identify required database changes
    - Design the API/controller interface
    - Plan test coverage

2. **Database changes** (if needed):
   ```bash
   # Create migration
   npm run typeorm migration:create src/migrations/AddFeatureName
   
   # Edit migration file
   # Test migration
   npm run typeorm migration:run
   npm run typeorm migration:revert
   ```

3. **Implement the feature**:
    - Create/update entities in `src/modules/database/entities/`
    - Create service layer in module
    - Create controller endpoints
    - Add validation and error handling

4. **Write tests** (in order):
    - Unit tests for business logic
    - Controller tests for orchestration
    - Database tests for data operations
    - E2E tests for user workflows

5. **Update documentation**:
    - Update README.md if user-facing
    - Update TESTING.md if new patterns introduced
    - Add comments for complex logic

### Writing Tests

Use the cheapest stable test that protects the use case:

1. **Choose the test type**:
    - Naturally isolated utility/input-output behavior → `tests/unit/` with Vitest
    - Core service persistence and entity relationships → `tests/integration/` with Vitest and MariaDB
    - Frontend helper/component behavior → `tests/frontend/` with Vitest
    - Critical user workflow → `tests/e2e/` with Playwright

2. **Create reusable factory data when useful**:
   ```typescript
   // tests/factories/eventFactory.ts
   export function createEventInput(overrides: Partial<EventInput> = {}): EventInput {
       return {
           title: 'Summer Camp',
           startDate: '2026-08-05',
           endDate: '2026-08-07',
           ...overrides,
       };
   }
   ```

3. **Write the test against production behavior**:
   ```typescript
   // tests/unit/application-utilities.spec.ts
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

Avoid broad snapshots, private implementation assertions, tests of convenience wrappers that mostly delegate to third-party code, and E2E tests that duplicate every validation branch.

### Fixing a Bug

1. **Write a failing test** that reproduces the bug
2. **Fix the bug** with minimal changes
3. **Verify the test passes**
4. **Run full test suite** to ensure no regressions
5. **Update documentation** if the bug revealed unclear behavior

## Testing Requirements

### Test Coverage

- **Unit Vitest tests**: Naturally isolated production utilities and input/output transformations only
- **Integration Vitest tests**: Important TypeORM services, persisted permissions, and entity relationships against MariaDB
- **Frontend Vitest tests**: Client-side helpers/components and future SPA behavior
- **Playwright E2E tests**: Critical user workflows only

### Test Organization

- Place isolated tests under `tests/unit/`, database-backed service canaries under `tests/integration/`, frontend helpers under `tests/frontend/`, and only critical workflows under `tests/e2e/`; name all test files `*.spec.ts`
- Group related examples by behavior/use case instead of creating one spec file per assertion
- Create reusable production-shaped factories in `tests/factories/`, using common entity factories before specialized builders
- Create reusable keywords in `tests/keywords/` only when they make smoke-test workflows/assertions clearer
- Use small shared helpers in `tests/support/` or E2E screen/page helpers only when they reduce brittle selectors
- Mock only true external boundaries when unavoidable. Never mock TypeORM repositories or core application services; use the disposable MariaDB integration database.

### E2E Test Specifics

- Keep E2E broad and shallow: protect login, event creation, registration, survey voting, packing, activity, drivers, and dashboard visibility workflows first.
- Prefer API/database setup over long UI setup paths.
- Use accessibility selectors or stable `data-testid` anchors; avoid DOM-depth and styling selectors.
- Put reusable E2E screen/page helpers near `tests/e2e/` only when they reduce selector brittleness.
- Keep constants and realistic data in factories or fixtures instead of hard-coded inline values.

## Environment Setup

### Development

```bash
npm install
npm run build
npm run server  # Runs server + client watch
```

### Testing

**Quick start - run all tests:**

```bash
npm run test:all
```

This one command sets up everything and runs all tests (Vitest + E2E). Perfect for CI or comprehensive testing.

**Individual test commands:**

```bash
# Vitest tests only (fast)
npm test
npm run test:quick

# E2E tests only (requires build + database)
npm run build
npm run e2e:prepare
npm run e2e
```

### Database

Tests use two databases:

- `surveyor_test` - Unit and integration tests
- `surveyor_e2e` - E2E tests (name must contain 'e2e')

Configuration:

- `tests/.env.test` - Unit/integration test config
- `.env.e2e` - E2E test config

The `test:all` script automatically sets up and configures both databases.

## CI/CD

The project uses GitHub Actions for CI:

- Runs on push/PR to main branches
- Sets up MariaDB 10.11
- Runs Vitest and focused Playwright E2E tests
- Uploads coverage and test reports

See `.github/workflows/ci.yml` for details.

## Security Considerations

- **Never commit secrets**: Use environment variables
- **Hash passwords**: Use bcryptjs
- **Validate input**: Use express-validator
- **Sanitize output**: Escape user content in views
- **Update dependencies**: Keep packages current
- **Review changes**: Run security scans before committing

## Best Practices for AI Agents

1. **Understand before coding**: Read existing code to understand patterns
2. **Maintain consistency**: Follow existing conventions and styles
3. **Test thoroughly**: Write tests for all changes
4. **Document clearly**: Update docs when adding features or patterns
5. **Ask when unclear**: If requirements are ambiguous, ask for clarification
6. **Minimize changes**: Make the smallest change that solves the problem
7. **Verify correctness**: Run linters, tests, and build before committing

## Common Pitfalls

❌ **Don't**:

- Use `synchronize: true` in database config
- Hard-code test data in test files
- Duplicate brittle selectors or long UI setup in multiple E2E tests
- Skip writing tests
- Ignore TypeScript errors
- Commit environment files (`.env`, `.env.e2e`)
- Mix inline styles/scripts in Pug templates
- Use `any` type excessively

✅ **Do**:

- Create migrations for schema changes
- Externalize test data to data files
- Use small shared helpers or E2E screen/page helpers when they reduce brittle repetition
- Write tests for all code changes
- Fix TypeScript errors
- Use environment variables for config
- Keep presentation logic in templates, business logic in controllers
- Use proper TypeScript types

## Getting Help

- **Documentation**: Check README.md, TESTING.md, and this file first
- **Examples**: Look at existing code for patterns
- **Tests**: Existing tests show correct usage patterns
- **Comments**: Code comments explain complex logic

## Agent-Specific Notes

### GitHub Copilot

See [.github/copilot-instructions.md](.github/copilot-instructions.md) for Copilot-specific instructions and patterns.

### Other AI Agents

This file serves as the primary guide. Read it along with:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system design
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for development workflow
- [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) for testing patterns
- Existing code for implementation examples

## Documentation Structure

Surveyor has comprehensive, well-organized documentation:

### For Developers

- **[docs/README.md](docs/README.md)** - Documentation navigation
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture
- **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** - Development workflow
- **[docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md)** - Testing documentation
- **[docs/TEST_REVIEW.md](docs/TEST_REVIEW.md)** - Test quality review (⭐⭐⭐⭐⭐)
- **[docs/FRONTEND_TESTING.md](docs/FRONTEND_TESTING.md)** - Frontend testing

### For End Users

- **[docs/user-guide/](docs/user-guide/)** - Complete user documentation
    - Getting started, dashboard, surveys, events, packing, activities, drivers

### For AI Agents

- **This file** - General AI agent guidance
- **[.github/copilot-instructions.md](.github/copilot-instructions.md)** - Copilot-specific
- **[.github/copilot/](..github/copilot/)** - Modular Copilot guidelines

## Contributing Guidelines

When making changes:

1. **Analyze**: Understand the problem and existing code
2. **Plan**: Outline your approach
3. **Implement**: Make minimal, focused changes
4. **Test**: Write/update tests, verify all tests pass
5. **Document**: Update documentation if needed
6. **Review**: Check code quality, security, and best practices

## Version Information

- **Node.js**: >= 24
- **TypeScript**: Latest stable
- **MariaDB**: >= 10.4
- **Vitest**: Latest stable
- **Playwright**: Latest stable

For license information, see [README.md](README.md).
