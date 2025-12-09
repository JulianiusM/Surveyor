// tests/client/setupGlobals.ts
// Setup globals BEFORE any module imports
// This runs very early in the test lifecycle

// Setup window.Surveyor for activity.ts module
// This needs to exist before activity.ts is imported by any test
// Don't set init here - let the module set it
if (typeof window !== 'undefined') {
    (window as any).Surveyor = {
        entityId: ''
        // init will be set by activity.ts module
    };
}
