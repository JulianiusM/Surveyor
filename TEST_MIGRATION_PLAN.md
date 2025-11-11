# Test Migration Plan

This document provides templates and guidance for migrating remaining tests to data-driven and keyword-driven approaches.

## Migration Status

### ✅ Completed: Unit/Controller/Middleware (15/15 - 100%)

All unit, controller, and middleware tests have been successfully migrated. See **PROJECT_STATUS.md** for complete details.

### Remaining: Database and E2E Tests

#### Database Tests (~10 files)
- [ ] `tests/database/activity.service.edge.test.ts`
- [ ] `tests/database/activity.service.more.test.ts`
- [ ] `tests/database/activity.service.test.ts`
- [ ] `tests/database/app.test.ts`
- [ ] `tests/database/drivers.service.test.ts`
- [ ] `tests/database/event.service.test.ts`
- [ ] `tests/database/packing.service.test.ts`
- [ ] `tests/database/survey.service.test.ts`
- [ ] Other database integration tests

#### E2E Tests (7 files)
- [ ] `tests/e2e/auth.test.ts` - Authentication flows
- [ ] `tests/e2e/survey.test.ts` - Survey management
- [ ] `tests/e2e/packing.test.ts` - Packing list management
- [ ] `tests/e2e/activity.test.ts` - Activity plan management
- [ ] `tests/e2e/drivers.test.ts` - Drivers list management  
- [ ] `tests/e2e/navigation.test.ts` - UI navigation
- [ ] `tests/e2e/error-handling.test.ts` - Error scenarios

---

## Migration Process

### Steps to Migrate a Test File

1. **Analyze Current Test**
   - Identify hard-coded values
   - Find repeated patterns
   - Note test scenarios

2. **Create Test Data File**
   - Create `tests/data/<type>/<name>Data.ts`
   - Extract all test data to arrays
   - Organize by scenario type

3. **Create/Reuse Keywords**
   - Check existing keywords in `tests/keywords/`
   - Create new keywords if needed
   - Keep keywords modular and reusable

4. **Refactor Test File**
   - Import test data and keywords
   - Replace hard-coded values with data
   - Use `test.each()` for parameterized tests
   - Apply keywords for common operations

5. **Verify**
   - Run tests to ensure all pass
   - Compare test counts (usually increases)
   - Check coverage of edge cases

---

## Templates

### Test Data Template

```typescript
/**
 * Test data for <feature> tests
 */

export const <feature>Data = [
    {
        description: 'descriptive test case name',
        input: { /* input data */ },
        expected: { /* expected output */ },
        // Add fields as needed
    },
    // Add more test cases...
];
```

### Keyword Template

```typescript
/**
 * Keywords for <feature> testing
 */

/**
 * Setup mock with return value
 */
export function setupMock(mockFn: jest.Mock, returnValue: any): void {
    mockFn.mockResolvedValue(returnValue);
}

/**
 * Verify function was called with expected arguments
 */
export function verifyMockCall(mockFn: jest.Mock, ...expectedArgs: any[]): void {
    expect(mockFn).toHaveBeenCalledWith(...expectedArgs);
}

/**
 * Verify result matches expected
 */
export function verifyResult(actual: any, expected: any): void {
    expect(actual).toEqual(expected);
}
```

### Test File Template

```typescript
import { <feature>Data } from '../data/<type>/<feature>Data';
import { setupMock, verifyResult } from '../keywords/<type>/<feature>Keywords';

describe('<Feature> - Data Driven', () => {
    test.each(<feature>Data)('$description', async (testCase) => {
        // Setup
        setupMock(mockService, testCase.mockReturnValue);
        
        // Execute
        const result = await functionUnderTest(testCase.input);
        
        // Verify
        verifyResult(result, testCase.expected);
    });
});
```

---

## Examples

See migrated files for complete examples:
- `tests/controller/survey.controller.test.ts` - Controller pattern
- `tests/unit/util.test.ts` - Unit test pattern
- `tests/middleware/permissionMiddleware.test.ts` - Middleware pattern

See **TESTING.md** for comprehensive guide.
