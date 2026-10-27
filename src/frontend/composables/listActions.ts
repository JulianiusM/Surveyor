import {useFrontend} from '../app/context';
import type {Ref} from 'vue';
import type {FrontendListActionItem, FrontendListActionSource, FrontendListPendingControl} from '../../types/FrontendListTypes';
import type {FrontendPlainMessageKey, FrontendRequestScope} from '../../types/FrontendUiTypes';

/** Keep only this gesture's initiating control through its existing operation.
 * Retirement and newer gestures may replace the selection; an older completion
 * must not clear them. The command retains dispatch, authority and outcome ownership. */
export async function presentAction<Selection, Result>(selection: Ref<Selection | null>, intent: Selection,
    operation: () => Promise<Result>): Promise<Result> {
    selection.value = intent;
    // Normal refs may proxy an object; compare the actual assigned ref value.
    const initiator = selection.value;
    try {
        return await operation();
    } finally {
        if (selection.value === initiator) selection.value = null;
    }
}

/**
 * Restore the shared list membership, removal and Quick Add journeys. Features
 * supply their actual API calls and live draft collector/reset; this owner keeps
 * availability, confirmation and initiating-control lifetime consistent. The
 * existing command alone owns dispatch, actor capture and uncertain delivery.
 */
export function useListActions(source: FrontendListActionSource) {
    const {messages} = useFrontend();

    /**
     * Retain only this action's initiating control through its command and any
     * confirmed draft reset. An unconfirmed result never clears a Quick Add draft;
     * even a thrown failure releases presentation without replaying the operation.
     */
    async function perform(control: FrontendListPendingControl,
        operation: (scope: FrontendRequestScope) => Promise<unknown>, success: () => FrontendPlainMessageKey,
        reviewUnknown = false, confirmed?: () => void): Promise<void> {
        /** Complete the confirmed draft reset before releasing the initiating control. */
        async function submitCommand(): Promise<void> {
            const result = await source.command.run(operation, true, reviewUnknown, {success: success()});
            // useCommand returns a confirmed result even after a failed follow-up
            // read. Rejection, uncertain delivery and actor retirement return none.
            if (result) confirmed?.();
        }
        await presentAction(source.pendingControl, control, submitCommand);
    }

    /** Submit desired self membership once; the existing server owns capacity and identity. */
    async function assign(item: FrontendListActionItem): Promise<void> {
        if (!source.command.action.isAvailable()) return;
        // Read the admitted row when dispatch runs; no local membership or count
        // is optimistically changed while its saved refresh remains outstanding.
        await perform({kind: 'assign', id: item.id},
            scope => source.assign(item.id, !item.selfAssigned, scope),
            () => item.selfAssigned ? source.messages.unassigned : source.messages.assigned);
    }

    /** Confirm an admitted item deletion before taking presentation ownership or dispatching. */
    async function removeItem(item: Pick<FrontendListActionItem, 'id'>): Promise<void> {
        // A blocked sibling cannot open confirmation or overwrite the active
        // initiator. Canceling confirmation leaves every control and draft intact.
        if (!source.command.action.isAvailable() || !window.confirm(messages.value.t(source.messages.confirmDelete))) return;
        await perform({kind: 'delete', id: item.id}, scope => source.removeItem(item.id, scope), () => source.messages.deleted);
    }

    /** Organizer assignment removal remains immediate and leaves the Quick Add draft alone. */
    async function removeAssignment(assignmentId: string): Promise<void> {
        if (!source.command.action.isAvailable()) return;
        // Scope/grants stay in the feature operation. This shared owner neither
        // selects another profile nor adds a new confirmation or retry behavior.
        await perform({kind: 'assignment', id: assignmentId},
            scope => source.removeAssignment(assignmentId, scope), () => 'common.removed');
    }

    /** Keep unknown creation review and reset only the feature's confirmed submitted draft. */
    async function addItem(): Promise<void> {
        if (!source.command.action.isAvailable()) return;
        // The feature reads its live title/description/capacity only inside the
        // existing command scope. Confirmation resets before the initiator retires.
        await perform({kind: 'add'}, source.addItem, () => 'common.added', true, source.resetItem);
    }

    return {assign, removeItem, removeAssignment, addItem};
}
