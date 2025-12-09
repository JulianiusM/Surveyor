# Activity Module Refactoring Progress

**Date Started**: 2025-12-09  
**Current Phase**: Phase 1 - Fix Immediate Test Failures  
**Status**: In Progress

---

## Phase 1: Fix Immediate Test Failures (2-4 hours)

### Goal
Add proper cleanup and state management to fix 17 test failures without major architectural changes.

### Tasks

#### 1.1 activity-recommendations-schedule.ts ✅ IN PROGRESS
**Changes Required**:
- [ ] Add cleanup function that resets module state
- [ ] Export cleanup function for tests
- [ ] Track and remove event listeners on cleanup
- [ ] Dispose Bootstrap modal instances properly  
- [ ] Clear all module-level state arrays
- [ ] Update function signature to return cleanup function

**Files to Modify**:
- `src/public/js/modules/activity-recommendations-schedule.ts`
- `tests/client/unit/activity-recommendations-schedule.test.ts`

**Expected Outcome**: 2 test failures fixed → 687/731 passing (94.0%)

#### 1.2 activity-create.ts ⏳ NOT STARTED
**Changes Required**:
- [ ] Move slotMap into encapsulated state object
- [ ] Export clearState() function for tests
- [ ] Add optional dependency injection for getElementById
- [ ] Update tests to call clearState() in afterEach

**Files to Modify**:
- `src/public/js/modules/activity-create.ts`
- `tests/client/unit/activity-create.test.ts`

**Expected Outcome**: 15 test failures fixed → 702/731 passing (96.1%)

---

## Phase 2: Architectural Improvements (8-12 hours)

### Status: NOT STARTED

Will begin after Phase 1 completion.

### Planned Changes:
1. Introduce state management classes
2. Separate business logic from DOM manipulation
3. Implement consistent initialization pattern across all activity modules
4. Use dependency injection for better testability

---

## Implementation Notes

### Phase 1.1 Implementation Strategy

**Step 1**: Create cleanup tracking structure
```typescript
interface EventListenerTracking {
    element: HTMLElement;
    event: string;
    handler: EventListener;
}

const state = {
    recommendations: [],
    warnings: [],
    participantOptions: [],
    slots: [],
    existingAssignments: [],
    eventListeners: [] as EventListenerTracking[],
    addModalInstance: null as BootstrapModal | null
};
```

**Step 2**: Update event listener registration
```typescript
const addTrackedListener = (element: HTMLElement, event: string, handler: EventListener) => {
    element.addEventListener(event, handler);
    state.eventListeners.push({element, event, handler});
};
```

**Step 3**: Create and export cleanup function
```typescript
export function cleanupRecommendationScheduleView(): void {
    // Remove all tracked event listeners
    state.eventListeners.forEach(({element, event, handler}) => {
        element.removeEventListener(event, handler);
    });
    state.eventListeners = [];
    
    // Dispose modal if exists
    if (state.addModalInstance) {
        state.addModalInstance.dispose();
        state.addModalInstance = null;
    }
    
    // Clear all state arrays
    state.recommendations = [];
    state.warnings = [];
    state.participantOptions = [];
    state.slots = [];
    state.existingAssignments = [];
}
```

**Step 4**: Update test file
```typescript
afterEach(() => {
    setupTest({ clearDOM: true });
    cleanupRecommendationScheduleView(); // Add this line
});
```

---

## Testing Strategy

### Phase 1 Testing
1. Run activity-recommendations-schedule.test.ts in isolation
2. Run full test suite to check for regressions
3. Verify both previously failing tests now pass
4. Repeat for activity-create.test.ts

### Expected Results After Phase 1
- **Before**: 685/731 passing (93.8%)
- **After Step 1.1**: 687/731 passing (94.0%)  
- **After Step 1.2**: 702/731 passing (96.1%)

---

## Risk Assessment

### Phase 1 Risks: LOW
- Changes are additive (cleanup functions)
- No breaking changes to existing APIs
- Tests can still use jest.resetModules() as fallback
- Easy to revert if issues arise

### Phase 2 Risks: MEDIUM
- Significant refactoring of production code
- May require updates to multiple dependent modules
- Needs thorough testing across all activity features

---

## Next Steps

1. ✅ Create this progress tracking document
2. 🔄 Implement Phase 1.1 (activity-recommendations-schedule.ts)
3. ⏳ Test Phase 1.1 implementation
4. ⏳ Implement Phase 1.2 (activity-create.ts)
5. ⏳ Test Phase 1.2 implementation
6. ⏳ Document results and decide whether to proceed to Phase 2

---

## Rollback Plan

If issues arise:
1. Revert to backup files (.backup extension)
2. Git revert the commit
3. Document lessons learned
4. Adjust plan and retry

**Backup Files Created**:
- activity-recommendations-schedule.ts.backup

