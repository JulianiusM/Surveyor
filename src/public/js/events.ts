/* ========== Assign / Unassign ================================ */

import {
    formatISOInTimeZone,
    initEntityLists,
    loadPerms,
    post,
    setCurrentNavLocation,
    showInlineAlert
} from "./modules/module_functions";

export function allergyCheck() {
    const allergyBox = document.getElementById('diet-allergies');
    const notes = document.getElementById('allergyNotes');
    if (allergyBox && notes) {
        function sync() {
            // @ts-ignore
            notes.required = allergyBox.checked;
        }

        allergyBox.addEventListener('change', sync);
        sync();
    }
}

export function deadlineUpdater() {
    function fmt(ms: number) {
        if (ms <= 0) return "closed";
        const s = Math.floor(ms / 1000);
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${d}d ${h}h ${m}m`;
    }

    try {
        const deadlineCnt = document.getElementById('deadlineCountdown');
        const deadline = document.getElementById('deadlineText');
        const deadlineTZ = document.getElementById('deadlineTZ');
        if (!deadline || !deadlineCnt || !deadlineTZ || !deadline.dataset?.date || !deadlineTZ.dataset?.tz) {
            return;
        }

        const date = new Date(deadline.dataset.date);
        deadline.textContent = date.toLocaleString(undefined, {
            dateStyle: "full",
            timeStyle: "full"
        });
        deadlineTZ.textContent = date.toLocaleString(undefined, {
            timeZone: deadlineTZ.dataset?.tz,
            dateStyle: "full",
            timeStyle: "full"
        });

        const t = Date.parse(date.toISOString());
        if (!isNaN(t)) {
            function tick() {
                const ms = t - Date.now();
                // @ts-ignore
                deadlineCnt.textContent = `(${fmt(ms)})`;
            }

            tick();
            setInterval(tick, 60000);
        }

        const deadlineEdit = document.getElementById('deadlineEdit');
        if (deadlineEdit) {
            const elem = deadlineEdit as HTMLInputElement;
            elem.value = formatISOInTimeZone(date, deadlineTZ.dataset.tz).slice(0, 16);
        }
    } catch (e) {
    }
}

export function initRegistration() {
    const form = document.getElementById('registrationForm');
    if (!form) return;

    form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
            const formData = new FormData(form as HTMLFormElement);
            // Turn single-value fields into an object…
            // @ts-ignore
            const payload: any = Object.fromEntries(formData);

            // …then explicitly collect multi-value fields:
            payload.dietary = formData.getAll('dietary'); // <-- ARRAY of selected values
            // @ts-ignore
            await post(`/event/${window.EVENT_ID}/register`, payload);
            showInlineAlert('success', 'Registration successful.');
            setTimeout(() => location.reload(), 120);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    });
}

export function initUpdate() {
    const form = document.getElementById('eventUpdateForm');
    if (!form) return;

    form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
            const formData = new FormData(form as HTMLFormElement);
            const checkbox = form.querySelector("#requireDietEdit") as HTMLInputElement;
            if (checkbox) {
                formData.set(checkbox.name, checkbox.checked ? 'on' : 'off');
            }
            // @ts-ignore
            await post(`/event/${EVENT_ID}/update`, Object.fromEntries(formData));
            showInlineAlert('success', 'Updated');
            setTimeout(() => location.reload(), 120);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            showInlineAlert('error', err.message);
        }
    });
}

export function initCancelRegistration() {
    const btn = document.getElementById('cancelRegistrationBtn');
    if (!btn) return;

    btn.addEventListener('click', async e => {
        if (window.confirm("Are you sure you want to cancel your registration?")) {
            try {
                // @ts-ignore
                await post(`/event/${EVENT_ID}/register/delete`);
                showInlineAlert('success', 'Registration cancelled!');
                setTimeout(() => location.reload(), 120);
            } catch (err) {
                // @ts-expect-error TS(2571): Object is of type 'unknown'.
                showInlineAlert('error', err.message);
            }
        }
    })
}

export function initDateRange() {
    const start = document.getElementById('startSpan');
    const end = document.getElementById('endSpan');
    if (!start || !end) return;

    const startDate = new Date(Date.parse(start.dataset.start!));
    const endDate = new Date(Date.parse(end.dataset.end!));

    start.textContent = startDate.toLocaleString(undefined, {
        dateStyle: "full",
    });
    end.textContent = endDate.toLocaleString(undefined, {
        dateStyle: "full",
    })
}

export function initRegistrationDateRange() {
    const start = document.getElementById('arrival');
    const end = document.getElementById('departure');
    if (!start || !end) return;

    const startDate = new Date(Date.parse(start.dataset.start!));
    const endDate = new Date(Date.parse(end.dataset.end!));

    start.textContent = startDate.toLocaleString(undefined, {
        dateStyle: "full",
    });
    end.textContent = endDate.toLocaleString(undefined, {
        dateStyle: "full",
    })
}

export function init() {
    setCurrentNavLocation();
    loadPerms();
    allergyCheck();
    deadlineUpdater();
    initDateRange();
    initRegistrationDateRange();
    initEntityLists();

    // @ts-expect-error TS(2339): Property 'PACK_LIST_ID' does not exist on type 'Wi... Remove this comment to see the full error message
    if (window.EVENT_ID) {
        initRegistration();
        initCancelRegistration();
        initUpdate();
    }
}

// Expose to global scope
window.Surveyor.init = init;