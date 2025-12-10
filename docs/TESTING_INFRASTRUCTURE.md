# Testing Infrastructure Documentation

## Overview

This document describes the comprehensive test architecture refactoring completed to improve test isolation, standardization, and maintainability across the Surveyor client test suite.

## Table of Contents

1. [Testing Principles](#testing-principles)
2. [Test Data Management](#test-data-management)
3. [HTTP Mocking with MSW](#http-mocking-with-msw)
4. [PUG Template Testing](#pug-template-testing)
5. [Migration Guide](#migration-guide)
6. [Troubleshooting](#troubleshooting)

---

## Testing Principles

### Core Principles

1. **Test Isolation**: Each test receives fresh, independent data copies
2. **No Shared State**: Tests cannot mutate data that affects other tests
3. **Real HTTP Interception**: MSW intercepts fetch calls for realistic testing
4. **Real Templates**: Create forms test against actual PUG-rendered HTML
5. **Consistent Setup**: Centralized test initialization via `setupTest()`

### Test Structure

```
tests/client/
├── data/              # Test data definitions (factory functions)
├── helpers/           # Test utilities and setup
│   ├── testSetup.ts         # Central setup and MSW helpers
│   ├── renderPugView.ts     # PUG template rendering
│   ├── validEndpoints.ts    # API endpoint registry
│   └── responseQueueManager.ts  # MSW response queue
├── keywords/          # Reusable test keywords (for E2E)
└── unit/             # Unit test files
```

---

## Test Data Management

### Problem: Shared Mutable State

**Before**: Test data exported directly, allowing mutation between tests

```typescript
// ❌ Bad: Shared state
export const testData = [
    { id: 1, name: "Test" }
];

// Test 1 mutates data
testData[0].name = "Modified";

// Test 2 sees modified data!
```

### Solution: Factory Functions with Deep Copy

**After**: Export factory functions that return fresh copies

```typescript
// ✅ Good: Isolated state
import { deepCopy } from '../helpers/util';

const _testData = [
    { id: 1, name: "Test" }
];

export const testData = () => deepCopy(_testData) as typeof _testData;
```

### Deep Copy Implementation

The `deepCopy` utility preserves special object types:

```typescript
export function deepCopy(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof RegExp) return new RegExp(obj.source, obj.flags);
    if (Array.isArray(obj)) return obj.map(deepCopy);
    
    const copy: any = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            copy[key] = deepCopy(obj[key]);
        }
    }
    return copy;
}
```

### Usage in Tests

```typescript
import { testData } from '../data/myData';

describe('My Component', () => {
    test.each(testData())('$description', (testCase) => {
        // Each iteration gets fresh data
        const result = myFunction(testCase.input);
        expect(result).toEqual(testCase.expected);
    });
});
```

### Migrated Files (40/40)

- **Core Utilities**: alerts, clipboard, DOM, forms, formatting, navigation, passwords, UI helpers
- **Activity Modules**: filters, participants, recommendations, requirements, roles, slot operations
- **Entity/Form**: drivers, surveys, packing, events, entity selection
- **UI Components**: admin-matrix, drag-drop, inline-edit, list-actions, perm-matrix, reg-links, stub, timezone-select, user-dashboard, verify-password

---

## HTTP Mocking with MSW

### Architecture

The testing infrastructure uses [Mock Service Worker (MSW)](https://mswjs.io/) to intercept HTTP requests at the network level, providing realistic testing without backend dependencies.

### Components

#### 1. ResponseQueueManager

Manages queued responses for MSW handlers.

```typescript
class ResponseQueueManager {
    enqueue(method: string, path: string, response: QueuedResponse): void
    dequeue(method: string, path: string): QueuedResponse | undefined
    clear(): void
}
```

#### 2. Valid Endpoints Registry

Central registry of all API endpoints (`tests/client/helpers/validEndpoints.ts`):

```typescript
export function getAllEndpointsWithMethods(): Array<{method: HttpMethod; path: string}> {
    // Returns 107 registered endpoints
    // Format: [{method: 'POST', path: '/api/activity/:planId/assign'}, ...]
}
```

**Important**: DELETE operations often use POST method in this application!

```typescript
// DELETE endpoints use POST
if (endpoint.includes('/delete')) {
    result.push({ method: 'POST', path: endpoint });  // Primary method
    result.push({ method: 'DELETE', path: endpoint }); // Also support DELETE
}
```

#### 3. MSW Setup

MSW server initialized in `tests/client/setupTests.ts`:

```typescript
import { setupServer } from 'msw/node';

export const server = setupServer(/* initial handlers */);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => {
    server.resetHandlers();
    initializeAllEndpoints(); // ⚠️ CRITICAL: Reinitialize after reset
});
afterAll(() => server.close());
```

**Critical Fix**: MSW's `resetHandlers()` removes runtime handlers. We must reinitialize endpoint handlers after each test to maintain functionality.

### Helper Functions

#### mockApiSuccess

Queue a successful API response:

```typescript
mockApiSuccess(method: HttpMethod, path: string, data: any): void
```

**Example**:

```typescript
mockApiSuccess('POST', '/api/activity/123/assign', {
    status: 'success',
    data: { assignmentId: 'assign789' }
});
```

#### mockApiError

Queue an error API response:

```typescript
mockApiError(method: HttpMethod, path: string, message: string, statusCode: number): void
```

**Example**:

```typescript
mockApiError('POST', '/api/activity/123/assign', 'Permission denied', 403);
```

### Migration Pattern

#### Before: Jest Module Mock

```typescript
jest.mock('../../../src/public/js/core/http');
import * as http from '../../../src/public/js/core/http';

const mockPost = http.post as jest.MockedFunction<typeof http.post>;
mockPost.mockResolvedValue({ data: 'value' });

// Test
await myFunction();

// Assert mock calls
expect(mockPost).toHaveBeenCalledWith('/api/path', { payload: 'data' });
```

#### After: MSW Response Queue

```typescript
import { mockApiSuccess, mockApiError } from '../helpers/testSetup';

// Queue response before action
mockApiSuccess('POST', '/api/path', { data: 'value' });

// Test
await myFunction();

// Assert side effects, not mock calls
expect(mockShowAlert).toHaveBeenCalledWith('success', 'Saved successfully');
```

### Key Differences

1. **No jest.mock**: Real http module runs, MSW intercepts fetch calls
2. **Test Side Effects**: Assert on observable behavior, not mock calls
3. **Queue Before Action**: Responses must be queued before HTTP call is made
4. **Async Timing**: Add delays if needed: `await new Promise(resolve => setTimeout(resolve, 150))`

### Successfully Migrated Files (3/10)

1. ✅ **drag-drop.test.ts** - All tests passing
2. ✅ **activity-slot-operations.test.ts** - All tests passing
3. ✅ **activity-roles.test.ts** - All tests passing

### Files Kept with jest.mock (2/10)

1. **inline-edit.test.ts** - Module has top-level DOM access (architectural limitation)
2. **activity-slot-editor.test.ts** - Complex Bootstrap modal + async timing (reverted to jest.mock)

### Remaining Files (5/10)

Ready for migration with proven pattern:
- activity-assignments.test.ts
- activity-requirements.test.ts
- events.test.ts
- activity-recommendations.test.ts
- activity-recommendations-schedule.test.ts

---

## PUG Template Testing

### Problem: Manual DOM Mocking

**Before**: Tests manually construct HTML, which drifts from actual templates

```typescript
// ❌ Fragile: Manual DOM construction
document.body.innerHTML = `
    <form id="myForm">
        <input id="titleInput" />
        <button type="submit">Save</button>
    </form>
`;
```

### Solution: Render Real PUG Templates

**After**: Tests use actual server-side templates

```typescript
// ✅ Reliable: Real template
import { renderPugView } from '../helpers/renderPugView';

const html = renderPugView('surveyor/survey-create.pug', {
    data: { /* template data */ }
}, true); // extractContent=true to skip layout

document.body.innerHTML = html;
```

### renderPugView Helper

```typescript
function renderPugView(
    viewPath: string,
    locals?: Record<string, any>,
    extractContent = false
): string
```

**Parameters**:
- `viewPath`: Relative path from `src/views/` (e.g., 'surveyor/survey-create.pug')
- `locals`: Data passed to template (merged with default locals)
- `extractContent`: If true, extract content from layout wrapper

**Default Locals**: Matches app.ts middleware

```typescript
{
    user: null,
    guest: null,
    version: '0.0.0-test',
    settings: {
        localLoginEnabled: true,
        oidcEnabled: false,
        oidcName: 'OIDC',
        rootUrl: 'http://localhost:3000',
        imprintUrl: '#',
        privacyPolicyUrl: '#',
    },
    perms: {
        permMeta: [],
        defaultPerms: {},
        presets: [],
    },
    // Legacy permData support
    permData: {
        permMeta: [],
        defaultPerms: {},
        presets: [],
    }
}
```

### Migrated Files (4/4)

All create-form tests now use real PUG templates:

1. ✅ **activity-create.test.ts** → `activity/activity-create.pug`
2. ✅ **survey-create.test.ts** → `surveyor/survey-create.pug`
3. ✅ **packing-create.test.ts** → `packing/packing-create.pug`
4. ✅ **drivers-create.test.ts** → `drivers/drivers-create.pug` (+ template fix)

### Template Bug Found and Fixed

During migration, discovered `drivers-create.pug` was missing required element:

```pug
// ✅ Added missing element
.mb-3
    table.table.table-dark
        tbody#itemTable
```

This demonstrates the value of testing against real templates - bugs are caught during development!

### When NOT to Use PUG Templates

**View Initialization Tests**: Tests that verify initialization logic (not user interactions) should use minimal DOM:

```typescript
// ✅ Appropriate for init tests
document.body.innerHTML = `
    <div id="packingList"></div>
    <div data-perm-data='{"ITEM_EDIT": true}'></div>
`;

init(); // Test initialization logic
```

**Reasoning**: These tests validate function calls and setup order, not user interactions. Full PUG rendering would require complex permission objects without providing benefit.

---

## Migration Guide

### Adding New Tests

#### 1. Create Test Data File

```typescript
// tests/client/data/myFeature.ts
import { deepCopy } from '../helpers/util';

const _myFeatureData = {
    validInput: { name: 'Test', value: 42 },
    invalidInput: { name: '', value: -1 },
};

export const myFeatureData = () => deepCopy(_myFeatureData) as typeof _myFeatureData;
```

#### 2. Write Test Using setupTest

```typescript
// tests/client/unit/my-feature.test.ts
import { setupTest, mockApiSuccess } from '../helpers/testSetup';
import { myFeatureData } from '../data/myFeature';

describe('My Feature', () => {
    setupTest(); // Automatic cleanup and initialization

    test('processes valid input', async () => {
        const data = myFeatureData();
        
        mockApiSuccess('POST', '/api/my-feature', { success: true });
        
        const result = await processFeature(data.validInput);
        
        expect(result).toBeDefined();
        expect(mockShowAlert).toHaveBeenCalledWith('success', 'Processed');
    });
});
```

#### 3. For Create Forms: Use renderPugView

```typescript
import { renderPugView } from '../helpers/renderPugView';

beforeEach(() => {
    const html = renderPugView('my-feature/create.pug', {}, true);
    document.body.innerHTML = html;
});

test('validates form', () => {
    const form = document.getElementById('myForm') as HTMLFormElement;
    const input = document.getElementById('titleInput') as HTMLInputElement;
    
    input.value = 'Test Title';
    form.dispatchEvent(new Event('submit'));
    
    expect(mockApiSuccess).toHaveBeenCalled();
});
```

### Migrating Existing Tests from jest.mock

#### Step 1: Remove jest.mock

```diff
- jest.mock('../../../src/public/js/core/http');
- import * as http from '../../../src/public/js/core/http';
- const mockPost = http.post as jest.MockedFunction<typeof http.post>;
```

#### Step 2: Import MSW Helpers

```diff
+ import { mockApiSuccess, mockApiError } from '../helpers/testSetup';
```

#### Step 3: Replace Mock Setup

```diff
- mockPost.mockResolvedValue({ data: { id: '123' } });
+ mockApiSuccess('POST', '/api/endpoint', { data: { id: '123' } });

- mockPost.mockRejectedValue(new Error('Failed'));
+ mockApiError('POST', '/api/endpoint', 'Failed', 500);
```

#### Step 4: Update Assertions

```diff
- expect(mockPost).toHaveBeenCalledWith('/api/endpoint', { payload: 'data' });
+ expect(mockShowAlert).toHaveBeenCalledWith('success', 'Saved');
```

#### Step 5: Add Async Delays if Needed

```diff
  await myAsyncFunction();
+ await new Promise(resolve => setTimeout(resolve, 150));
  expect(mockShowAlert).toHaveBeenCalled();
```

---

## Troubleshooting

### Common Issues

#### Issue: Tests Fail in Suite but Pass Individually

**Symptom**: Test passes when run alone but fails in full suite

**Cause**: Response queue timing - responses from previous test consumed by next test

**Solution**: Add async delays between test cases

```typescript
test.each(testData())('$description', async (testCase) => {
    mockApiSuccess('POST', '/api/path', {});
    
    await myFunction();
    await new Promise(resolve => setTimeout(resolve, 150)); // ✅ Add delay
    
    expect(mockAlert).toHaveBeenCalled();
});
```

#### Issue: MSW Not Intercepting Requests

**Symptom**: Requests fall through, no handler found

**Causes & Solutions**:

1. **Handler not registered**: Check `validEndpoints.ts` includes your endpoint
2. **Wrong HTTP method**: Remember DELETE operations often use POST!
3. **Handlers reset**: Ensure `initializeAllEndpoints()` called in `afterEach`

```typescript
// ✅ Check endpoint registration
getAllEndpointsWithMethods().filter(e => e.path.includes('your-path'))

// ✅ Verify POST for deletes
if (endpoint.includes('/delete')) {
    result.push({ method: 'POST', path: endpoint }); // Not DELETE!
}
```

#### Issue: Document Undefined Error

**Symptom**: `ReferenceError: document is not defined`

**Cause**: Module has top-level code accessing `document` during import

**Solution**: Keep `jest.mock()` for this file - it's a code architecture issue, not test infrastructure

```typescript
// ✅ Acceptable exception
jest.mock('../../../src/public/js/core/http');
// Module can't be migrated without refactoring top-level DOM access
```

#### Issue: Mock State Pollution

**Symptom**: Mock call counts accumulate across test cases

**Solution**: Clear mocks explicitly in test loops

```typescript
testData.forEach(testCase => {
    test(testCase.description, async () => {
        mockAlert.mockClear(); // ✅ Clear before each test
        mockReload.mockClear();
        
        // Test code
    });
});
```

#### Issue: Event Listeners Not Working

**Symptom**: Button clicks or form submissions have no effect

**Cause**: `document.addEventListener` was mocked

**Solution**: Don't mock addEventListener - let events work normally

```typescript
// ❌ Bad: Breaks event system
jest.spyOn(document, 'addEventListener');

// ✅ Good: Let events work
// No mock needed for addEventListener
```

### Debugging Tips

#### 1. Enable MSW Logging

```typescript
server.listen({ onUnhandledRequest: 'error' }); // Strict mode
```

#### 2. Check Queue State

```typescript
console.log('Queue before:', responseQueue.queues);
mockApiSuccess('POST', '/api/path', {});
console.log('Queue after:', responseQueue.queues);
```

#### 3. Verify Handler Registration

```typescript
const handlers = server.listHandlers();
console.log('Registered handlers:', handlers.length);
```

#### 4. Add Debug Logging

```typescript
test('my test', async () => {
    console.log('Before action');
    await myFunction();
    console.log('After action');
    console.log('Mock calls:', mockAlert.mock.calls);
});
```

---

## Test Results Summary

### Overall Statistics

- **Total Tests**: 692/692 passing (100%)
- **Test Suites**: 43/43 passing (100%)
- **Test Execution Time**: ~25-30 seconds

### Phase Completion

| Phase | Status | Files | Success Rate |
|-------|--------|-------|--------------|
| Phase 1: Data Migration | ✅ Complete | 40/40 | 100% |
| Phase 2: MSW Setup | 🔄 Partial | 3/10 | 30% |
| Phase 3: PUG Templates | ✅ Complete | 4/4 | 100% |

### Infrastructure Reliability

- ✅ MSW/jsdom compatibility: **Fully functional**
- ✅ ResponseQueueManager: **Operational with 107 endpoints**
- ✅ Handler lifecycle: **Properly managed**
- ✅ PUG rendering: **Working with complete locals**

---

## Future Improvements

### Phase 2 Continuation (Optional)

5 files remaining for MSW migration:
- activity-assignments.test.ts (4 mock calls)
- activity-requirements.test.ts (16 mock calls)
- events.test.ts (20 mock calls)
- activity-recommendations.test.ts (34 mock calls)
- activity-recommendations-schedule.test.ts (35 mock calls)

Estimated effort: 6-9 hours

### Architecture Improvements

1. **Extract Timing Constants**: Move magic numbers (150ms, 200ms) to named constants
2. **Enhanced Queue Manager**: Per-test isolation to prevent cross-contamination
3. **Refactor inline-edit.ts**: Remove top-level DOM access to enable migration
4. **Template Coverage**: Consider adding more view-based tests as features evolve

---

## References

- [Mock Service Worker Documentation](https://mswjs.io/)
- [Jest Testing Framework](https://jestjs.io/)
- [PUG Template Engine](https://pugjs.org/)
- [Testing Best Practices](../TESTING.md)

---

## Changelog

### 2024-12-10: Initial Implementation

- ✅ Completed Phase 1: 40 data files migrated to factory pattern
- ✅ Completed Phase 2 Infrastructure: MSW setup with 107 endpoints
- ✅ Completed Phase 3: 4 create-form tests using real PUG templates
- ✅ Fixed critical issues: Handler lifecycle, DELETE/POST methods, event listeners
- ✅ Reverted activity-slot-editor.test.ts to jest.mock (complex modal timing)
- ✅ Documented inline-edit.test.ts architectural limitation
- ✅ Achieved 100% test pass rate (692/692)
