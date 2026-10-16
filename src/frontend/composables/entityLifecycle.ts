import type {Ref} from 'vue';
import type {LocalizationContext} from '../../types/LocalizationTypes';
import type {PilotPlainMessageKey, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import type {useCommand} from './command';
import type {EntityAutomationMessages, EntityLifecycleOperations} from '../../types/FrontendEntitySettingsTypes';

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
     * The caller supplies its current resource state and optional initiating event;
     * personal visibility and permanent deletion remain separate operations. */
    async function archive(listId: string, restore: boolean, inherited: boolean, initiator?: Event,
                           confirmationKey?: PilotPlainMessageKey): Promise<void> {
        // Restore takes precedence over inherited archival, matching both existing
        // journeys. Read wording from the current locale at the user action boundary.
        const confirmation = confirmationKey ?? (restore ? 'packing.confirmRestore'
            : inherited ? 'packing.confirmArchiveIndependent' : 'packing.confirmArchive');
        if (!window.confirm(messages.value.t(confirmation))) return;

        // Use this consumer's existing command lifetime and refresh callback. The
        // synchronous initiator capture keeps Settings feedback in its native section;
        // Overview deliberately retains the existing global inline fallback.
        await command.run(changeArchive, true, false, {initiator, presentation: 'inline',
            success: restore ? 'overview.restored' : 'overview.archived'});

        function changeArchive(scope: PilotRequestScope) {
            return api.archive(listId, restore, scope);
        }
    }

    /** Pause immediately, or confirm before resuming an elapsed schedule. Feature
     * callers retain capability checks and the command's refresh dependencies;
     * the existing server operation remains the schedule's sole policy owner. */
    async function automate(id: string, paused: boolean, initiator?: Event,
                            labels: EntityAutomationMessages = automationMessages): Promise<void> {
        const operation = api.automate;
        if (!operation) return;
        const changeAutomation = operation.bind(api);

        // Resuming may make an already expired resource eligible for archival.
        // Pausing has no corresponding confirmation in either current consumer.
        if (!paused && !window.confirm(messages.value.t(labels.confirmResume))) return;

        // Use the caller's existing command/feedback lifetime. A lost response
        // stays uncertain and recovery reads authority without replaying this write.
        await command.run(changeSchedule, true, false, {
            initiator,
            presentation: 'inline',
            success: paused ? labels.pausedSuccess : labels.resumedSuccess,
        });

        function changeSchedule(scope: PilotRequestScope) {
            return changeAutomation(id, paused, scope);
        }
    }

    return {archive, automate};
}
