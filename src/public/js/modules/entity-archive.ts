import {assertSuccessfulResponse, post} from '../core/http';
import {showInlineAlert} from '../shared/alerts';
import {getEntityCommandHost, hideSpinner, reloadAfterDelay, showSpinner} from '../shared/ui-helpers';

// Action names match archiveAction's data-archive-action attribute in module_entity_archive.pug.
// Use explicit desired states instead of toggles: the server remains authoritative if another session
// changes archival or visibility before this request arrives. The button supplies the endpoint, keeping
// authoritative archival and profile-only visibility on their separate server authorization paths.
const actions: Record<string, {body: Record<string, boolean | string>; message: string}> = {
    archive: {body: {}, message: 'Archived for everyone.'},
    restore: {body: {}, message: 'Restored for everyone.'},
    pause: {body: {paused: true}, message: 'Automatic archival paused.'},
    resume: {body: {paused: false}, message: 'Automatic archival resumed.'},
    hidden: {body: {visibility: 'hidden'}, message: 'Hidden from your main overview.'},
    shown: {body: {visibility: 'shown'}, message: 'Shown in your main overview.'},
    default: {body: {visibility: 'default'}, message: 'Default overview visibility restored.'},
};

// One page owns the archival binding. Overview navigation reads this state so it cannot replace the
// controls whose disabled states and confirmation are being coordinated by an in-flight mutation.
let pending = false;

export function isEntityArchivePending(): boolean {
    return pending;
}

/**
 * Bind the server-rendered archival controls within root and return a listener cleanup function.
 * Cards and notices expose the same data-archive-* contract; this module does not infer permissions,
 * inherited event state, or private placement. A confirmed command reloads their common server projection.
 */
export function initEntityArchive(root: Document | HTMLElement = document): () => void {
    async function handleAction(event: Event): Promise<void> {
        // Delegate from a stable page root: paged overviews replace cards after initialization. closest
        // also handles icons/spinners without rebinding controls or creating another mutation lock.
        const target = event.target as Element | null;
        const button = target?.closest<HTMLButtonElement>('button[data-archive-action]');
        if (!button || !root.contains(button) || pending || button.disabled) return;
        const action = actions[button.dataset.archiveAction || ''];
        const url = button.dataset.archiveUrl;
        if (!action || !url) return;
        const confirmation = button.dataset.archiveConfirm;
        // Only actions whose mixin supplies explanatory confirmation text open a dialog. Cancelling
        // leaves every control untouched and makes no request (including for event-wide archival).
        if (confirmation && !window.confirm(confirmation)) return;

        // The optional modal host checks other dirty sections and places errors inside the dialog.
        // Its lock supplements, rather than replaces, this existing page-wide archival lock.
        const host = getEntityCommandHost(button);
        const command = host?.begin(button);
        if (host && !command) return;

        // One request at a time also locks duplicate cards in participation and administration.
        // Remember preexisting disabled states so a failed request does not accidentally enable a
        // control disabled by another page concern. Only the selected control shows busy feedback.
        pending = true;
        const disabled = new Map<HTMLButtonElement, boolean>();
        const buttons = root.querySelectorAll<HTMLButtonElement>('[data-archive-action]');
        for (const control of buttons) {
            disabled.set(control, control.disabled);
            control.disabled = true;
        }
        button.setAttribute('aria-busy', 'true');
        showSpinner(button);
        try {
            const response = await post(url, action.body);
            assertSuccessfulResponse(response);
            if (command) command.success(action.message);
            else showInlineAlert('success', action.message);
            // Keep controls locked until navigation. A local DOM patch could miss another occurrence,
            // an inherited child state, changed capabilities, or a card that belongs in the other region.
            if (!command) reloadAfterDelay(500);
        } catch (error) {
            // Failed/unconfirmed requests retain the current page and restore its original controls.
            // Report the response error, but do not guess a new archival state or retry a mutation.
            if (!command) showInlineAlert('error', error instanceof Error ? error.message : 'Could not save the archival setting.');
            hideSpinner(button);
            button.removeAttribute('aria-busy');
            for (const [control, wasDisabled] of disabled) {
                control.disabled = wasDisabled;
            }
            pending = false;
            // Restore the host last: its snapshot predates the local archival button lock.
            command?.error(error);
        }
    }

    root.addEventListener('click', handleAction);

    return function dispose(): void {
        // Lifecycle cleanup removes this binding only. It does not cancel or reverse a server command
        // already sent; the entry point reloads cached pages to obtain the resulting persisted state.
        root.removeEventListener('click', handleAction);
        pending = false;
    };
}
