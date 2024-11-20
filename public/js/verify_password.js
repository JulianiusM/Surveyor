//Main function; similar in all modules to reduce redundancy in pug code
function init() {
    registerEvents();
    setCurrentNavLocation();
}

function registerEvents() {
    //Events regarding the password field
    $("#password").on("keyup", function () {
        verifyPassword($("#password"), $("#password-info"));
    });
    $("#password").focusin(function () {
        verifyPassword($("#password"), $("#password-info"));
    });
    $("#password").focusout(function () {
        removeTooltip($("#password"), $("#password-info"));
    });

    //Events regarding password repeat field
    $("#password_repeat").on("keyup", function () {
        matchPassword($("#password"), $("#password_repeat"), $("#password_repeat-info"));
    });

    //Events regarding submit button
    $("#form").on("submit", function (event) {
        validate(event, $("#password"), $("#password_repeat"), $("#password-info"), $("#password_repeat-info"))
    });
}
