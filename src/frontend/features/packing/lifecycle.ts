import type {Ref} from 'vue';
import type {LocalizationContext} from '../../../types/LocalizationTypes';
import type {PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import type {useCommand} from '../../composables/command';
import type {PackingApi} from './api';

/** Share Packing's archive/restore action across its current settings and Overview
 * consumers. Existing command/API owners retain admission, refresh dependencies,
 * uncertainty and server authority; this owner adds no state or second command. */
export function createPackingLifecycle(api: Pick<PackingApi, 'archive'>,
                                      command: Pick<ReturnType<typeof useCommand>, 'run'>,
                                      messages: Readonly<Ref<LocalizationContext>>) {
    /** Confirm the same direct/inherited lifecycle choice in every presentation.
     * The caller supplies its current resource state and optional initiating event;
     * personal visibility and permanent deletion remain separate operations. */
    async function archive(listId: string, restore: boolean, inherited: boolean, initiator?: Event): Promise<void> {
        // Restore takes precedence over inherited archival, matching both existing
        // journeys. Read wording from the current locale at the user action boundary.
        const confirmation = restore ? 'packing.confirmRestore'
            : inherited ? 'packing.confirmArchiveIndependent' : 'packing.confirmArchive';
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

    return {archive};
}
