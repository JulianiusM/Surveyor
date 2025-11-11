# Test Migration Plan

This document tracks the progress of migrating tests to data-driven and keyword-driven approaches.

## Migration Status

### Completed Migrations ✅

| Test File | Original Tests | New Tests | Improvement | Status |
|-----------|---------------|-----------|-------------|--------|
| `tests/controller/survey.controller.test.ts` | 13 | 26 | +100% | ✅ Complete |
| `tests/unit/util.test.ts` | 9 | 39 | +333% | ✅ Complete |
| `tests/middleware/permissionMiddleware.test.ts` | 16 | 33 | +106% | ✅ Complete |
| **Totals** | **38** | **98** | **+158%** | |

### Remaining Migrations

#### Unit Tests (6 remaining)
- [ ] `tests/unit/renderer.test.ts` - Template rendering tests
- [ ] `tests/unit/errors.test.ts` - Error class tests
- [ ] `tests/unit/email.test.ts` - Email sending tests
- [ ] `tests/unit/settings.test.ts` - Settings management tests
- [ ] `tests/unit/asyncHandler.test.ts` - Async handler tests
- [ ] `tests/unit/genericErrorHandler.test.ts` - Error handler tests

#### Controller Tests (5 remaining)
- [ ] `tests/controller/activity.controller.test.ts` - Activity controller tests
- [ ] `tests/controller/packing.controller.test.ts` - Packing controller tests
- [ ] `tests/controller/drivers.controller.test.ts` - Drivers controller tests
- [ ] `tests/controller/event.controller.test.ts` - Event controller tests
- [ ] `tests/controller/user.controller.test.ts` - User controller tests

#### Middleware Tests (1 remaining)
- [ ] `tests/middleware/guestFlowFactory.test.ts` - Guest flow factory tests

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
- [ ] `tests/e2e/error-handling.test.ts` - Error handling

## Migration Process

### Standard Migration Steps

1. **Analyze Current Test**
   - Identify hard-coded values
   - Find repeated patterns
   - Note common operations

2. **Create Test Data File**
   - Create `tests/data/<type>/<testName>Data.ts`
   - Export test case arrays
   - Include success and failure scenarios
   - Add edge cases

3. **Create or Reuse Keywords**
   - Check existing keywords in `tests/keywords/`
   - Create new keywords if needed
   - Follow naming conventions

4. **Refactor Test File**
   - Import test data and keywords
   - Replace hard-coded values with data
   - Use `test.each()` for parameterized tests
   - Apply keywords for common operations

5. **Verify and Compare**
   - Run refactored tests
   - Compare test counts (should increase)
   - Verify all scenarios covered
   - Check that tests pass

6. **Replace Original**
   - Create backup if desired
   - Replace original with refactored version
   - Remove backup after verification

### Test Data Template

```typescript
/**
 * Test data for <feature> tests
 */

// Success scenarios
export const <feature>SuccessData = [
    {
        description: 'descriptive test case name',
        input: { /* input data */ },
        expected: { /* expected output */ },
    },
    // ... more cases
];

// Failure scenarios
export const <feature>ErrorData = [
    {
        description: 'error case description',
        input: { /* input that causes error */ },
        errorType: 'ErrorClassName',
        errorMessage: /pattern/i,
    },
    // ... more cases
];

// Edge cases
export const <feature>EdgeCaseData = [
    // ... edge cases
];
```

### Keyword Template

```typescript
/**
 * Keywords for <feature> testing
 */

/**
 * Setup <feature> for testing
 */
export function setup<Feature>(config: any): void {
    // Setup logic
}

/**
 * Verify <feature> result
 */
export function verify<Feature>(actual: any, expected: any): void {
    // Verification logic
}

/**
 * Create test <feature>
 */
export function createTest<Feature>(data: any): any {
    // Creation logic
    return result;
}
```

## Priority Order

Based on complexity and value, migrate in this order:

### High Priority (Week 1)
1. ✅ Controller tests (high value, clear patterns)
2. ✅ Middleware tests (similar to controllers)
3. ✅ Unit tests (straightforward, good practice)

### Medium Priority (Week 2)
4. [ ] Remaining controller tests
5. [ ] Remaining unit tests
6. [ ] Remaining middleware tests

### Lower Priority (Week 3+)
7. [ ] Database integration tests (require DB keywords)
8. [ ] E2E tests (require UI keywords, more complex)

## Infrastructure Needs

### Existing Infrastructure ✅
- [x] Common test data builders (`tests/data/builders/commonBuilders.ts`)
- [x] Controller keywords (`tests/keywords/common/controllerKeywords.ts`)
- [x] Middleware keywords (`tests/keywords/middleware/middlewareKeywords.ts`)
- [x] Documentation (TESTING.md)

### Needed Infrastructure
- [ ] Database test keywords
  - [ ] Entity creation keywords
  - [ ] Query verification keywords
  - [ ] Cleanup keywords
  - [ ] Transaction keywords
- [ ] E2E test keywords
  - [ ] Login/logout keywords
  - [ ] Navigation keywords
  - [ ] Form interaction keywords
  - [ ] Verification keywords

## Benefits Realized

From completed migrations:

1. **Increased Test Coverage**: +158% more tests across migrated files
2. **Better Organization**: Test data separated from test logic
3. **Improved Maintainability**: Changes to test behavior in one place
4. **Enhanced Readability**: Tests read like specifications
5. **Reduced Duplication**: Reusable keywords and data
6. **Easier Test Creation**: Copy data structure for new tests

## Lessons Learned

1. **Start Small**: Begin with well-structured tests (survey controller was good choice)
2. **Build Infrastructure**: Create builders and keywords as you go
3. **Use Templates**: Having templates speeds up migration
4. **Test Incrementally**: Run tests after each step
5. **Document Patterns**: Keep TESTING.md updated with examples

## Estimated Effort

Based on completed migrations:

- **Simple test file**: 30-45 minutes (unit tests)
- **Medium test file**: 45-90 minutes (controller/middleware tests)
- **Complex test file**: 90-180 minutes (database/e2e tests)

**Total remaining effort**: ~25-35 hours for all remaining files

## Success Metrics

- [ ] All 31 test files migrated
- [ ] Test count increased by >100%
- [ ] All tests passing
- [ ] Code coverage maintained or improved
- [ ] Documentation complete
- [ ] Team trained on new approach

## Notes

- Keep backup files until migration fully verified
- Run full test suite after major changes
- Update documentation with new patterns discovered
- Share learnings with team during migration

---

Last Updated: 2025-11-11
Status: In Progress (3/31 files completed)
