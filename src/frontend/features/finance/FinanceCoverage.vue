<script setup lang="ts">
import {computed, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {usePilot} from '../../app/context';
import ActionButton from '../../components/ActionButton.vue';
import FormField from '../../components/FormField.vue';
import FinanceLedgerFooter from './FinanceLedgerFooter.vue';

type Group = components['schemas']['FinancePool']['coverageGroups'][number];
// Applied and pending rosters are separately supplied saved projections. This
// reusable table emits only an explicitly enabled current-input edit shortcut;
// it never writes relationships or treats a pending payer as applied.
const props = defineProps<{groups: Group[]; known: boolean; registrationId?: string | null; editable?: boolean; disabled?: boolean;
    needsRecalculation?: boolean}>();
const emit = defineEmits<{edit: [payerId: string]}>();
const {messages, locale} = usePilot();
const id = useId();
const search = ref('');
const size = ref(10);
const page = ref(0);
const expanded = ref(new Set<string>());
const filtered = computed(filteredGroups);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / size.value)));
const visible = computed(() => filtered.value.slice(page.value * size.value, (page.value + 1) * size.value));
const coveredCount = computed(() => props.groups.reduce((count, group) => count + group.beneficiaries.length, 0));
watch(search, resetDisplay);
watch(size, () => {page.value = 0;});
watch(pages, count => {page.value = Math.min(page.value, count - 1);});

/** Keep whole payer groups searchable while preserving the shared presenter's
 * roster membership; name ordering affects only these read-only rows. */
function filteredGroups(): Group[] {
    const query = search.value.trim().toLocaleLowerCase();
    // Search beneficiaries beyond the six-name preview as well as payer names.
    return props.groups.filter(group => !query || [group.payerName, ...group.beneficiaries.map(person => person.name)]
        .some(name => name.toLocaleLowerCase().includes(query)))
        .sort((left, right) => left.payerName.localeCompare(right.payerName, locale.value));
}
/** A beneficiary-name search reveals matching names even outside the initial
 * preview; a payer-name match retains that payer's complete saved roster. */
function matchingBeneficiaries(group: Group): Group['beneficiaries'] {
    const query = search.value.trim().toLocaleLowerCase();
    // Filtering presentation cannot delete a name from the underlying DTO.
    return query && !group.payerName.toLocaleLowerCase().includes(query)
        ? group.beneficiaries.filter(person => person.name.toLocaleLowerCase().includes(query)) : group.beneficiaries;
}
function shownBeneficiaries(group: Group): Group['beneficiaries'] {
    const matching = matchingBeneficiaries(group);
    return expanded.value.has(group.payerId) ? matching : matching.slice(0, 6);
}
function resetDisplay(): void { page.value = 0; expanded.value = new Set(); }

/** Expand one payer without moving focus or changing another group's preview.
 * Reset its internal list scroll, matching the native explicit toggle. */
function toggle(groupId: string, event: MouseEvent): void {
    const next = new Set(expanded.value);
    if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
    expanded.value = next;
    // Only the clicked payer's bounded list owns this local scroll position.
    const group = (event.currentTarget as HTMLElement).closest('td');
    const list = group?.querySelector<HTMLElement>('.takeover-beneficiary-chips');
    if (list) list.scrollTop = 0;
}
</script>

<template>
    <div class="pool-takeover-summary w-100" data-finance-coverage>
        <p v-if="!known" class="text-secondary small mb-0">{{ messages.t('finance.appliedTakeoversUnavailable') }}</p>
        <p v-else-if="!groups.length" class="text-secondary small mb-0">
            {{ messages.t('finance.eachParticipantCoversTheirOwnShareUseManageTakeovers') }}
        </p>
        <template v-else>
            <p class="small text-secondary mb-2">
                {{ messages.t('finance.coverageCounts', {
                payers: messages.t('finance.coveringPayersCount', {count: groups.length}),
                participants: messages.t('finance.coveredParticipantsCount', {count: coveredCount}),
            }) }}
            </p>
            <div class="takeover-overview-controls d-flex flex-wrap gap-2 mb-2">
                <FormField
                    :id="`${id}-search`"
                    v-model="search"
                    class="mb-0 finance-filter-search"
                    label-class="visually-hidden"
                    type="search"
                    control-class="form-control-sm"
                    :label="messages.t('finance.searchTakeovers')"
                    :placeholder="messages.t('finance.findAPayerOrCoveredParticipant')"
                />
                <label class="visually-hidden" :for="`${id}-size`">{{ messages.t('finance.takeoverPayersPerPage') }}</label>
                <select :id="`${id}-size`" v-model="size" class="form-select form-select-sm text-bg-dark">
                    <option v-for="count in [10, 25, 50]" :key="count" :value="count">
                        {{ messages.t('finance.pageSizeOption', {count}) }}
                    </option>
                </select>
            </div>
            <div class="table-responsive pool-takeover-table">
                <table class="table table-dark table-striped table-bordered align-middle mb-0">
                    <caption class="visually-hidden">{{ messages.t('finance.payersAndTheParticipantsWhoseSharesTheyCover') }}</caption>
                    <thead>
                        <tr>
                            <th scope="col">{{ messages.t('finance.payer') }}</th>
                            <th scope="col">{{ messages.t('finance.coveredParticipants') }}</th>
                            <th v-if="editable" scope="col">{{ messages.t('finance.actions') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="group in visible" :key="group.payerId" :data-finance-coverage-payer="group.payerId">
                            <th scope="row" class="fw-normal" :data-label="messages.t('finance.payer')">
                                <strong>{{ group.payerName }}</strong>
                                <span v-if="group.payerId === registrationId" class="badge bg-info text-dark ms-2">
                                    {{ messages.t('finance.you') }}
                                </span>
                                <small class="text-secondary d-block mt-1">
                                    {{ messages.t('finance.participantsCovered', {count: group.beneficiaries.length}) }}
                                </small>
                            </th>
                            <td :data-label="messages.t('finance.coveredParticipants')">
                                <div
                                    :id="`${id}-payer-${group.payerId}`"
                                    class="takeover-beneficiary-chips d-flex flex-wrap align-content-start gap-1"
                                    :data-expanded="expanded.has(group.payerId)"
                                    :tabindex="expanded.has(group.payerId) ? 0 : -1"
                                    role="group"
                                    :aria-label="messages.t('finance.participantsCoveredBy', {name: group.payerName})"
                                >
                                    <span
                                        v-for="person in shownBeneficiaries(group)"
                                        :key="person.id"
                                        class="badge coverage-name-chip"
                                        :class="person.id === registrationId ? 'bg-info text-dark' : 'bg-secondary'"
                                    >
                                        {{ person.name }}
                                        {{ person.id === registrationId ? messages.t('finance.you2') : '' }}
                                    </span>
                                </div>
                                <div
                                    v-if="matchingBeneficiaries(group).length > 6 || matchingBeneficiaries(group).length !== group.beneficiaries.length"
                                    class="pilot-action-row mt-2"
                                >
                                    <small class="text-secondary" role="status">
                                        {{ messages.t(matchingBeneficiaries(group).length === group.beneficiaries.length ? 'finance.shownCoverageSummary' : 'finance.matchingCoverageSummary', {shown: shownBeneficiaries(group).length, count: matchingBeneficiaries(group).length}) }}
                                    </small>
                                    <ActionButton
                                        v-if="matchingBeneficiaries(group).length > 6"
                                        variant="outline-light"
                                        class="btn-sm"
                                        :aria-expanded="expanded.has(group.payerId)"
                                        :aria-controls="`${id}-payer-${group.payerId}`"
                                        :aria-label="expanded.has(group.payerId) ? messages.t('finance.showFewerCoveredForPayer', {payer: group.payerName}) : messages.t('finance.showAllCoveredForPayer', {count: matchingBeneficiaries(group).length, payer: group.payerName})"
                                        @click="toggle(group.payerId, $event)"
                                    >
                                        {{ expanded.has(group.payerId) ? messages.t('finance.showFewerCovered') : messages.t('finance.showAllCovered', {count: matchingBeneficiaries(group).length}) }}
                                    </ActionButton>
                                </div>
                            </td>
                            <td v-if="editable" :data-label="messages.t('finance.actions')">
                                <ActionButton variant="outline-light" class="btn-sm" :disabled="disabled"
                                              :aria-label="messages.t('finance.editTakeoversFor', {name: group.payerName})" @click="emit('edit', group.payerId)">
                                    <i class="bi bi-pencil me-1" aria-hidden="true"></i>{{ messages.t('finance.edit') }}
                                </ActionButton>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p v-if="!visible.length" class="text-secondary small py-3 mb-0">{{ messages.t('finance.noTakeoversMatchThisSearch') }}</p>
            <FinanceLedgerFooter
                :page="page"
                :size="size"
                :total="filtered.length"
                :pages="pages"
                coverage
                :refreshable="false"
                @previous="page--"
                @next="page++"
            />
        </template>
        <!-- Only the caller's editable current coverage carries this notice;
             saved applied rosters retain their previous-calculation meaning. -->
        <p v-if="needsRecalculation" class="text-warning small mt-2 mb-0">
            {{ messages.t('finance.theseSavedTakeoversApplyAfterRecalculationPreviousShareNotes') }}
        </p>
    </div>
</template>
