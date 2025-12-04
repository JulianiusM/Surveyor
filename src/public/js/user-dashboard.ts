/**
 * User dashboard module
 * Simple module for user dashboard functionality
 */

import { initEntityLists, setCurrentNavLocation } from './core/navigation';
import { loadPerms } from './core/permissions';

/**
 * Initialize user dashboard
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
    initEntityLists();
}

// Expose to global scope
window.Surveyor.init = init;
