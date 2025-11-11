# End-to-End Test Documentation

This directory contains Playwright E2E tests for the Surveyor application. These tests follow the same **data-driven** and **keyword-driven** testing patterns used in unit and integration tests.

## Test Architecture

### Data-Driven and Keyword-Driven Approach

All E2E tests now use:
- **Test data files** (`tests/data/e2e/*.ts`) - Separated test data from test logic
- **Test keywords** (`tests/keywords/e2e/*.ts`) - Reusable test actions
- **For-loop pattern** - Playwright-compatible data iteration

### Example Pattern

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

## Test Organization

### File Structure

```
tests/
├── e2e/
│   ├── auth.test.ts           # Authentication flows and user management
│   ├── survey.test.ts         # Survey entity management
│   ├── packing.test.ts        # Packing list management
│   ├── activity.test.ts       # Activity plan management
│   ├── drivers.test.ts        # Drivers list management
│   ├── navigation.test.ts     # UI navigation and page structure
│   ├── error-handling.test.ts # Error scenarios and validation
│   └── README.md             # This file
├── data/e2e/
│   ├── authData.ts           # Authentication test data
│   ├── surveyData.ts         # Survey test data
│   ├── packingData.ts        # Packing test data
│   ├── activityData.ts       # Activity test data
│   ├── driversData.ts        # Drivers test data
│   ├── navigationData.ts     # Navigation test data
│   └── errorHandlingData.ts  # Error handling test data
└── keywords/e2e/
    ├── authKeywords.ts       # Authentication keywords (login, register, etc.)
    ├── entityKeywords.ts     # Entity management keywords (create, verify, etc.)
    ├── navigationKeywords.ts # Navigation keywords (navigate, verify links, etc.)
    ├── validationKeywords.ts # Validation keywords (check errors, fields, etc.)
    └── dbKeywords.ts         # Database helper keywords (tokens, queries, etc.)
```

## Test Categories

### Authentication Tests (`auth.test.ts`)

**Coverage:**
- Login/logout flows
- User registration
- Account activation via tokens
- Password reset workflows
- Token validation and reuse prevention
- Duplicate username prevention
- Password strength validation
- OIDC button visibility (frontend configuration testing)

**Total Tests:** ~17 tests

### Entity Management Tests

Each entity type (Survey, Packing, Activity, Drivers) has its own test file with consistent structure:

**Coverage per entity:**
- Create page access (authenticated/unauthenticated)
- Form rendering and validation
- Creating entities with valid data
- Required field validation
- Empty state display on dashboard

**Files:**
- `survey.test.ts` - Survey management (6 tests)
- `packing.test.ts` - Packing list management (6 tests)
- `activity.test.ts` - Activity plan management (6 tests)
- `drivers.test.ts` - Drivers list management (6 tests)

**Total Tests:** ~24 tests

### Navigation Tests (`navigation.test.ts`)

**Coverage:**
- Home page structure
- Navigation menu items for authenticated users
- Dashboard entity count display
- Responsive design elements
- Footer links
- Page titles
- Logo and branding
- Form accessibility (labels)
- Navigation between entity pages
- Browser back button functionality

**Total Tests:** ~10 tests

### Error Handling Tests (`error-handling.test.ts`)

**Coverage:**
- 404 error pages
- Form validation (empty fields, mismatched passwords)
- Invalid tokens (activation, password reset)
- Unauthorized access redirects
- Network error resilience (offline mode)
- Server error handling
- Console error monitoring
- Non-existent resource handling
- Protected route access control

**Total Tests:** ~13 tests

## Test Patterns

### Data-Driven Tests

Tests iterate over test data using for loops (Playwright-compatible pattern):

```typescript
for (const data of loginSuccessData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, data.username, data.password);
        await verifyUrlMatches(page, data.expectedUrl);
        await verifyHeadingVisible(page, data.expectedHeading);
    });
}
```

### Keyword-Driven Tests

Tests use reusable keywords to abstract common operations:

```typescript
// Authentication keywords
await loginUser(page, username, password);
await registerUserThroughUI(page, { username, password, email });
await verifyErrorAlert(page);

// Entity management keywords
await navigateToEntityCreatePage(page, 'survey', expectedUrl, expectedHeading);
await createSurvey(page, title, description, submitButtonText);
await verifyDashboardEmptyState(page, accordionId, buttonText, expectedEmptyText);

// Navigation keywords
await verifyLinkVisible(page, linkName);
await navigateThroughSteps(page, steps);
await verifyPageTitle(page, pattern);

// Validation keywords
await verifyErrorMessage(page, selector, expectedText);
await verifyFieldRequired(page, fieldName);
await verifyProtectedRoutesRedirect(page, routes, expectedRedirectUrl);
```

### Test Isolation

Each test suite uses `test.beforeEach` to ensure clean state:

```typescript
test.beforeEach(async ({context}) => {
    await context.clearCookies();
});
```

### Locator Strategies

Tests use stable, semantic locators:
- Role-based: `page.getByRole('button', {name: /login/i})`
- Attribute-based: `page.locator('input[name="username"]')`
- Text-based: `page.getByText(/welcome/i)`

## Running Tests

### All E2E Tests
```bash
npm run e2e
```

### Specific Test File
```bash
npx playwright test tests/e2e/auth.test.ts
```

### Headed Mode (visible browser)
```bash
npm run e2e:headed
```

### UI Mode (interactive)
```bash
npm run e2e:ui
```

### Watch Mode
```bash
npx playwright test --ui
```

## Configuration

E2E tests require `.env.e2e` configuration:

```env
NODE_ENV=e2e
APP_PORT=3001
ROOT_URL=http://localhost:3001

# Authentication
LOCAL_LOGIN_ENABLED=1
SESSION_SECRET=ci_e2e_secret

# Database (must contain 'e2e')
E2E_DB_HOST=127.0.0.1
E2E_DB_PORT=3306
E2E_DB_USER=surveyor
E2E_DB_PASSWORD=surveyor
E2E_DB_NAME=surveyor_e2e

# Test User
E2E_ADMIN_USERNAME=tester
E2E_ADMIN_EMAIL=e2e@example.com
E2E_ADMIN_PASSWORD=passw0rd!

# OIDC (for frontend testing only)
OIDC_ENABLED=0
```

## Benefits of Data-Driven and Keyword-Driven Approach

### Maintainability
- **Single source of truth**: Update test data in one place
- **Reusable keywords**: Change implementation without updating all tests
- **Clear separation**: Test logic separate from test data

### Readability
- **Business-focused**: Tests read like requirements
- **Self-documenting**: Descriptive test data and keyword names
- **Easy to understand**: High-level test flow without implementation details

### Coverage
- **Easy to add scenarios**: Just add new test data
- **Parameterized tests**: Multiple test cases from single test function
- **Comprehensive**: Cover edge cases and boundary conditions with data

### Consistency
- **Standardized patterns**: All E2E tests follow same structure
- **Aligned with unit/integration tests**: Same patterns across test types
- **Uniform keywords**: Common operations use same keywords

## Best Practices for E2E Tests

### Test Data
1. **Use descriptive names**: Clear `description` field for each test case
2. **Cover all scenarios**: Include success, failure, and edge cases
3. **Keep data readable**: Use meaningful values, not random strings
4. **Use test credentials**: Reference `testCredentials` from `authData.ts`
5. **Generate unique IDs**: Use `generateUniqueUsername()` for user creation

### Test Keywords
1. **Single responsibility**: Each keyword does one thing well
2. **Composable**: Combine keywords to build complex workflows
3. **Return values**: Return data needed for assertions
4. **Error handling**: Handle errors gracefully within keywords
5. **Clear naming**: Use action verbs (login, create, verify, navigate)

### Test Files
1. **Import data and keywords**: Always import at the top
2. **Use for loops**: Iterate over test data using Playwright pattern
3. **Cleanup state**: Use `beforeEach` to clear cookies
4. **Avoid duplication**: Use keywords instead of repeating code
5. **Test one thing**: Each test should verify one behavior

## Coverage Goals

### Current Coverage
- ✅ Authentication flows
- ✅ Entity CRUD operations (create, basic access)
- ✅ Form validation
- ✅ Navigation and UI elements
- ✅ Error handling and edge cases
- ✅ Access control

### Future Enhancements
- Edit/update entity workflows
- Delete entity workflows
- Advanced entity features (participants, voting, etc.)
- Multi-user interactions
- File upload scenarios
- Advanced form validations
- Real-time features (if any)

## Debugging Tests

### View Test Results
```bash
npx playwright show-report
```

### Debug Specific Test
```bash
npx playwright test tests/e2e/auth.test.ts --debug
```

### Trace Viewer
```bash
npx playwright test --trace on
npx playwright show-trace trace.zip
```

## Best Practices

1. **Test What Users See**: Focus on user-visible behavior, not implementation details
2. **Use Semantic Locators**: Prefer role-based and accessible locators
3. **Avoid Flaky Tests**: Use proper waits and assertions
4. **Keep Tests Isolated**: Clear state between tests
5. **Test Both Paths**: Include positive and negative test cases
6. **Meaningful Names**: Test names should describe the expected behavior
7. **Group Related Tests**: Organize tests by feature area
8. **Mock External Services**: Use mocks for email, OIDC, etc.
9. **Monitor Console Errors**: Include console error checks
10. **Document Assumptions**: Add comments for non-obvious test logic

## Common Issues

### Browser Not Installed
```bash
npx playwright install
```

### Test Timeout
Increase timeout in `playwright.config.ts` or use `test.setTimeout()`

### Database Not Reset
Ensure `npm run e2e:prepare` runs before tests

### Port Already in Use
Change `APP_PORT` in `.env.e2e` or kill existing process

### SMTP Errors in Console
These are expected in E2E environment - filtered out in console error tests

## CI Integration

Tests run automatically in GitHub Actions CI:
- Playwright version 1.55.0
- Chromium browser
- MariaDB 10.11
- Node 24
- Artifacts uploaded on failure

## Contributing

When adding new tests:

1. Choose the appropriate test file or create a new one
2. Follow existing naming patterns
3. Add the test to this README's coverage list
4. Ensure tests pass locally before pushing
5. Update documentation if adding new patterns
