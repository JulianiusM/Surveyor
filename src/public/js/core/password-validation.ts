/**
 * Core password validation utilities
 * Provides password strength checking and validation
 */

/**
 * Update element class state based on validation
 * @param object jQuery element
 * @param validated Whether validation passed
 * @param validatedClass Class to add when valid
 * @param invalidatedClass Class to add when invalid
 */
export function refreshState(
    object: JQuery<HTMLElement>,
    validated: boolean,
    validatedClass: string,
    invalidatedClass: string
): void {
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

/**
 * Test if password meets requirements
 * @param password Password to test
 * @returns True if password is valid
 */
export function isPasswordValid(password?: string): boolean {
    return !!password && password.length >= 8 && /[a-z,A-Z]/g.test(password) && /\d/g.test(password);
}

/**
 * Test if password repeat matches original
 * @param password Original password
 * @param passwordRepeat Repeated password
 * @returns True if passwords match
 */
export function isPasswordRepeatValid(password?: string, passwordRepeat?: string): boolean {
    return password === passwordRepeat;
}

/**
 * Generate password requirements tooltip HTML
 * @param hasEight Has 8+ characters
 * @param hasLetter Has at least one letter
 * @param hasDigit Has at least one digit
 * @returns HTML string for tooltip
 */
export function generateTooltip(hasEight: boolean, hasLetter: boolean, hasDigit: boolean): string {
    // Define tooltip parts
    const tooltipDesc = "<p><b>Password must match the following criteria:</b></p><ul style=\"list-style-type:none\">";
    const tooltipCritOK = "<li style=\"color:green\"><b>✓</b>";
    const tooltipCritNO = "<li style=\"color:red\">🗙";
    const tooltipCritEight = "At least <b>eight (8) characters</b>";
    const tooltipCritLetter = "At least <b>one (1) letter</b>";
    const tooltipCritDigit = "At least <b>one (1) digit</b>";
    const tooltipCritClose = "</li>";
    const tooltipClose = "</ul>";

    // Generate tooltip
    let tooltipHTML = tooltipDesc;
    tooltipHTML += hasEight ? tooltipCritOK : tooltipCritNO;
    tooltipHTML += (tooltipCritEight + tooltipCritClose);
    tooltipHTML += hasLetter ? tooltipCritOK : tooltipCritNO;
    tooltipHTML += (tooltipCritLetter + tooltipCritClose);
    tooltipHTML += hasDigit ? tooltipCritOK : tooltipCritNO;
    tooltipHTML += (tooltipCritDigit + tooltipCritClose);
    tooltipHTML += tooltipClose;

    return tooltipHTML;
}

/**
 * Verify password meets requirements and update UI
 * @param passwordObj Password input jQuery object
 * @param infoObj Info display jQuery object
 */
export function verifyPassword(passwordObj: JQuery<HTMLInputElement>, infoObj: JQuery<HTMLElement>): void {
    const isEightChars = ((passwordObj.val()?.length || 0) >= 8);
    const hasLetter = (/[a-z,A-Z]/g.test(passwordObj.val() ?? ''));
    const hasDigit = (/\d/g.test(passwordObj.val() ?? ''));

    // Show tooltip
    infoObj.empty();
    infoObj.append(generateTooltip(isEightChars, hasLetter, hasDigit));

    // Show field status using bootstrap
    refreshState(passwordObj, isPasswordValid(passwordObj.val()), "is-valid", "is-invalid");
}

/**
 * Check if passwords match and update UI
 * @param passwordObj Password input jQuery object
 * @param passwordRepeatObj Password repeat input jQuery object
 * @param repeatInfoObj Repeat info display jQuery object
 */
export function matchPassword(
    passwordObj: JQuery<HTMLInputElement>,
    passwordRepeatObj: JQuery<HTMLInputElement>,
    repeatInfoObj: JQuery<HTMLElement>
): void {
    // Hide or show "Passwords do not match"
    refreshState(repeatInfoObj, isPasswordRepeatValid(passwordObj.val(), passwordRepeatObj.val()), "invisible", "visible");

    // Show field status using bootstrap
    refreshState(passwordRepeatObj, isPasswordRepeatValid(passwordObj.val(), passwordRepeatObj.val()), "is-valid", "is-invalid");
}

/**
 * Remove tooltip if password is valid
 * @param passwordObj Password input jQuery object
 * @param infoObj Info display jQuery object
 */
export function removeTooltip(passwordObj: JQuery<HTMLInputElement>, infoObj: JQuery<HTMLElement>): void {
    if (isPasswordValid(passwordObj.val() ?? '')) {
        infoObj.empty();
    }
}

/**
 * Validate passwords on submit
 * @param event Form submit event
 * @param passwordObj Password input jQuery object
 * @param passwordRepeatObj Password repeat input jQuery object
 * @param infoObj Password info display jQuery object
 * @param passwordRepeatInfoObj Password repeat info display jQuery object
 */
export function validate(
    event: Event,
    passwordObj: JQuery<HTMLInputElement>,
    passwordRepeatObj: JQuery<HTMLInputElement>,
    infoObj: JQuery<HTMLElement>,
    passwordRepeatInfoObj: JQuery<HTMLElement>
): void {
    const password = passwordObj.val();
    const passwordRepeat = passwordRepeatObj.val();

    if (!isPasswordValid(password) || !isPasswordRepeatValid(password, passwordRepeat)) {
        event.preventDefault();
        event.stopPropagation();
        alert("Please check that both the password and the password repetition are valid!");
        verifyPassword(passwordObj, infoObj);
        removeTooltip(passwordObj, infoObj);
        matchPassword(passwordObj, passwordRepeatObj, passwordRepeatInfoObj);
    }
}
