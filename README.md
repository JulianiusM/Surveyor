# Surveyor

A survey management application built with TypeScript, Express, and TypeORM.

## Getting Started

### Prerequisites

- Node.js 20 or higher
- MariaDB 10.11 or higher
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

### Local Development

For local testing with Docker, you can use the provided Docker Compose file:

```bash
docker-compose -f docker-compose.mariadb.test.yml up -d
```

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
