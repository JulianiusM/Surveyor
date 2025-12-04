//Main function; similar in all modules to reduce redundancy in pug code
import {
    matchPassword,
    removeTooltip,
    setCurrentNavLocation,
    validate,
    verifyPassword
} from "./modules/module_functions";

export function init() {
    registerEvents();
    setCurrentNavLocation();
}

export function registerEvents() {
    //Events regarding the password field
    $("#password").on("keyup", function () {
        verifyPassword($("#password"), $("#password-info"));
    }).on('focusin', function () {
        verifyPassword($("#password"), $("#password-info"));
    }).on('focusout', function () {
        removeTooltip($("#password"), $("#password-info"));
    });

    //Events regarding password repeat field
    $("#password_repeat").on("keyup", function () {
        matchPassword($("#password"), $("#password_repeat"), $("#password_repeat-info"));
    });

    //Events regarding submit button
    $("#form").on("submit", function (event: any) {
        validate(event, $("#password"), $("#password_repeat"), $("#password-info"), $("#password_repeat-info"))
    });
}

// Expose to global scope
window.Surveyor.init = init;
