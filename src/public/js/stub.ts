/**
 * Stub module - Default initialization for pages without custom JS
 * Provides basic navigation and entity list functionality
 */

import {setCurrentNavLocation} from "./core/navigation";
import {loadPerms} from './core/permissions';

/**
 * Initialize stub module
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
}

// Expose to global scope
window.Surveyor.init = init;
