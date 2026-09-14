import {showInlineAlert} from '../shared/alerts';

/** Invoice uploads keep their form locked until the server confirms the outcome. */
export function bindInvoiceSubmission(
    form: HTMLFormElement,
    options: {eventId: string; registered: boolean},
): void {
    if (form.dataset.invoiceSubmissionInitialized) return;
    const fields = form.querySelector<HTMLFieldSetElement>('[data-invoice-fields]');
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
    const feedback = form.querySelector<HTMLElement>('[data-invoice-feedback]');
    const status = form.querySelector<HTMLElement>('[data-invoice-status]');
    const progress = form.querySelector<HTMLElement>('[data-invoice-progress]');
    const progressBar = form.querySelector<HTMLElement>('[data-invoice-progress-bar]');
    const history = form.querySelector<HTMLButtonElement>('[data-invoice-history]');
    if (!fields || !submit || !feedback || !status || !progress || !progressBar || !history) return;
    form.dataset.invoiceSubmissionInitialized = 'true';

    let locked = false;
    let navigating = false;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const pool = form.elements.namedItem('poolId') as HTMLSelectElement | null;
    const returnPoolKey = `surveyor:invoice-submission:${options.eventId}`;
    const successKey = `${returnPoolKey}:success`;
    const successMessage = 'Invoice submitted successfully. It is awaiting organizer review.';
    let submitted = false;
    const originalContent = Array.from(submit.childNodes);
    const showBusyButton = (button: HTMLButtonElement, label: string) => {
        const spinner = document.createElement('span');
        spinner.className = 'spinner-border spinner-border-sm me-2';
        spinner.setAttribute('aria-hidden', 'true');
        button.replaceChildren(spinner, document.createTextNode(label));
        button.disabled = true;
    };
    const clearInvoiceFields = () => {
        for (const name of ['amount', 'description', 'proof']) {
            const input = form.elements.namedItem(name) as HTMLInputElement | null;
            if (input) input.value = '';
        }
    };
    const unlock = () => {
        locked = false;
        fields.disabled = false;
        submit.disabled = false;
        submit.replaceChildren(...originalContent);
    };
    try {
        const savedPool = sessionStorage.getItem(returnPoolKey);
        if (savedPool) {
            sessionStorage.removeItem(returnPoolKey);
            if (pool && Array.from(pool.options).some(option => option.value === savedPool)) pool.value = savedPool;
            // Browser form restoration must not bring the completed invoice back after the history refresh.
            clearInvoiceFields();
            unlock();
        }
        if (sessionStorage.getItem(successKey)) {
            sessionStorage.removeItem(successKey);
            showInlineAlert('success', successMessage);
        }
    } catch { /* Pool selection remains usable when browser storage is unavailable. */ }
    const showStatus = (message: string, kind: 'info' | 'danger' = 'info', reveal = false) => {
        feedback.hidden = false;
        status.hidden = false;
        status.className = `alert alert-${kind} mb-2`;
        status.textContent = message;
        if (reveal) status.scrollIntoView({block: 'nearest'});
    };
    const updateProgress = (percent?: number) => {
        progressBar.style.width = `${percent ?? 100}%`;
        progressBar.textContent = percent === undefined ? '' : `${percent}%`;
        if (percent === undefined) progress.removeAttribute('aria-valuenow');
        else progress.setAttribute('aria-valuenow', String(percent));
    };
    const preventLeave = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = '';
    };
    const reloadHistory = () => {
        if (navigating) return;
        navigating = true;
        clearTimeout(reloadTimer);
        showBusyButton(history, 'Refreshing history…');
        try {
            if (pool?.value) sessionStorage.setItem(returnPoolKey, pool.value);
            if (submitted) sessionStorage.setItem(successKey, 'true');
        } catch { /* Refreshing saved history must not depend on browser storage. */ }
        window.location.hash = 'invoiceHistory';
        window.location.reload();
    };
    history.addEventListener('click', reloadHistory);

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (locked || !form.reportValidity()) return;
        if (!options.registered || !pool?.value) {
            showInlineAlert('error', !options.registered
                ? 'You must be registered for the event to submit invoices.'
                : 'Choose a pool before submitting your invoice.');
            return;
        }

        // Capture the proof and fields before disabling them: disabled fields are omitted by FormData.
        const payload = new FormData(form);
        locked = true;
        fields.disabled = true;
        showBusyButton(submit, 'Submitting…');
        // Keep the live region outside the busy fields so assistive technology announces progress immediately.
        fields.setAttribute('aria-busy', 'true');
        history.hidden = true;
        progress.hidden = false;
        updateProgress();
        showStatus('Uploading your invoice proof. Keep this page open; submit only once.', 'info', true);
        window.addEventListener('beforeunload', preventLeave);

        let finished = false;
        let uploaded = false;
        let slow = false;
        let lastProgress = -1;
        const slowTimer = setTimeout(() => {
            if (finished) return;
            slow = true;
            showStatus(uploaded
                ? 'Your proof has uploaded. Saving is taking longer than usual. Keep this page open; do not submit again.'
                : 'Your upload is taking longer than usual. Keep this page open; do not submit again.');
        }, 10000);
        const finish = (outcome: 'success' | 'rejected' | 'uncertain', message?: string) => {
            if (finished) return;
            finished = true;
            clearTimeout(slowTimer);
            window.removeEventListener('beforeunload', preventLeave);
            fields.setAttribute('aria-busy', 'false');
            progress.hidden = true;
            if (outcome === 'success') {
                submitted = true;
                clearInvoiceFields();
                submit.textContent = 'Submitted';
                showStatus('Refreshing your invoice history…');
                showInlineAlert('success', successMessage);
                history.textContent = 'View invoice history';
                history.hidden = false;
                // Keep inputs locked until navigation so a new draft cannot be lost during the refresh.
                reloadTimer = setTimeout(reloadHistory, 1000);
            } else if (outcome === 'rejected') {
                unlock();
                feedback.hidden = true;
                status.textContent = '';
                showInlineAlert('error', message || 'Your invoice was not submitted. Check the fields and try again.');
            } else {
                submit.textContent = 'Submission unconfirmed';
                showStatus('We could not confirm whether your invoice was saved. It may still have been submitted. Check invoice history before uploading it again.', 'danger', true);
                history.textContent = 'Check invoice history';
                history.hidden = false;
                status.focus();
            }
        };

        try {
            const request = new XMLHttpRequest();
            request.open('POST', `/api/event/${encodeURIComponent(options.eventId)}/invoice-pools/${encodeURIComponent(pool.value)}/submit`);
            request.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            request.timeout = 180000;
            request.upload.onprogress = (upload) => {
                if (finished || !upload.lengthComputable || !upload.total) return;
                const percent = Math.min(100, Math.round(upload.loaded / upload.total * 100));
                updateProgress(percent);
                // Announce in ten-percent steps instead of flooding the live region.
                const step = Math.floor(percent / 10) * 10;
                if (!slow && step !== lastProgress) {
                    lastProgress = step;
                    showStatus(`Uploading your invoice proof: ${step}%. Keep this page open; submit only once.`);
                }
            };
            request.upload.onload = () => {
                if (finished) return;
                uploaded = true;
                updateProgress(100);
                showStatus(slow
                    ? 'Your proof has uploaded. Saving is taking longer than usual. Keep this page open; do not submit again.'
                    : 'Upload complete. Saving your invoice; please wait for confirmation.');
            };
            request.onload = () => {
                let response: {status?: string; message?: string} | null = null;
                try {
                    response = JSON.parse(request.responseText);
                } catch {
                    // A proxy error or redirected login page is not confirmation of a saved invoice.
                }
                if (request.status >= 200 && request.status < 300 && response?.status === 'success') {
                    finish('success');
                } else if (request.status >= 400 && request.status < 500) {
                    finish('rejected', typeof response?.message === 'string' ? response.message : undefined);
                } else {
                    finish('uncertain');
                }
            };
            request.onerror = () => finish('uncertain');
            request.ontimeout = () => finish('uncertain');
            request.onabort = () => finish('uncertain');
            request.send(payload);
        } catch {
            finish('uncertain');
        }
    });
}
