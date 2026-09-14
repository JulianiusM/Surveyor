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
    const progress = form.querySelector<HTMLProgressElement>('[data-invoice-progress]');
    const history = form.querySelector<HTMLButtonElement>('[data-invoice-history]');
    if (!fields || !submit || !feedback || !status || !progress || !history) return;
    form.dataset.invoiceSubmissionInitialized = 'true';

    let locked = false;
    const originalLabel = submit.textContent;
    const showStatus = (message: string, kind: 'info' | 'success' | 'danger' = 'info') => {
        feedback.hidden = false;
        status.className = `status-notice alert-${kind} mb-2`;
        status.textContent = message;
    };
    const preventLeave = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = '';
    };
    history.addEventListener('click', () => {
        window.location.hash = 'invoiceHistory';
        window.location.reload();
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (locked || !form.reportValidity()) return;
        const pool = form.elements.namedItem('poolId') as HTMLSelectElement | null;
        if (!options.registered || !pool?.value) {
            showStatus(!options.registered
                ? 'You must be registered for the event to submit invoices.'
                : 'Choose a pool before submitting your invoice.', 'danger');
            return;
        }

        // Capture the proof and fields before disabling them: disabled fields are omitted by FormData.
        const payload = new FormData(form);
        locked = true;
        fields.disabled = true;
        submit.disabled = true;
        submit.textContent = 'Submitting…';
        // Keep the live region outside the busy fields so assistive technology announces progress immediately.
        fields.setAttribute('aria-busy', 'true');
        history.hidden = true;
        progress.hidden = false;
        progress.removeAttribute('value');
        showStatus('Uploading your invoice proof. Keep this page open; submit only once.');
        window.addEventListener('beforeunload', preventLeave);

        let finished = false;
        let uploaded = false;
        let slow = false;
        let lastProgress = -1;
        const slowTimer = setTimeout(() => {
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
                submit.textContent = 'Submitted';
                showStatus('Invoice submitted successfully. It is awaiting organizer review.', 'success');
                history.textContent = 'View invoice history';
                history.hidden = false;
            } else if (outcome === 'rejected') {
                locked = false;
                fields.disabled = false;
                submit.disabled = false;
                submit.textContent = originalLabel;
                showStatus(message || 'Your invoice was not submitted. Check the fields and try again.', 'danger');
                status.focus();
            } else {
                submit.textContent = 'Check submission status';
                showStatus('We could not confirm whether your invoice was saved. It may still have been submitted. Check invoice history before uploading it again.', 'danger');
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
                progress.value = percent;
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
                progress.value = 100;
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
