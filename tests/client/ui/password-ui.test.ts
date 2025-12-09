// tests/client/ui/password-ui.test.ts
// UI tests for password validation DOM behavior
import {
    verifyPassword,
    matchPassword,
    removeTooltip,
    validate,
} from '../../../src/public/js/core/password-validation';
import $ from 'jquery';

// Mock jQuery for the tests
(global as any).$ = $;
(global as any).jQuery = $;

describe('password validation UI', () => {
    let passwordInput: HTMLInputElement;
    let passwordRepeatInput: HTMLInputElement;
    let infoDiv: HTMLDivElement;
    let repeatInfoDiv: HTMLDivElement;

    beforeEach(() => {
        // Set up DOM structure similar to actual registration/password forms
        document.body.innerHTML = `
            <form id="password-form">
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" class="form-control" />
                    <div id="password-info"></div>
                </div>
                <div class="form-group">
                    <label for="password-repeat">Repeat Password</label>
                    <input type="password" id="password-repeat" class="form-control" />
                    <div id="password-repeat-info" class="invisible">Passwords do not match</div>
                </div>
                <button type="submit">Submit</button>
            </form>
        `;

        passwordInput = document.getElementById('password') as HTMLInputElement;
        passwordRepeatInput = document.getElementById('password-repeat') as HTMLInputElement;
        infoDiv = document.getElementById('password-info') as HTMLDivElement;
        repeatInfoDiv = document.getElementById('password-repeat-info') as HTMLDivElement;
    });

    describe('verifyPassword', () => {
        test('shows validation feedback when password is too short', () => {
            passwordInput.value = 'abc';
            const $password = $(passwordInput);
            const $info = $(infoDiv);

            verifyPassword($password, $info);

            expect(infoDiv.innerHTML).toContain('At least 8 characters');
            expect(infoDiv.innerHTML).toContain('bi-x-circle');
            expect(passwordInput.classList.contains('is-invalid')).toBe(true);
        });

        test('shows success when password meets all requirements', () => {
            passwordInput.value = 'Password123';
            const $password = $(passwordInput);
            const $info = $(infoDiv);

            verifyPassword($password, $info);

            expect(infoDiv.innerHTML).toContain('bi-check-circle-fill');
            expect(passwordInput.classList.contains('is-valid')).toBe(true);
            expect(passwordInput.classList.contains('is-invalid')).toBe(false);
        });

        test('shows mixed feedback for partially valid password', () => {
            passwordInput.value = 'password'; // long enough, has letters, but no digits
            const $password = $(passwordInput);
            const $info = $(infoDiv);

            verifyPassword($password, $info);

            expect(infoDiv.innerHTML).toContain('bi-check-circle-fill'); // for length and letters
            expect(infoDiv.innerHTML).toContain('bi-x-circle'); // for missing digit
            expect(passwordInput.classList.contains('is-invalid')).toBe(true);
        });

        test('removes validation classes when password is empty', () => {
            // First set as valid
            passwordInput.value = 'Password123';
            passwordInput.classList.add('is-valid');
            
            // Then clear
            passwordInput.value = '';
            const $password = $(passwordInput);
            const $info = $(infoDiv);

            verifyPassword($password, $info);

            expect(passwordInput.classList.contains('is-valid')).toBe(false);
            expect(passwordInput.classList.contains('is-invalid')).toBe(false);
        });

        test('updates feedback for all criteria', () => {
            passwordInput.value = 'Password123';
            const $password = $(passwordInput);
            const $info = $(infoDiv);

            verifyPassword($password, $info);

            expect(infoDiv.innerHTML).toContain('At least 8 characters');
            expect(infoDiv.innerHTML).toContain('At least one letter');
            expect(infoDiv.innerHTML).toContain('At least one digit');
            
            // All should show success
            const successIcons = infoDiv.querySelectorAll('.bi-check-circle-fill');
            expect(successIcons.length).toBe(3);
        });
    });

    describe('matchPassword', () => {
        test('shows error when passwords do not match', () => {
            passwordInput.value = 'Password123';
            passwordRepeatInput.value = 'Password124';
            
            const $password = $(passwordInput);
            const $passwordRepeat = $(passwordRepeatInput);
            const $repeatInfo = $(repeatInfoDiv);

            matchPassword($password, $passwordRepeat, $repeatInfo);

            expect(repeatInfoDiv.classList.contains('visible')).toBe(true);
            expect(repeatInfoDiv.classList.contains('invisible')).toBe(false);
            expect(passwordRepeatInput.classList.contains('is-invalid')).toBe(true);
        });

        test('hides error when passwords match', () => {
            passwordInput.value = 'Password123';
            passwordRepeatInput.value = 'Password123';
            
            const $password = $(passwordInput);
            const $passwordRepeat = $(passwordRepeatInput);
            const $repeatInfo = $(repeatInfoDiv);

            matchPassword($password, $passwordRepeat, $repeatInfo);

            expect(repeatInfoDiv.classList.contains('invisible')).toBe(true);
            expect(repeatInfoDiv.classList.contains('visible')).toBe(false);
            expect(passwordRepeatInput.classList.contains('is-valid')).toBe(true);
        });

        test('handles empty repeat password', () => {
            passwordInput.value = 'Password123';
            passwordRepeatInput.value = '';
            
            const $password = $(passwordInput);
            const $passwordRepeat = $(passwordRepeatInput);
            const $repeatInfo = $(repeatInfoDiv);

            matchPassword($password, $passwordRepeat, $repeatInfo);

            expect(repeatInfoDiv.classList.contains('visible')).toBe(true);
            expect(passwordRepeatInput.classList.contains('is-invalid')).toBe(true);
        });
    });

    describe('removeTooltip', () => {
        test('clears feedback when password is valid', () => {
            passwordInput.value = 'Password123';
            infoDiv.innerHTML = '<p>Some feedback</p>';
            
            const $password = $(passwordInput);
            const $info = $(infoDiv);

            removeTooltip($password, $info);

            expect(infoDiv.innerHTML).toBe('');
        });

        test('keeps feedback when password is invalid', () => {
            passwordInput.value = 'short';
            infoDiv.innerHTML = '<p>Some feedback</p>';
            
            const $password = $(passwordInput);
            const $info = $(infoDiv);

            removeTooltip($password, $info);

            expect(infoDiv.innerHTML).toBe('<p>Some feedback</p>');
        });
    });

    describe('validate', () => {
        let form: HTMLFormElement;

        beforeEach(() => {
            form = document.getElementById('password-form') as HTMLFormElement;
        });

        test('prevents submission when password is invalid', () => {
            passwordInput.value = 'short';
            passwordRepeatInput.value = 'short';
            
            const event = new Event('submit', { bubbles: true, cancelable: true });
            const preventDefault = jest.spyOn(event, 'preventDefault');
            const stopPropagation = jest.spyOn(event, 'stopPropagation');
            const alertSpy = jest.spyOn(window, 'alert').mockImplementation();
            
            const $password = $(passwordInput);
            const $passwordRepeat = $(passwordRepeatInput);
            const $info = $(infoDiv);
            const $repeatInfo = $(repeatInfoDiv);

            validate(event, $password, $passwordRepeat, $info, $repeatInfo);

            expect(preventDefault).toHaveBeenCalled();
            expect(stopPropagation).toHaveBeenCalled();
            expect(alertSpy).toHaveBeenCalledWith(
                'Please check that both the password and the password repetition are valid!'
            );

            alertSpy.mockRestore();
        });

        test('prevents submission when passwords do not match', () => {
            passwordInput.value = 'Password123';
            passwordRepeatInput.value = 'Password124';
            
            const event = new Event('submit', { bubbles: true, cancelable: true });
            const preventDefault = jest.spyOn(event, 'preventDefault');
            const alertSpy = jest.spyOn(window, 'alert').mockImplementation();
            
            const $password = $(passwordInput);
            const $passwordRepeat = $(passwordRepeatInput);
            const $info = $(infoDiv);
            const $repeatInfo = $(repeatInfoDiv);

            validate(event, $password, $passwordRepeat, $info, $repeatInfo);

            expect(preventDefault).toHaveBeenCalled();
            expect(alertSpy).toHaveBeenCalled();

            alertSpy.mockRestore();
        });

        test('allows submission when both passwords are valid and match', () => {
            passwordInput.value = 'Password123';
            passwordRepeatInput.value = 'Password123';
            
            const event = new Event('submit', { bubbles: true, cancelable: true });
            const preventDefault = jest.spyOn(event, 'preventDefault');
            const alertSpy = jest.spyOn(window, 'alert').mockImplementation();
            
            const $password = $(passwordInput);
            const $passwordRepeat = $(passwordRepeatInput);
            const $info = $(infoDiv);
            const $repeatInfo = $(repeatInfoDiv);

            validate(event, $password, $passwordRepeat, $info, $repeatInfo);

            expect(preventDefault).not.toHaveBeenCalled();
            expect(alertSpy).not.toHaveBeenCalled();

            alertSpy.mockRestore();
        });
    });

    describe('Bootstrap integration', () => {
        test('applies Bootstrap validation classes correctly', () => {
            passwordInput.value = 'Password123';
            const $password = $(passwordInput);
            const $info = $(infoDiv);

            verifyPassword($password, $info);

            expect(passwordInput.classList.contains('is-valid')).toBe(true);
            expect(passwordInput.classList.contains('is-invalid')).toBe(false);
        });

        test('generates Bootstrap-styled feedback HTML', () => {
            passwordInput.value = 'Password123';
            const $password = $(passwordInput);
            const $info = $(infoDiv);

            verifyPassword($password, $info);

            expect(infoDiv.innerHTML).toContain('list-unstyled');
            expect(infoDiv.innerHTML).toContain('text-success');
            expect(infoDiv.innerHTML).toContain('bi bi-check-circle-fill');
        });
    });
});
