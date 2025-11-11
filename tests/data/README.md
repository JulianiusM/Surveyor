# Test Data Directory

This directory contains test data files for data-driven testing. Test data is separated from test logic to enable:

1. **Data-Driven Testing**: Run the same test logic with multiple data sets
2. **Maintainability**: Update test data without changing test code
3. **Reusability**: Share test data across multiple tests
4. **Clarity**: Clear separation between test scenarios and test implementation

## Structure

- `unit/` - Test data for unit tests
- `controller/` - Test data for controller tests
- `middleware/` - Test data for middleware tests
- `database/` - Test data for database integration tests
- `e2e/` - Test data for end-to-end tests
- `builders/` - Test data builders and factories
- `fixtures/` - Fixed test data sets

## Usage

Test data files export data sets that can be imported and used with parameterized tests:

```typescript
import { surveyTestData } from '../data/controller/surveyData';

describe.each(surveyTestData.preprocessCreate)('preprocessCreate with %s', (description, input, expected) => {
    it(description, () => {
        const result = preprocessCreate(input);
        expect(result).toEqual(expected);
    });
});
```

## Data Format

Test data should be organized as arrays of test cases, where each case contains:
- Description/name of the test case
- Input data
- Expected output
- Any additional context or metadata

Example:
```typescript
export const exampleData = [
    {
        description: 'handles valid input',
        input: { value: 'test' },
        expected: { result: 'TEST' },
    },
    {
        description: 'handles empty input',
        input: { value: '' },
        expected: { result: '' },
    },
];
```
