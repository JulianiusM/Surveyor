/**
 * Stub module - Default initialization for pages without custom JS
 * Provides basic navigation and entity list functionality
 */

import { initEntityLists, setCurrentNavLocation } from "./core/navigation";

/**
 * Initialize stub module
 */
export function init(): void {
    setCurrentNavLocation();
    initEntityLists();
}

// Expose to global scope
window.Surveyor.init = init;