import {nextTick} from 'vue';
import type {App} from 'vue';

const textInputTypes = new Set(['text', 'search', 'email', 'password', 'tel', 'url']);
const draftAttribute = 'data-hydration-draft';
type DraftField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type TextSelection = {start: number; end: number; direction: 'forward' | 'backward' | 'none'};
type DraftState =
    | {kind: 'value'; value: string; selection: TextSelection | null}
    | {kind: 'checked'; checked: boolean; value: string}
    | {kind: 'files'; files: FileList}
    | {kind: 'selection'; multiple: boolean; options: {option: HTMLOptionElement; value: string; selected: boolean}[]};
type CapturedDraft = {field: DraftField; inputType: string | null; marker: string | null;
    id: string; name: string; state: DraftState};

/** Disabled/read-only controls cannot author a draft, including a disabled ancestor fieldset. */
function editable(field: DraftField): boolean {
    return !field.matches(':disabled') && !('readOnly' in field && field.readOnly);
}

/** Capture one local edit without invoking an event handler or retaining it outside this mount. */
function captureDraft(field: DraftField): CapturedDraft | undefined {
    if (!editable(field)) return;
    const marker = field.getAttribute(draftAttribute);
    const inputType = field instanceof HTMLInputElement ? field.type : null;
    let state: DraftState;

    // Text/autofill retains the established policy. Other control kinds require an explicit
    // declaration by their draft owner; locale/profile selectors and command controls never opt in.
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement
        && (textInputTypes.has(field.type) || marker !== null && field.type === 'number')) {
        if (field.value === field.defaultValue) return;
        const selection: TextSelection | null = field === document.activeElement && field.selectionStart !== null
            ? {start: field.selectionStart, end: field.selectionEnd ?? field.selectionStart,
                direction: field.selectionDirection ?? 'none'} : null;
        state = {kind: 'value', value: field.value, selection};
    } else if (marker !== null && field instanceof HTMLInputElement && field.type === 'checkbox') {
        if (field.checked === field.defaultChecked) return;
        state = {kind: 'checked', checked: field.checked, value: field.value};
    } else if (marker !== null && field instanceof HTMLInputElement && field.type === 'file') {
        if (!field.files?.length) return;
        state = {kind: 'files', files: field.files};
    } else if (marker !== null && field instanceof HTMLSelectElement) {
        // A single select with no authored selected attribute defaults to its first option.
        // Keep option identities too: a refreshed option set has different admission and must
        // never inherit an earlier selection merely because its index/value happens to match.
        const options = Array.from(field.options);
        const hasDefault = options.some(option => option.defaultSelected);
        const selected = options.map(captureOption);
        const changed = options.some((option, index) => option.selected !==
            (option.defaultSelected || !hasDefault && !field.multiple && index === 0));
        if (!changed) return;
        state = {kind: 'selection', multiple: field.multiple, options: selected};
    } else return;

    return {field, inputType, marker, id: field.id, name: field.name, state};
}

function captureOption(option: HTMLOptionElement): {option: HTMLOptionElement; value: string; selected: boolean} {
    return {option, value: option.value, selected: option.selected};
}

/** Read initial draft eligibility through the same owner used by hydration.
 * Startup guards retain no values, secrets or files: each decision examines the
 * currently editable original controls, including opted-in non-text selections. */
export function hasHydrationDrafts(container: Element): boolean {
    // Do not maintain another dirty-field definition for release recovery. The
    // temporary capture is discarded immediately and never enters browser storage.
    for (const field of container.querySelectorAll<DraftField>('input, textarea, select')) {
        if (captureDraft(field)) return true;
    }
    return false;
}

/** Restore only the original, still-admitted control and synchronize its existing draft model. */
function restoreDraft(draft: CapturedDraft, container: Element): void {
    const {field, state} = draft;
    if (!field.isConnected || !container.contains(field) || !editable(field)
        || field.id !== draft.id || field.name !== draft.name
        || field.getAttribute(draftAttribute) !== draft.marker
        || field instanceof HTMLInputElement && field.type !== draft.inputType) return;

    // Native input/change events synchronize opted-in local models; submit/click and arbitrary
    // command callbacks are never replayed. A selected upload stays a FileList on its original
    // input, never a serialized bootstrap value or a transfer by name/ID to another view.
    let eventType = 'change';
    switch (state.kind) {
        case 'value':
            field.value = state.value;
            eventType = 'input';
            break;
        case 'checked':
            // A reused checkbox node can represent a different choice without changing
            // its type or marker. Do not apply the earlier checked state to that choice.
            if (field.value !== state.value) return;
            (field as HTMLInputElement).checked = state.checked;
            break;
        case 'files':
            if ((field as HTMLInputElement).files !== state.files) {
                (field as HTMLInputElement).files = state.files;
            }
            break;
        case 'selection': {
            const select = field as HTMLSelectElement;
            const current = select.options;
            if (select.multiple !== state.multiple || current.length !== state.options.length) return;
            for (let index = 0; index < current.length; index++) {
                const captured = state.options[index]!;
                if (current[index] !== captured.option || current[index]!.value !== captured.value
                    || captured.selected && current[index]!.matches(':disabled')) return;
            }
            for (const {option, selected} of state.options) option.selected = selected;
            break;
        }
    }
    field.dispatchEvent(new Event(eventType, {bubbles: true}));

    // Preserve the user's original focus/caret without stealing focus if the admitted tree
    // deliberately moved it. Number/checkbox/select/file controls have no text selection.
    if (state.kind === 'value' && state.selection && field === document.activeElement) {
        try {
            (field as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(
                state.selection.start, state.selection.end, state.selection.direction,
            );
        } catch { /* Some browser/input combinations cannot restore a text selection. */ }
    }
}

/** Hydrate while preserving edits made before modules arrived. Non-text draft controls opt in
 * with data-hydration-draft; no identity selector, hidden admission value or action is replayed.
 * The caller waits until restoration completes before enabling normal application reads. */
export async function mountPreservingDrafts(app: App, container: Element): Promise<void> {
    // Snapshot values privately before Vue writes its initial models. Captured secrets/files
    // remain local to this call and are released after the same original nodes are reconciled.
    const drafts: CapturedDraft[] = [];
    for (const field of container.querySelectorAll<DraftField>('input, textarea, select')) {
        const draft = captureDraft(field);
        if (draft) drafts.push(draft);
    }

    app.mount(container);
    // Mounted owners can synchronously retire admission and queue a DOM update. Settle
    // that first render before any captured value reaches a newly forbidden control.
    await nextTick();
    for (const draft of drafts) {
        restoreDraft(draft, container);
        // Permission masks and other composite drafts propagate through child props. Settle
        // each update before replaying the next edit so it cannot overwrite an earlier bit.
        await nextTick();
    }
    drafts.length = 0;
}
