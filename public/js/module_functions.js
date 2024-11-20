//Custom conditional class switch
function refreshState(object, validated, validatedClass, invalidatedClass) {
    if (validated && !object.hasClass(validatedClass)) {
        if (object.hasClass(invalidatedClass)) {
            object.removeClass(invalidatedClass);
        }
        object.addClass(validatedClass);
    } else if (!validated && !object.hasClass(invalidatedClass)) {
        if (object.hasClass(validatedClass)) {
            object.removeClass(validatedClass);
        }
        object.addClass(invalidatedClass);
    }
}

//Function to set current location on navbar active
function setCurrentNavLocation() {
    let path = window.location.pathname;

    //Set corresponding nav items active
    if (path.includes("/settings")) {
        $("#settings").addClass("active");
    } else if (path.includes("/login")) {
        $("#login").addClass("active");
    } else if (path.includes("/register")) {
        $("#register").addClass("active");
    }
}

//Verify password (GUI)
function verifyPassword(passwordObj, infoObj) {
    let isEightChars = (passwordObj.val().length >= 8);
    let hasLetter = (/[a-z,A-Z]/g.test(passwordObj.val()));
    let hasDigit = (/\d/g.test(passwordObj.val()));

    //Show tooltip
    infoObj.empty();
    infoObj.append(generateTooltip(isEightChars, hasLetter, hasDigit));

    //Show field status using bootstrap
    refreshState(passwordObj, isPasswordValid(passwordObj.val()), "is-valid", "is-invalid");
}

function matchPassword(passwordObj, passwordRepeatObj, repeatInfoObj) {
    //Hide or show "Passwords do not match"
    refreshState(repeatInfoObj, isPasswordRepeatValid(passwordObj.val(), passwordRepeatObj.val()), "invisible", "visible");

    //Show field status using bootstrap
    refreshState(passwordRepeatObj, isPasswordRepeatValid(passwordObj.val(), passwordRepeatObj.val()), "is-valid", "is-invalid");
}

//Remove tooltip if password is valid when password field looses focus
function removeTooltip(passwordObj, infoObj) {
    if (isPasswordValid(passwordObj.val())) {
        infoObj.empty();
    }
}

//Test if password is vailid
function isPasswordValid(password) {
    return password.length >= 8 && /[a-z,A-Z]/g.test(password) && /\d/g.test(password);
}

//Test if password repeat is valid
function isPasswordRepeatValid(password, passwordRepeat) {
    return password === passwordRepeat;
}

//Generate tooltip html
function generateTooltip(hasEight, hasLettr, hasDigit) {
    //Define tooltip parts
    let tooltipDesc = "<p><b>Password must match the following criteria:</b></p><ul style=\"list-style-type:none\">";
    let tooltipCritOK = "<li style=\"color:green\"><b>✓</b>";
    let tooltipCritNO = "<li style=\"color:red\">🗙";
    let tooltipCritEight = "At least <b>eight (8) characters</b>";
    let tooltipCritLettr = "At least <b>one (1) letter</b>";
    let tooltipCritDigit = "At least <b>one (1) digit</b>";
    let tooltipCritClose = "</li>"
    let tooltipClose = "</ul>";

    //Generate tooltip
    let tooltipHTML = tooltipDesc;
    if (hasEight) {
        tooltipHTML += tooltipCritOK;
    } else {
        tooltipHTML += tooltipCritNO;
    }
    tooltipHTML += (tooltipCritEight + tooltipCritClose);
    if (hasLettr) {
        tooltipHTML += tooltipCritOK;
    } else {
        tooltipHTML += tooltipCritNO;
    }
    tooltipHTML += (tooltipCritLettr + tooltipCritClose);
    if (hasDigit) {
        tooltipHTML += tooltipCritOK;
    } else {
        tooltipHTML += tooltipCritNO;
    }
    tooltipHTML += (tooltipCritDigit + tooltipCritClose);
    tooltipHTML += tooltipClose;

    return tooltipHTML;
}

//Validate passwords on submit and prevent submit if not
function validate(event, passwordObj, passwordRepeatObj, infoObj, passwordRepeatInfoObj) {
    let password = passwordObj.val();
    let passwordRepeat = passwordRepeatObj.val();

    if (!isPasswordValid(password) || !isPasswordRepeatValid(password, passwordRepeat)) {
        event.preventDefault();
        event.stopPropagation();
        alert("Please check that both the password and the password repetition are vaild!");
        verifyPassword(passwordObj, infoObj);
        removeTooltip(passwordObj, infoObj);
        matchPassword(passwordObj, passwordRepeatObj, passwordRepeatInfoObj);
    }
}

function objectToArray(obj) {
    var arr = [];
    var idx = [];
    var keys = Object.keys(obj);

    keys.sort(function (a, b) {
        return a - b;
    });

    for (var i = 0; i < keys.length; i++) {
        arr.push(obj[keys[i]]);
        idx.push(keys[i]);
    }

    return [idx, arr];
}

//Pads numbers
function padNumber(num) {
    return ("00" + num).substr(-2, 2);
}