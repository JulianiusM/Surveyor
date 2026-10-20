<script setup lang="ts">
import {computed, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {useActionState, usePilot} from '../../app/context';
import {eventKeys} from '../../app/queryKeys';
import {useCommand} from '../../composables/command';
import {useEventApi} from './api';
import {useEventSection} from './useEventSection';
import {useEventClipboard} from './clipboard';
import {formatEventTimestamp} from './presentation';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import FormField from '../../components/FormField.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import AppAccordionButton from '../../components/AppAccordionButton.vue';

type Link = components['schemas']['EventRegistrationLink'];
const props = withDefaults(defineProps<{eventId: string; active?: boolean}>(), {active: true});
const context = usePilot();
const {messages} = context;
const api = useEventApi(context);
const id = useId();
const expanded = ref(false);
const creating = ref(false);
const expiry = ref('');
const uses = ref('1');

// Initial reads admit the count before disclosure. Recurring reads follow the
// expanded/visible lifetime without clearing an in-progress creation draft.
const key = computed(() => eventKeys.links(context.session.value?.context, props.eventId));
const section = useEventSection(key, readLinks, computed(() => props.active !== false), computed(() => expanded.value));
const command = useCommand(section.refresh, true, {dirty: () => creating.value && (!!expiry.value || String(uses.value) !== '1'), unknownMessage: 'draft.leaveUnknown'});
const clipboard = useEventClipboard();
const available = useActionState({eligible: mayUseLinks, blocked: () => command.action.disabled.value});
const refreshAction = useActionState({eligible: () => section.readAction.isAvailable(),
    blocked: () => command.recoveryAction.disabled.value, pending: () => section.query.isFetching.value});
watch([() => props.eventId, context.epoch, () => context.session.value?.context], retireLocalState);
watch(section.denied, denied => { if (denied) retireLocalState(); });

function readLinks(scope: Parameters<typeof api.links>[1], signal: AbortSignal) { return api.links(props.eventId, scope, signal); }
function mayUseLinks(): boolean { return props.active !== false && !!section.data.value && !section.denied.value; }
/** Release only this actor/resource's modal, inputs and clipboard invokers. */
function retireLocalState(): void {
    creating.value = false;
    expiry.value = '';
    uses.value = '1';
    clipboard.reset();
}

function openCreate(): void { if (available.isAvailable()) creating.value = true; }
function closeCreate(): void { if (!command.pending.value && !command.recovering.value && command.mayLeave()) retireLocalState(); }

/** Build the opt-in Event URL from the actual server token. Reading or copying
 * it never consumes eligibility, and it remains separate from the explicit write. */
function registrationUrl(token: string): string {
    return `${location.origin}/frontend-pilot/event/${encodeURIComponent(props.eventId)}?regToken=${encodeURIComponent(token)}`;
}

/** Explicit Copy uses the listed token without consuming or changing the link. */
async function copyLink(link: Link): Promise<void> {
    if (available.isAvailable() && link.status === 'active') await clipboard.copy(link.id, registrationUrl(link.token));
}

/** Create one native single-use registration link through the shared operation.
 * Unknown creation needs deliberate review; no read or clipboard failure replays it. */
async function createLink(event: Event): Promise<void> {
    if (!available.isAvailable()) return;
    const form = event.target as HTMLFormElement;
    if (!form.reportValidity()) return;
    // The local datetime control represents a browser-local instant, as native does.
    const input = {maxUses: Math.max(1, Number(uses.value || 1)),
        ...(expiry.value ? {expiresAt: new Date(expiry.value).toISOString()} : {})};
    const created = await command.run(scope => api.createLink(props.eventId, input, scope), true, true,
        {success: 'event.organizer.linkCreated'});
    if (!created) return;
    creating.value = false;
    expiry.value = '';
    uses.value = '1';
}

/** Revoke the exact current row after confirmation. Consumption/expiry state and
 * authority are server-owned; the read only supplies presentation eligibility. */
async function revoke(link: Link): Promise<void> {
    if (!available.isAvailable() || link.status === 'revoked') return;
    if (!window.confirm(messages.value.t('event.organizer.revokeConfirm'))) return;
    // A desired-state revoke may reconcile through a fresh authorized list read.
    await command.run(scope => api.revokeLink(props.eventId, link.id, scope), true, false,
        {success: 'event.organizer.linkRevoked'});
}

/** Recovery reads the current links first. A creation can have succeeded without
 * a response, so only an explicit acknowledgement releases its uncertain status. */
async function refresh(): Promise<void> {
    if (!refreshAction.isAvailable()) return;
    const read = await command.reconcileSafely(section.refresh);
    if (read && command.uncertain.value && window.confirm(messages.value.t('draft.leaveUnknown'))) {
        // Accepted departure reveals the fresh list instead of leaving the
        // previous creation draft ready to submit again behind its modal.
        command.acknowledge();
        retireLocalState();
    }
}
function statusClass(status: Link['status']): string {
    return status === 'active' ? 'text-bg-success' : status === 'consumed' ? 'text-bg-warning'
        : status === 'revoked' ? 'text-bg-danger' : 'text-bg-secondary';
}
</script>

<template>
    <!-- Organizer admission belongs to the page/controller. This feature owns its
         private link list, local expiry draft and explicit create/revoke commands. -->

    <section class="reg-links text-bg-dark border border-secondary rounded-2 py-1 my-2" data-entity-section>
        <!-- Page and open-dialog hosts present one shared command receipt. -->
        <div v-if="!creating">
            <CommandFeedback :feedback="command.feedback"
                :part="command.uncertain.value ? 'error' : 'all'" />
            <CommandFeedback :feedback="command.feedback" part="uncertain"
                :action="{state: refreshAction, label: messages.t('common.refresh')}" @action="refresh" />
        </div>

        <div class="accordion accordion-flush">
            <div class="accordion-item bg-dark border-secondary">
                <h2 class="accordion-header">
                    <AppAccordionButton class="text-light bg-dark"
                        :expanded="expanded" :controls="`${id}-links`" @click="expanded = !expanded">
                        <i class="bi bi-link-45deg me-2" aria-hidden="true"></i>{{ messages.t('event.organizer.links') }}<span class="badge bg-secondary ms-2">{{ section.data.value ? section.data.value.items.length : messages.t('common.unknown') }}</span>
                    </AppAccordionButton>
                </h2>
                <div v-show="expanded" :id="`${id}-links`" class="accordion-collapse">
                    <div class="accordion-body bg-dark">
                        <LoadingSkeleton v-if="section.loading.value" variant="table" :columns="5" :rows="3" />
                        <StatusNotice v-if="section.query.error.value" kind="warning"
                            :action="{state: refreshAction, label: messages.t('common.retry')}"
                            :retry-at="section.retryAt.value" @action="refresh">{{ section.failure.value ?? messages.t('state.stale') }}</StatusNotice>

                        <!-- Link management remains independent from participant
                             access. The controller supplies every private token. -->
                        <div class="d-flex justify-content-between align-items-center gap-2 mb-3">
                            <small class="text-secondary">{{ messages.t('event.organizer.linksHelp') }}</small>
                            <div class="d-flex gap-2">
                                <ActionButton class="btn-sm" variant="outline-light" :state="available"
                                    @click="openCreate"><i class="bi bi-plus-circle me-1" aria-hidden="true"></i>{{ messages.t('event.organizer.createLink') }}</ActionButton>
                            </div>
                        </div>

                        <div v-if="section.data.value" class="table-responsive">
                            <table class="table table-dark table-striped table-bordered align-middle mb-0">
                                <thead>
                                    <tr>
                                        <th>{{ messages.t('event.organizer.token') }}</th>
                                        <th>{{ messages.t('event.organizer.created') }}</th>
                                        <th>{{ messages.t('event.organizer.expires') }}</th>
                                        <th>{{ messages.t('event.organizer.status') }}</th>
                                        <th class="text-end">{{ messages.t('event.organizer.actions') }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="link in section.data.value.items" :key="link.id"
                                        :data-link-id="link.id">
                                        <td>
                                            <code class="text-wrap">{{ link.token }}</code>
                                        </td>
                                        <td>{{ formatEventTimestamp(link.createdAt, messages.locale) }}</td>
                                        <td>{{ formatEventTimestamp(link.expiresAt, messages.locale) }}</td>
                                        <td>
                                            <span class="badge text-uppercase" :class="statusClass(link.status)">{{ messages.t(`event.organizer.${link.status}`) }}</span>
                                        </td>
                                        <td class="text-end">
                                            <div class="btn-group btn-group-sm">
                                                <ActionButton variant="outline-light" :state="available"
                                                    :disabled="link.status !== 'active' || clipboard.pending.has(link.id)"
                                                    @click="copyLink(link)"><i class="bi bi-clipboard me-1" aria-hidden="true"></i>{{ messages.t('event.organizer.copy') }}</ActionButton>
                                                <ActionButton variant="outline-danger" :state="available"
                                                    :disabled="link.status === 'revoked'"
                                                    @click="revoke(link)"><i class="bi bi-x-circle me-1" aria-hidden="true"></i>{{ messages.t('event.organizer.revoke') }}</ActionButton>
                                            </div>
                                        </td>
                                    </tr>
                                    <tr v-if="!section.data.value.items.length">
                                        <td colspan="5">
                                            <div class="text-secondary small">{{ messages.t('event.organizer.noLinks') }}</div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Uses and expiry are creation input, retained after rejected or unknown
             delivery. A list refresh never resubmits this non-idempotent operation. -->
        <AppDialog :open="creating" :title="messages.t('event.organizer.createLinkTitle')" compact title-class="fs-5"
            content-class="text-light border border-secondary"
            :pending="command.pending.value || command.recovering.value" :fullscreen-on-small="false"
            @close="closeCreate">
            <div>
                <CommandFeedback :feedback="command.feedback"
                    :part="command.uncertain.value ? 'error' : 'all'" />
                <CommandFeedback :feedback="command.feedback" part="uncertain"
                    :action="{state: refreshAction, label: messages.t('common.refresh')}" @action="refresh" />
            </div>
            <form :id="`${id}-create-form`" @submit.prevent="createLink">
                <div class="row g-3">
                    <!-- Shared labels wrap the existing native directives; Uses
                         retains number coercion and expiry retains its local draft. -->
                    <FormField :id="`${id}-uses`" class="col-md-6" :label="messages.t('event.organizer.uses')"
                        label-icon="bi-hash" label-class="" :required-marker="false">
                        <template #control>
                            <input :id="`${id}-uses`" v-model="uses" class="form-control text-bg-dark" type="number"
                                min="1" step="1" placeholder="1" :disabled="command.action.disabled.value" />
                        </template>
                        <small class="text-secondary d-block">{{ messages.t('event.organizer.singleUse') }}</small>
                    </FormField>
                    <FormField :id="`${id}-expires`" class="col-md-6" :label="messages.t('event.organizer.expiresLocal')"
                        label-icon="bi-calendar2-event" label-class="" :required-marker="false">
                        <template #control>
                            <input :id="`${id}-expires`" v-model="expiry" class="form-control text-bg-dark"
                                type="datetime-local" :disabled="command.action.disabled.value" />
                        </template>
                        <small class="text-secondary d-block">{{ messages.t('event.organizer.expiresHelp') }}</small>
                    </FormField>
                </div>
            </form>
            <template #footer>
                <ActionButton variant="outline-secondary"
                    :disabled="command.pending.value || command.recovering.value" @click="closeCreate">{{ messages.t('common.cancel') }}</ActionButton>
                <ActionButton type="submit" :form="`${id}-create-form`" :state="command.action">{{ messages.t('event.organizer.create') }}</ActionButton>
            </template>
        </AppDialog>
    </section>
</template>
