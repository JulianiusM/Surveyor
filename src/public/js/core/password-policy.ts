/** Existing registration-browser checks, shared by the native and Vue forms. */
export function passwordCriteria(password: string) {
    return {length: password.length >= 8, letter: /[a-z,A-Z]/u.test(password), digit: /\d/u.test(password)};
}

export function isRegistrationPasswordValid(password?: string): boolean {
    return !!password && Object.values(passwordCriteria(password)).every(Boolean);
}
