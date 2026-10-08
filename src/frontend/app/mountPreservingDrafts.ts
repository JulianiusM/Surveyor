import type {App} from 'vue';

const textInputTypes = new Set(['text', 'search', 'email', 'password', 'tel', 'url']);

/** Hydrate the native page without losing text entered or autofilled while modules loaded.
 * Vue hydrates input values from its initial model, including search/password controls and
 * our FormField wrapper. Restore only original editable nodes and synchronize their models;
 * never replay a submission, selection command, file choice or hidden admission value. */
export function mountPreservingDrafts(app: App, container: Element): void {
    // Compare with the rendered default to distinguish user/browser edits from server state.
    // Keep these values only in this synchronous call; passwords never enter bootstrap or storage.
    const drafts = Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
        .filter(field => !field.matches(':disabled') && !field.readOnly && field.value !== field.defaultValue
            && (field.tagName === 'TEXTAREA' || textInputTypes.has(field.type)))
        .map(field => ({field, value: field.value,
            selection: field === document.activeElement && field.selectionStart !== null
                ? {start: field.selectionStart, end: field.selectionEnd ?? field.selectionStart,
                    direction: field.selectionDirection ?? 'none' as const} : null}));

    app.mount(container);

    for (const {field, value, selection} of drafts) {
        // A replaced or newly forbidden control belongs to a different view/admission. Do not
        // transfer a draft by name or ID, which could leak it into that new component tree.
        if (!field.isConnected || !container.contains(field) || field.matches(':disabled') || field.readOnly) continue;
        field.value = value;
        field.dispatchEvent(new Event('input', {bubbles: true}));
        if (selection && field === document.activeElement) {
            try { field.setSelectionRange(selection.start, selection.end, selection.direction); }
            catch { /* Some browser/input combinations cannot restore a text selection. */ }
        }
    }
    drafts.length = 0;
}
