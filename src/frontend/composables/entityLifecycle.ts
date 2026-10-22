import {onBeforeUnmount} from 'vue';
import type {Ref} from 'vue';
import {useRouter} from 'vue-router';
import type {LocalizationContext} from '../../types/LocalizationTypes';
import type {PilotConfirmedNavigation, PilotPlainMessageKey, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import type {useCommand} from './command';
import type {EntityAutomationMessages, EntityLifecycleOperations, EntityRemovalRequest} from '../../types/FrontendEntitySettingsTypes';
import {usePilot} from '../app/context';

// These existing Event/Activity messages describe one shared schedule action.
// A feature may supply its established override without duplicating its policy.
const automationMessages: EntityAutomationMessages = {
    confirmResume: 'event.organizer.confirmResumeAutomation',
    pausedSuccess: 'event.organizer.automationPaused',
    resumedSuccess: 'event.organizer.automationResumed',
};

/** Share entity archive/restore action across Settings, Overview and Event children.
 * Existing command/API owners retain admission, refresh dependencies,
 * uncertainty and server authority; this owner adds no state or second command. */
export function createEntityLifecycle(api: EntityLifecycleOperations,
                                      command: Pick<ReturnType<typeof useCommand>, 'run'>,
                                      messages: Readonly<Ref<LocalizationContext>>) {
    /** Confirm the same direct/inherited lifecycle choice in every presentation.
     * The caller supplies its current resource state;
     * personal visibility and permanent deletion remain separate operations. */
    async function archive(listId: string, restore: boolean, inherited: boolean,
                           confirmationKey?: PilotPlainMessageKey, hasAutomaticSchedule = false): Promise<void> {
        // Restore takes precedence over inherited archival, matching both existing
        // journeys. Read wording from the current locale at the user action boundary.
        // Independent schedules pause on restoration in the existing backend.
        // Every matching host supplies its admitted schedule presence here;
        // explicit feature wording (including Event's attached-entity warning) takes priority.
        const confirmation = confirmationKey ?? (restore
            ? hasAutomaticSchedule ? 'event.organizer.confirmRestoreScheduled' : 'packing.confirmRestore'
            : inherited ? 'packing.confirmArchiveIndependent' : 'packing.confirmArchive');
        if (!window.confirm(messages.value.t(confirmation))) return;

        // Keep this consumer's existing command lifetime and refresh callback.
        await command.run(changeArchive, true, false, {
            success: restore ? 'overview.restored' : 'overview.archived'});

        function changeArchive(scope: PilotRequestScope) {
            return api.archive(listId, restore, scope);
        }
    }

    /** Pause immediately, or confirm before resuming an elapsed schedule. Feature
     * callers retain capability checks and the command's refresh dependencies;
     * the existing server operation remains the schedule's sole policy owner. */
    async function automate(id: string, paused: boolean,
                            labels: EntityAutomationMessages = automationMessages): Promise<void> {
        const operation = api.automate;
        if (!operation) return;
        const changeAutomation = operation.bind(api);

        // Resuming may make an already expired resource eligible for archival.
        // Pausing has no corresponding confirmation in any current consumer.
        if (!paused && !window.confirm(messages.value.t(labels.confirmResume))) return;

        // Use the caller's existing command/feedback lifetime. A lost response
        // stays uncertain and recovery reads authority without replaying this write.
        await command.run(changeSchedule, true, false, {
            success: paused ? labels.pausedSuccess : labels.resumedSuccess,
        });

        function changeSchedule(scope: PilotRequestScope) {
            return changeAutomation(id, paused, scope);
        }
    }

    return {archive, automate};
}

/** Share permanent deletion across Settings, Overview and Event children. Consent
 * precedes the irreversible write and survives failed destination delivery; fields
 * remain with their mounted owners and Retry can only navigate after confirmation. */
export function useEntityRemoval(command: Pick<ReturnType<typeof useCommand>, 'run' | 'prepareDeparture' | 'pending' | 'outcome' | 'action'>,
                                 destination: PilotConfirmedNavigation) {
    const context = usePilot();
    const {messages} = context;
    const router = useRouter();
    let releaseDeparture: (() => void) | undefined;
    onBeforeUnmount(releaseUnconfirmedDeparture);

    /** Capture one feature intent only after every mounted draft permits leaving.
     * A canceled confirmation releases consent without changing any draft. */
    async function remove(request: EntityRemovalRequest): Promise<void> {
        if (!command.action.isAvailable() || destination.target.value) return;
        const approval = command.prepareDeparture();
        if (!approval) return;
        if (!window.confirm(messages.value.t(request.confirmation))) {
            approval();
            return;
        }

        releaseDeparture = approval;
        const scope = context.capture();
        const origin = router.currentRoute.value.fullPath;
        try {
            const confirmed = await command.run(deleteResource, false, false,
                {success: request.success});
            if (confirmed) await destination.navigate('/frontend-pilot', scope, origin,
                {kind: 'success', messageKey: request.success});
        } finally {
            // A failed route load retains the shared confirmed destination and
            // its consent. Neither Retry nor unmount may resubmit the DELETE.
            if (!destination.target.value) releaseApprovedDeparture();
        }

        async function deleteResource(commandScope: PilotRequestScope): Promise<boolean> {
            await request.operation(commandScope);
            return true;
        }
    }

    function releaseApprovedDeparture(): void {
        releaseDeparture?.();
        releaseDeparture = undefined;
    }

    /** A denial can retire the view before DELETE settles. Its admitted command
     * keeps root consent until the existing settlement/destination owner finishes. */
    function releaseUnconfirmedDeparture(): void {
        if (!command.pending.value && command.outcome.value?.confirmation !== 'confirmed') releaseApprovedDeparture();
    }

    return {remove};
}
