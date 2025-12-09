// tests/client/setupGlobals.ts
// Setup globals BEFORE any module imports
// This runs very early in the test lifecycle

// Setup window.Surveyor for activity.ts module
// This needs to exist before activity.ts is imported by any test
// Don't set init here - let the module set it
(global as any).window = (global as any).window || {};
if (typeof window !== 'undefined') {
    if (!window.Surveyor) {
        (window as any).Surveyor = {};
    }
    window.Surveyor.entityId = '';
    // init will be set by activity.ts module
}
