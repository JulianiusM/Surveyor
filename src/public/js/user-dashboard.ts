/**
 * User dashboard module
 * Simple module for user dashboard functionality
 */

import {setCurrentNavLocation} from './core/navigation';
import {loadPerms} from './core/permissions';
import {initEntityOverview} from "./modules/entity-cards-overview";

let disposeOverviews: Array<() => void> = [];

function dispose(): void {
    for (const cleanup of disposeOverviews) cleanup();
    disposeOverviews = [];
}

/**
 * Initialize user dashboard
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
    // Replace bindings when reinitialized. Each collection keeps its own region state/history, while
    // server fragments reuse the same card markup and the page-wide delegated archival controls.
    dispose();
    for (const selector of ['#participationLists', '#entityLists']) {
        const cleanup = initEntityOverview(selector, {paged: true});
        if (cleanup) disposeOverviews.push(cleanup);
    }
}

// Expose to global scope when running in a browser; keeping this guarded makes imports safe in tests.
if (typeof window !== 'undefined') {
    if (!window.Surveyor) window.Surveyor = {};
    window.Surveyor.init = init;
    window.addEventListener('pagehide', dispose);
}
