/**
 * Password verification module
 * Handles password validation UI and form submission
 */

import { setCurrentNavLocation } from './core/navigation';
import { loadPerms } from './core/permissions';
import {
    matchPassword,
    removeTooltip,
    validate,
    verifyPassword
} from './core/password-validation';

/**
 * Register password verification events
 */
function registerEvents(): void {
    // Events regarding the password field
    $("#password").on("keyup", function () {
        verifyPassword($("#password"), $("#password-info"));
    }).on('focusin', function () {
        verifyPassword($("#password"), $("#password-info"));
    }).on('focusout', function () {
        removeTooltip($("#password"), $("#password-info"));
    });

    // Events regarding password repeat field
    $("#password_repeat").on("keyup", function () {
        matchPassword($("#password"), $("#password_repeat"), $("#password_repeat-info"));
    });

    // Events regarding submit button
    $("#form").on("submit", function (event: any) {
        validate(event, $("#password"), $("#password_repeat"), $("#password-info"), $("#password_repeat-info"));
    });
}

/**
 * Initialize password verification module
 */
export function init(): void {
    registerEvents();
    setCurrentNavLocation();
    loadPerms();
}

// Expose to global scope
window.Surveyor.init = init;
