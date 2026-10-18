import {invoiceText} from '../../../modules/invoice/wording';
import {showInlineAlert} from '../shared/alerts';

/** Invoice uploads keep their form locked until the server confirms the outcome. */
export function bindInvoiceSubmission(
    form: HTMLFormElement,
    options: {eventId: string; registered: boolean},
): void {
    // Capture required DOM hooks once; the live feedback remains outside disabled invoice fields.
    if (form.dataset.invoiceSubmissionInitialized) return;
    const hooks = {
        fields: form.querySelector<HTMLFieldSetElement>('[data-invoice-fields]'),
        submit: form.querySelector<HTMLButtonElement>('[type="submit"]'),
        feedback: form.querySelector<HTMLElement>('[data-invoice-feedback]'),
        status: form.querySelector<HTMLElement>('[data-invoice-status]'),
        progress: form.querySelector<HTMLElement>('[data-invoice-progress]'),
        progressBar: form.querySelector<HTMLElement>('[data-invoice-progress-bar]'),
        history: form.querySelector<HTMLButtonElement>('[data-invoice-history]'),
    };
    if (!hooks.fields || !hooks.submit || !hooks.feedback || !hooks.status
        || !hooks.progress || !hooks.progressBar || !hooks.history) return;
    // Capture non-null bindings after checking the complete contract, including for named deferred handlers.
    const {fields, submit, feedback, status, progress, progressBar, history} = hooks;
    form.dataset.invoiceSubmissionInitialized = 'true';

    // Local state distinguishes an editable draft, a pending upload, and navigation to confirmed history.
    let locked = false;
    let navigating = false;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const pool = form.elements.namedItem("poolId") as HTMLSelectElement | null;
    const returnPoolKey = `surveyor:invoice-submission:${options.eventId}`;
    const successKey = `${returnPoolKey}:success`;
    const successMessage = invoiceText('invoiceSubmittedSuccessfullyItIsAwaitingOrganizerReview');
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
    // Restore only the pool selection after a successful upload; completed invoice fields must stay empty.
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
    /** Retain pool selection and successful feedback while navigating to authoritative saved invoice history. */
    function reloadHistory() {
        if (navigating) return;
        navigating = true;
        clearTimeout(reloadTimer);
        showBusyButton(history, invoiceText('refreshingHistory'));
        // Navigation is the recovery path for both successful and uncertain delivery, without resending the invoice.
        try {
            if (pool?.value) sessionStorage.setItem(returnPoolKey, pool.value);
            if (submitted) sessionStorage.setItem(successKey, 'true');
        } catch { /* Refreshing saved history must not depend on browser storage. */ }
        window.location.hash = "invoiceHistory";
        window.location.reload();
    }
    history.addEventListener('click', reloadHistory);

    // One submit starts one request. A second tap, Enter key, or delayed response cannot create another upload.
    /** Resolve the invoice outcome from an explicit application response rather than upload completion. */
    function completeInvoiceUpload(event: Event) {
        event.preventDefault();
        if (locked || !form.reportValidity()) return;
        if (!options.registered || !pool?.value) {
            showInlineAlert('error', !options.registered
                ? invoiceText('youMustBeRegisteredForTheEventToSubmit')
                : invoiceText('chooseAPoolBeforeSubmittingYourInvoice'));
            return;
        }

        // Capture the proof and fields before disabling them: disabled fields are omitted by FormData.
        const payload = new FormData(form);
        locked = true;
        fields.disabled = true;
        showBusyButton(submit, invoiceText('submitting'));
        // Keep the live region outside the busy fields so assistive technology announces progress immediately.
        fields.setAttribute('aria-busy', 'true');
        history.hidden = true;
        progress.hidden = false;
        updateProgress();
        showStatus(invoiceText('uploadingYourInvoiceProofKeepThisPageOpenSubmit'), 'info', true);
        window.addEventListener('beforeunload', preventLeave);

        let finished = false;
        let uploaded = false;
        let slow = false;
        let lastProgress = -1;
        const slowTimer = setTimeout(() => {
            if (finished) return;
            slow = true;
            showStatus(uploaded
                ? invoiceText('yourProofHasUploadedSavingIsTakingLongerThan')
                : invoiceText('yourUploadIsTakingLongerThanUsualKeepThis'));
        }, 10000);
        // Resolve success, definite rejection, and ambiguous delivery differently to avoid accidental duplicate costs.
        /** Resolve confirmed save, definite validation failure, and ambiguous delivery with distinct recovery behavior. */
        function finish(outcome: 'success' | 'rejected' | 'uncertain', message?: string) {
            if (finished) return;
            finished = true;
            clearTimeout(slowTimer);
            window.removeEventListener('beforeunload', preventLeave);
            fields.setAttribute('aria-busy', 'false');
            progress.hidden = true;
            // Success keeps the form locked until history refresh; explicit rejection lets the user correct the draft.
            if (outcome === 'success') {
                submitted = true;
                clearInvoiceFields();
                submit.textContent = invoiceText('submitted');
                showStatus(invoiceText('refreshingYourInvoiceHistory'));
                showInlineAlert('success', successMessage);
                history.textContent = invoiceText('viewInvoiceHistory');
                history.hidden = false;
                // Keep inputs locked until navigation so a new draft cannot be lost during the refresh.
                reloadTimer = setTimeout(reloadHistory, 1000);
            } else if (outcome === 'rejected') {
                unlock();
                feedback.hidden = true;
                status.textContent = '';
                showInlineAlert('error', message || invoiceText('yourInvoiceWasNotSubmittedCheckTheFieldsAnd'));
            } else {
                submit.textContent = invoiceText('submissionUnconfirmed');
                showStatus(invoiceText('weCouldNotConfirmWhetherYourInvoiceWasSaved'), 'danger', true);
                history.textContent = invoiceText('checkInvoiceHistory');
                history.hidden = false;
                status.focus();
            }
        }

        // Upload progress is separate from server save confirmation; finishing the file transfer is not success.
        try {
            const request = new XMLHttpRequest();
            request.open('POST', `/api/event/${encodeURIComponent(options.eventId)}/invoice-pools/${encodeURIComponent(pool.value)}/submit`);
            request.setRequestHeader("X-Requested-With", "XMLHttpRequest");
            request.timeout = 180000;
            request.upload.onprogress = /** Update file-transfer progress in bounded announcements without assuming the invoice was saved. */
            function reportInvoiceUploadProgress(upload) {
                // Ignore late or unmeasurable events; transfer progress cannot authorize a new upload.
                if (finished || !upload.lengthComputable || !upload.total) return;
                const percent = Math.min(100, Math.round(upload.loaded / upload.total * 100));
                updateProgress(percent);
                // Announce in ten-percent steps instead of flooding the live region.
                const step = Math.floor(percent / 10) * 10;
                if (!slow && step !== lastProgress) {
                    lastProgress = step;
                    showStatus(invoiceText('uploadingYourInvoiceProofKeepThisPageOpenSubmit2', {step: step}));
                }
            };
            request.upload.onload = () => {
                if (finished) return;
                uploaded = true;
                updateProgress(100);
                showStatus(slow
                    ? invoiceText('yourProofHasUploadedSavingIsTakingLongerThan')
                    : invoiceText('uploadCompleteSavingYourInvoicePleaseWaitForConfirmation'));
            };
            // Accept only a successful application response; proxy failures and transport loss leave the outcome uncertain.
            request.onload = /** Resolve the invoice outcome from an explicit application response rather than upload completion. */
            function resolveInvoiceUploadResponse() {
                let response: {status?: string; message?: string} | null = null;
                try {
                    response = JSON.parse(request.responseText);
                } catch {
                    // A proxy error or redirected login page is not confirmation of a saved invoice.
                }
                // Only a positive application acknowledgement confirms persistence; transport failures stay uncertain.
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
    }
    form.addEventListener('submit', completeInvoiceUpload);
}
