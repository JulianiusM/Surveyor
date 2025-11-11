# Test Keywords Directory

This directory contains reusable test keywords (actions) for keyword-driven testing. Keywords are high-level, reusable test actions that abstract common test operations.

## Purpose

Keywords enable:

1. **Keyword-Driven Testing**: Compose tests from reusable, high-level actions
2. **Abstraction**: Hide implementation details behind meaningful keywords
3. **Reusability**: Share common test operations across multiple tests
4. **Maintainability**: Update test behavior in one place
5. **Readability**: Tests read like business requirements

## Structure

- `database/` - Keywords for database operations (CRUD, queries)
- `controller/` - Keywords for controller testing (preprocessing, validation)
- `middleware/` - Keywords for middleware testing (auth, permissions)
- `e2e/` - Keywords for E2E testing (login, navigation, form operations)
- `common/` - Shared keywords across all test types

## Usage

Keywords are functions that encapsulate common test operations:

```typescript
import { createTestSurvey, verifySurveyCreated } from '../keywords/database/surveyKeywords';

test('create survey with valid data', async () => {
    const surveyId = await createTestSurvey({ title: 'Test', description: 'Test desc' });
    await verifySurveyCreated(surveyId, { title: 'Test', description: 'Test desc' });
});
```

## Naming Conventions

Keywords should use clear, action-oriented names:
- `create*` - Create an entity
- `update*` - Update an entity
- `delete*` - Delete an entity
- `verify*` - Verify a condition or state
- `get*` - Retrieve data
- `setup*` - Set up test preconditions
- `cleanup*` - Clean up test data

## Guidelines

1. **Single Responsibility**: Each keyword should do one thing well
2. **Composability**: Keywords should be composable to build complex scenarios
3. **Error Handling**: Keywords should handle errors gracefully
4. **Return Values**: Return data that enables further assertions
5. **Documentation**: Document parameters and return values clearly
