/** The same supported-zone and label rules serve standalone and inline time-zone controls. */
const commonZones = [
    'UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Chicago',
    'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Africa/Johannesburg',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
];
const initialized = new WeakSet<HTMLInputElement>();

interface TimezonePickerOptions {
    value?: string;
    common?: string[];
    refDateIso?: string;
    mode?: 'inline' | 'modal';
}

/**
 * Bind one submitted hidden field to either a standalone modal or an inline expandable panel.
 * Both hosts use the same discovery, filtering and choice path; presentation controls are unnamed
 * so the form and containing entity dialog have only one authoritative time-zone draft value.
 */
export function initTimezoneSelect(id: string | number, opts: TimezonePickerOptions = {}): void {
    const input = document.getElementById(String(id)) as HTMLInputElement | null;
    if (!input || initialized.has(input)) return;
    const button = document.getElementById(`${id}-btn`);
    const buttonLabel = document.getElementById(`${id}-btn-label`);
    const guess = document.getElementById(`${id}-guess`);
    const modalElement = document.getElementById(`${id}-modal`);
    const chips = document.getElementById(`${id}-chips`);
    const search = document.getElementById(`${id}-search`) as HTMLInputElement | null;
    const list = document.getElementById(`${id}-list`);
    const panel = document.getElementById(`${id}-panel`);
    const hostModal = panel?.closest<HTMLElement>('.modal');
    const close = document.getElementById(`${id}-close`);
    const summary = document.getElementById(`${id}-summary`);
    if (!button || !buttonLabel || (!modalElement && !panel) || !chips || !search || !list) return;

    const refDate = opts.refDateIso ? new Date(opts.refDateIso) : new Date();
    // Canonical discovery is supplied by the browser, with the established common list as a
    // compatibility fallback. Valid configured/common/guessed aliases supplement that inventory.
    const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : commonZones;
    // UTC and valid persisted aliases can be absent from supportedValuesOf's canonical list.
    // Keeping them avoids silently replacing an existing deadline zone when the modal initializes.
    const allZones = [...new Set(['UTC', ...supported])];
    const common = opts.common?.length ? opts.common : commonZones;
    const initial = input.value || opts.value || guessedZone();
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
    for (const zone of [initial, guessedZone(), ...common]) {
        if (isSupportedZone(zone) && !allZones.includes(zone)) allZones.push(zone);
    }

    /** Offsets reflect the caller's reference instant, including DST; unavailable labels stay blank. */
    function offsetLabel(zone: string): string {
        try {
            const parts = new Intl.DateTimeFormat(undefined, {timeZone: zone, timeZoneName: 'longOffset'}).formatToParts(refDate);
            for (const part of parts) {
                if (part.type === 'timeZoneName') return part.value.replace('GMT', 'UTC');
            }
        } catch {
            // An invalid reference date should not prevent selecting a valid time zone.
        }
        return '';
    }

    function label(zone: string): string {
        const offset = offsetLabel(zone);
        return offset ? `${zone} • ${offset}` : zone;
    }

    /** External dialog cancellation updates this same field and must refresh every visible mirror. */
    function syncSelection(): void {
        if (buttonLabel) buttonLabel.textContent = label(input!.value);
        for (const scope of [chips!, list!]) {
            for (const option of scope.querySelectorAll<HTMLButtonElement>('button[data-zone]')) {
                option.setAttribute('aria-pressed', String(option.dataset.zone === input!.value));
            }
        }
    }

    /** Only explicit, valid choices emit an edit; initialization and repeated choices remain clean. */
    function setZone(zone: string): void {
        if (input!.disabled || !allZones.includes(zone)) return;
        if (input!.value !== zone) {
            input!.value = zone;
            input!.dispatchEvent(new Event('change', {bubbles: true}));
        }
        syncSelection();
        // Preserve the standalone picker's brief successful-choice feedback in the inline host.
        // Repeated choices restart one timer instead of accumulating callbacks on the button.
        button!.classList.add('btn-outline-success');
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(clearChoiceFeedback, 300);
    }

    function clearChoiceFeedback(): void {
        button!.classList.remove('btn-outline-success');
        feedbackTimer = undefined;
    }

    function zoneButton(zone: string): HTMLButtonElement {
        const option = document.createElement('button');
        option.type = 'button';
        option.dataset.zone = zone;
        option.textContent = label(zone);
        return option;
    }

    /**
     * Limit the result DOM to 200 buttons while searching the complete supported inventory. A
     * count explains truncation and search can reach any omitted zone. Dynamic buttons carry data
     * only; one delegated native-button handler provides pointer and keyboard activation.
     */
    function renderList(): void {
        if (!list || !search) return;
        if (input!.disabled) return;
        list.replaceChildren();
        const query = search.value.trim().toLowerCase();
        let count = 0;
        let matches = 0;
        for (const zone of allZones) {
            if (query && !zone.toLowerCase().includes(query)) continue;
            matches++;
            if (count >= 200) continue;
            const item = document.createElement('li');
            item.className = 'list-group-item text-bg-dark';
            const option = zoneButton(zone);
            option.className = 'btn btn-outline-light text-start w-100';
            item.appendChild(option);
            list.appendChild(item);
            count++;
        }
        if (!count) {
            const empty = document.createElement('li');
            empty.className = 'list-group-item text-bg-dark';
            empty.textContent = 'No matches';
            list.appendChild(empty);
        }
        if (summary) summary.textContent = matches > count ? `Showing ${count} of ${matches} zones. Refine your search to see the rest.` : `${count} time zone${count === 1 ? '' : 's'}.`;
        syncSelection();
    }

    /** Selecting closes only this picker: inline mode never dismisses the parent entity dialog. */
    function handleChoice(event: Event): void {
        const option = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-zone]');
        if (!option || input!.disabled) return;
        setZone(option.dataset.zone || '');
        if (modalElement) window.bootstrap?.Modal.getInstance(modalElement)?.hide();
        if (panel) closePanel();
    }

    function handleGuess(): void { setZone(guessedZone()); }
    /** A modal delegates focus to Bootstrap; an inline panel focuses search without a second trap. */
    function handleOpen(): void {
        if (input!.disabled) return;
        if (modalElement) window.bootstrap?.Modal.getOrCreateInstance(modalElement).show();
        if (panel) {
            panel.hidden = !panel.hidden;
            button!.setAttribute('aria-expanded', String(!panel.hidden));
            if (!panel.hidden) search!.focus();
        }
    }

    /** Inline completion/cancellation resets presentation search and returns focus to its trigger. */
    function closePanel(): void {
        if (!panel || input!.disabled) return;
        panel.hidden = true;
        button!.setAttribute('aria-expanded', 'false');
        handleHidden();
        button!.focus();
    }
    function handleShown(): void { search?.focus(); }
    /** Search is temporary presentation state; the selected submitted zone survives picker close. */
    function handleHidden(): void {
        if (search) search.value = '';
        renderList();
    }
    function handleHostHidden(): void {
        // Closing the parent discards presentation search as the standalone picker always did.
        // Do not focus the trigger here: Bootstrap returns focus outside the now-hidden dialog.
        if (panel) panel.hidden = true;
        button!.setAttribute('aria-expanded', 'false');
        handleHidden();
    }
    /** Native form reset is distinct from a parent's explicit field-change cancellation signal. */
    function resetSavedZone(): void {
        // Hidden input .value also updates its defaultValue. Preserve the saved value explicitly,
        // matching the containing entity dialog's independent cancellation snapshot.
        input!.value = initial;
        syncSelection();
    }
    function handleReset(): void { queueMicrotask(resetSavedZone); }
    function preventSearchSubmit(event: KeyboardEvent): void {
        if (event.key === 'Enter') event.preventDefault();
    }

    for (const zone of common) {
        if (!allZones.includes(zone)) continue;
        const option = zoneButton(zone);
        option.className = 'btn btn-sm btn-outline-light';
        chips.appendChild(option);
    }
    chips.addEventListener('click', handleChoice);
    list.addEventListener('click', handleChoice);
    search.addEventListener('input', renderList);
    search.addEventListener('keydown', preventSearchSubmit);
    button.addEventListener('click', handleOpen);
    close?.addEventListener('click', closePanel);
    modalElement?.addEventListener('shown.bs.modal', handleShown);
    modalElement?.addEventListener('hidden.bs.modal', handleHidden);
    hostModal?.addEventListener('hidden.bs.modal', handleHostHidden);
    renderList();
    guess?.addEventListener('click', handleGuess);
    input.addEventListener('change', syncSelection);
    input.form?.addEventListener('reset', handleReset);
    initialized.add(input);
    // Initial hydration is not a user edit and must not mark the containing settings form dirty.
    if (!input.value) input.value = allZones.includes(initial) ? initial : 'UTC';
    syncSelection();
}

function isSupportedZone(zone: string): boolean {
    try {
        new Intl.DateTimeFormat(undefined, {timeZone: zone});
        return true;
    } catch {
        return false;
    }
}

function guessedZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}
