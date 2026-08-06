# Building and Running

## Development

```bash
npm run server          # Run server with client watch mode
npm run server:dev      # Run server only
npm run server:client   # Build client assets in watch mode
```

## Production Build

```bash
npm run build           # Build everything
npm run build:server    # Build server only
npm run build:client    # Build client only
```

## Testing

```bash
npm test                # Run fast Vitest tests
npm run test:quick      # Run backend + frontend Vitest examples
npm run e2e             # Run focused Playwright E2E tests
```

## CI Pipeline

The GitHub Actions CI pipeline:

- Runs on push to `master` or `dev` branches
- Runs on pull requests to `master` or `dev`
- Sets up MariaDB 10.11 service container
- Sets up Node.js 24
- Creates test and E2E databases with proper users
- Runs fast Vitest tests and focused Playwright E2E tests
- Uploads test reports as artifacts

### Environment Files

- `tests/.env.test` - Disposable MariaDB configuration for TypeORM integration smoke tests
- `.env.e2e` - Configuration for E2E tests
- Both files are created automatically in CI
