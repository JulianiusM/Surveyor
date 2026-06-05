/**
 * Guest registration page behavior
 * Shows confirmation when a submit nag message is configured.
 */

import {post} from './core/http';
import {setCurrentNavLocation} from './core/navigation';
import {loadPerms} from './core/permissions';

function getGuestForm(): HTMLFormElement | null {
    return document.getElementById('guestForm') as HTMLFormElement | null;
}

function getRecoveryForm(): HTMLFormElement | null {
    return document.getElementById('guestRecoveryForm') as HTMLFormElement | null;
}

function getEmailInput(): HTMLInputElement | null {
    const form = getGuestForm();
    return form?.querySelector<HTMLInputElement>('#email') ?? null;
}

function showChoiceModal(): void {
    const modalElement = document.getElementById('guestChoiceModal');
    if (!modalElement) return;

    window.bootstrap?.Modal.getOrCreateInstance(modalElement).show();
}

function hideChoiceModal(): void {
    const modalElement = document.getElementById('guestChoiceModal');
    if (!modalElement) return;

    window.bootstrap?.Modal.getOrCreateInstance(modalElement).hide();
}

function submitGuestFormSkippingLookup(bypassLookupState: { value: boolean }): void {
    const form = getGuestForm();
    if (!form) return;

    const message = form.dataset.confirmMessage;
    if (message && !window.confirm(message)) return;

    bypassLookupState.value = true;
    const requestSubmit = form.requestSubmit?.bind(form);
    if (requestSubmit) {
        requestSubmit();
    } else {
        form.submit();
    }
    queueMicrotask(() => {
        bypassLookupState.value = false;
    });
}

async function lookupGuestEmail(email: string): Promise<boolean> {
    const response = await post('/api/users/guest/email', {email});
    return response.message === 'present';
}

function registerGuestSubmitFlow(): void {
    const form = getGuestForm();
    const recoveryForm = getRecoveryForm();
    const emailInput = getEmailInput();
    const continueButton = document.getElementById('guestChoiceContinue');
    const recoverButton = document.getElementById('guestChoiceRecover');
    if (!form || !recoveryForm || !emailInput || !continueButton || !recoverButton) return;

    const bypassLookupState = {value: false};

    form.addEventListener('submit', async (event) => {
        if (bypassLookupState.value) {
            bypassLookupState.value = false;
            return;
        }

        event.preventDefault();

        const email = emailInput.value.trim();
        if (email) {
            try {
                const alreadyRegistered = await lookupGuestEmail(email);
                if (alreadyRegistered) {
                    showChoiceModal();
                    return;
                }
            } catch {
                // If the lookup fails, continue with the normal flow.
            }
        }

        const message = form.dataset.confirmMessage;
        if (message && !window.confirm(message)) return;

        submitGuestFormSkippingLookup(bypassLookupState);
    });

    continueButton.addEventListener('click', () => {
        hideChoiceModal();
        submitGuestFormSkippingLookup(bypassLookupState);
    });

    recoverButton.addEventListener('click', () => {
        hideChoiceModal();
        const recoveryEmailInput = recoveryForm.querySelector<HTMLInputElement>('input[name="email"]');
        if (recoveryEmailInput) {
            recoveryEmailInput.value = emailInput.value.trim();
        }
        const requestSubmit = recoveryForm.requestSubmit?.bind(recoveryForm);
        if (requestSubmit) {
            requestSubmit();
        } else {
            recoveryForm.submit();
        }
    });
}

export function init(): void {
    registerGuestSubmitFlow();
    setCurrentNavLocation();
    loadPerms();
}

if (!window.Surveyor) window.Surveyor = {};
window.Surveyor.init = init;
