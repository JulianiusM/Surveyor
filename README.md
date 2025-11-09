# Surveyor

A survey management application built with TypeScript, Express, and TypeORM.

## Getting Started

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
- User: `e2e_user`
- Password: `e2e_password`

## Running Tests

### Unit and Integration Tests

Run all unit and integration tests:

```bash
npm test
```

Watch mode for development:

```bash
npm run test:watch
```

### E2E Tests

The E2E tests use Playwright and require the application to be built first.

#### E2E Test Structure

The E2E tests are organized by feature area:

- `auth.test.ts` - Authentication flows (login, registration, password reset, tokens)
- `survey.test.ts` - Survey creation and management
- `packing.test.ts` - Packing list management
- `activity.test.ts` - Activity plan management
- `drivers.test.ts` - Drivers list management
- `navigation.test.ts` - UI navigation and accessibility
- `error-handling.test.ts` - Frontend error handling and validation

#### Running E2E Tests

Run E2E tests:

```bash
npm run e2e
```

Run E2E tests in headed mode (with browser visible):

```bash
npm run e2e:headed
```

Run E2E tests with UI:

```bash
npm run e2e:ui
```

#### E2E Configuration

E2E tests require a `.env.e2e` file with the following configuration:

```env
NODE_ENV=e2e
APP_PORT=3001
ROOT_URL=http://localhost:3001

# Database configuration
E2E_DB_HOST=localhost
E2E_DB_PORT=3306
E2E_DB_USER=e2e_user
E2E_DB_PASSWORD=e2e_password
E2E_DB_NAME=surveyor_e2e

# Test user credentials
E2E_ADMIN_USERNAME=tester
E2E_ADMIN_EMAIL=e2e@example.com
E2E_ADMIN_PASSWORD=passw0rd!

# Feature flags
LOCAL_LOGIN_ENABLED=1
OIDC_ENABLED=1
OIDC_BUTTON_LABEL=Login with OpenID
OIDC_ISSUER_BASE_URL=http://localhost:9999/mock-oidc
OIDC_CLIENT_ID=mock-client-id
OIDC_CLIENT_SECRET=mock-client-secret
OIDC_REDIRECT_URL=http://localhost:3001/users/oidc/callback
```

Note: OIDC configuration is used for frontend testing only (to test button visibility and UI behavior). Actual OIDC authentication flows are not tested in E2E tests.

#### E2E Test Coverage

The E2E tests focus on frontend behavior and user interactions, providing comprehensive coverage of:

**Authentication & User Management:**
- Login/logout flows and session management
- User registration and account activation
- Password reset workflows
- Token validation (activation and reset tokens)
- Token reuse prevention
- OIDC button visibility based on configuration
- Duplicate username prevention
- Password strength validation

**Entity Management:**
- Survey creation and validation
- Packing list creation and validation
- Activity plan creation and validation
- Drivers list creation and validation
- Form field validation (required fields)
- Empty state handling

**UI & Navigation:**
- Page titles and headings
- Navigation menu visibility for authenticated users
- Footer and branding elements
- Form labels and accessibility
- Responsive design elements
- Browser back button functionality
- Logo and home page links

**Error Handling:**
- 404 error pages
- Invalid token handling
- Form validation errors
- Server error responses
- Network error resilience
- Unauthorized access redirects
- Non-existent resource handling
- Console error monitoring

**Security & Access Control:**
- Authentication gates for protected routes
- Session timeout handling
- Proper redirects for unauthenticated users
- Form input validation

```bash
npm run e2e:ui
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

- Creates `surveyor_test` database for unit/integration tests
- Creates `surveyor_e2e` database for E2E tests
- Sets up required users and permissions
- Initializes the test database schema using `npm run typeorm -- schema:sync`
- Creates `.env.test` and `.env.e2e` files with appropriate credentials

## Development Scripts

- `npm run server:dev` - Run the server in development mode
- `npm run server:client` - Build client-side assets in watch mode
- `npm run server` - Run both server and client in development mode
- `npm run build` - Build the entire application
- `npm run build:server` - Build server-side code only
- `npm run build:client` - Build client-side assets only
- `npm run typeorm` - Run TypeORM migrations
- `npm run generate` - Generate database indexes

## Project Structure

- `src/` - Application source code
    - `modules/` - Application modules
    - `migrations/` - Database migrations
    - `public/` - Static assets
    - `views/` - View templates
- `tests/` - Test files
    - `unit/` - Unit tests
    - `controller/` - Controller tests
    - `middleware/` - Middleware tests
    - `database/` - Database integration tests
    - `e2e/` - End-to-end tests
    - `util/` - Test utilities and mocks
- `scripts/` - Utility scripts

## License

Private - All rights reserved