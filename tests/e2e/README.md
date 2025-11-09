# End-to-End Test Documentation

This directory contains Playwright E2E tests for the Surveyor application. These tests focus on frontend behavior and user interactions.

## Test Organization

### File Structure

```
tests/e2e/
├── auth.test.ts           # Authentication flows and user management
├── survey.test.ts         # Survey entity management
├── packing.test.ts        # Packing list management
├── activity.test.ts       # Activity plan management
├── drivers.test.ts        # Drivers list management
├── navigation.test.ts     # UI navigation and page structure
├── error-handling.test.ts # Error scenarios and validation
└── README.md             # This file
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

### Common Helpers

All test files include a `login()` helper function:

```typescript
async function login(page: any) {
    await page.goto('/users/login');
    await page.locator('input[name="username"]').fill(USERNAME);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', {name: /login/i}).click();
    await expect(page).toHaveURL(/\/users\/dashboard/);
}
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
