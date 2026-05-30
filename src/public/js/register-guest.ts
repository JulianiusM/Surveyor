/**
 * Guest registration page behavior
 * Shows confirmation when a submit nag message is configured.
 */

import {setCurrentNavLocation} from './core/navigation';
import {loadPerms} from './core/permissions';

function registerConfirmation(): void {
    const form = document.getElementById('guestForm') as HTMLFormElement | null;
    if (!form) return;

    const message = form.dataset.confirmMessage;
    if (!message) return;

    form.addEventListener('submit', (event) => {
        if (!window.confirm(message)) {
            event.preventDefault();
        }
    });
}

export function init(): void {
    registerConfirmation();
    setCurrentNavLocation();
    loadPerms();
}

if (!window.Surveyor) window.Surveyor = {};
window.Surveyor.init = init;
