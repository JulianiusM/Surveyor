//Main function; similar in all modules to reduce redundancy in pug code
import {setCurrentNavLocation} from "./module_functions";

export function init() {
    registerEvents();
    setCurrentNavLocation();
}

export function registerEvents() {
    //Events regarding the password field

    // @ts-expect-error TS(2581): Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
    $("#password").on("keyup", function () {

        // @ts-expect-error TS(2581): Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        verifyPassword($("#password"), $("#password-info"));
    }).focusin(function () {

        // @ts-expect-error TS(2581): Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        verifyPassword($("#password"), $("#password-info"));
    }).focusout(function () {

        // @ts-expect-error TS(2581): Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        removeTooltip($("#password"), $("#password-info"));
    });

    //Events regarding password repeat field

    // @ts-expect-error TS(2581): Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
    $("#password_repeat").on("keyup", function () {

        // @ts-expect-error TS(2581): Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        matchPassword($("#password"), $("#password_repeat"), $("#password_repeat-info"));
    });

    //Events regarding submit button

    // @ts-expect-error TS(2581): Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
    $("#form").on("submit", function (event: any) {

        // @ts-expect-error TS(2581): Cannot find name '$'. Do you need to install type ... Remove this comment to see the full error message
        validate(event, $("#password"), $("#password_repeat"), $("#password-info"), $("#password_repeat-info"))
    });
}

// Expose to global scope
window.Surveyor = {
    init
};
