/**
 * User dashboard module
 * Simple module for user dashboard functionality
 */

import { initEntityLists, setCurrentNavLocation } from './core/navigation';

/**
 * Initialize user dashboard
 */
export function init(): void {
    setCurrentNavLocation();
    initEntityLists();
}

// Expose to global scope
window.Surveyor.init = init;
