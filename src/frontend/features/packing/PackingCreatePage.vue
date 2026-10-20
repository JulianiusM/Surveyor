<script setup lang="ts">
import {ref} from 'vue';
import type {components} from '../../../types/api/v1';
import type {FrontendListCreationSource} from '../../../types/FrontendListTypes';
import {usePilot} from '../../app/context';
import {packingKeys} from '../../app/queryKeys';
import {usePackingApi} from './api';
import EntityListCreation from '../../components/EntityListCreation.vue';
import ActionButton from '../../components/ActionButton.vue';
import FormField from '../../components/FormField.vue';

// Packing owns the only collection draft and its native trimming/parseInt
// collector. The shared matching list form owns root fields and admission.
const context = usePilot();
const {messages} = context;
const api = usePackingApi(context);
type Row = Omit<components['schemas']['PackingDuplicateItem'], 'maxAssignees' | 'description'>
    & {key: number; maxAssignees: string; description: string};
const nextKey = ref(0);
const rows = ref<Row[]>([]);

function newRow(value?: components['schemas']['PackingDuplicateItem']): Row {
    return {key: nextKey.value++, title: value?.title ?? '', description: value?.description ?? '',
        maxAssignees: String(value?.maxAssignees || 1), requiredByAll: value?.requiredByAll ?? false};
}

/** Collection creation keeps its native lexical number control and blank-row
 * omission; root metadata fields retain their separate native whitespace rules. */
function collectedItems(): components['schemas']['PackingNewItem'][] {
    const items: components['schemas']['PackingNewItem'][] = [];
    for (const row of rows.value) {
        const title = row.title.trim();
        if (!title) continue;
        items.push({title, description: row.description?.trim() ?? '',
            maxAssignees: Number.parseInt(row.maxAssignees || '1'), requiredByAll: row.requiredByAll});
    }
    return items;
}

const source: FrontendListCreationSource<components['schemas']['PackingDuplicate']> = {
    creationKey: packingKeys.creation, duplicateKey: packingKeys.duplicate, eventPicker: api.eventPicker,
    initialContext: context.bootstrap.packingCreateContext, initialSelectedEvent: context.bootstrap.packingSelectedEvent,
    initialDuplicate: context.bootstrap.packingDuplicate, initialError: context.bootstrap.packingError,
    createEntry: api.createEntry.bind(api), duplicate: api.duplicate.bind(api),
    initialize(copy) { rows.value = copy ? copy.items.map(newRow) : [newRow()]; },
    reset() { rows.value = []; }, draft: () => rows.value,
    destination: result => '/frontend-pilot/packing/' + result.id,
    prepare(values, image) {
        // A confirmed empty collection uses the native field error without sending
        // an invalid generated command. This check owns no backend permission.
        const items = collectedItems();
        if (!items.length) return {error: 'packing.itemsRequired'};
        return {operation: scope => api.createPacking({...values, items}, image, scope)};
    },
};
</script>

<template>
    <EntityListCreation icon="bi-bag-plus" heading="packing.create" document-title="packing.createDocumentTitle" header-label="packing.headerOptional" not-found="packing.notFound"
        created="packing.created" leave-unknown="packing.leaveUnknown" creation-unknown="packing.creationUnknown" :source="source">
        <template #default>
            <div class="mb-3">
                <label class="form-label"
                    ><i class="bi bi-list-ul me-1" aria-hidden="true"></i
                    >{{ messages.t('packing.itemsToPack') }}</label
                >
                <div class="table-responsive">
                    <table class="table table-dark table-striped table-bordered align-middle packing-creation-items">
                        <thead>
                            <tr>
                                <th class="text-center w-25">{{ messages.t('packing.item') }}</th>
                                <th class="text-center w-50">
                                    {{ messages.t('packing.description') }}
                                </th>
                                <th class="text-center w-15">
                                    {{ messages.t('packing.maxNumber') }}
                                </th>
                                <th class="text-center w-10">{{ messages.t('packing.action') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(row, index) in rows" :key="row.key">
                                <td>
                                    <FormField :id="'packing-row-' + row.key + '-title'" v-model="row.title" :name="null"
                                        :label="messages.t('packing.item') + ' ' + (index + 1)" label-class="visually-hidden" required
                                        :aria-label="messages.t('packing.item') + ' ' + (index + 1)"
                                    />
                                </td>
                                <td>
                                    <FormField :id="'packing-row-' + row.key + '-description'" v-model="row.description" :name="null"
                                        :label="messages.t('packing.description') + ' ' + (index + 1)" label-class="visually-hidden"
                                        :aria-label="messages.t('packing.description') + ' ' + (index + 1)"
                                    />
                                </td>
                                <td style="width: 110px">
                                    <FormField :id="'packing-row-' + row.key + '-capacity'" v-model="row.maxAssignees" :name="null"
                                        type="number" lexical-number :min="1" required
                                        :label="messages.t('packing.maxNumber') + ' ' + (index + 1)" label-class="visually-hidden"
                                        :control-data="{'data-hydration-draft': true}"
                                        :aria-label="messages.t('packing.maxNumber') + ' ' + (index + 1)"
                                    />
                                </td>
                                <td class="text-center">
                                    <!-- Native Everyone text is descriptive rather than a
                                         second click target. Keep switch/keyboard behavior
                                         and its accessible name without implicit label activation. -->
                                    <div
                                        class="form-check form-switch d-inline-flex align-items-center me-3"
                                        ><input
                                            v-model="row.requiredByAll"
                                            type="checkbox"
                                            :aria-label="messages.t('packing.everyone')"
                                            data-hydration-draft
                                            class="form-check-input"
                                        /><span class="ms-1 small">{{
                                            messages.t('packing.everyone')
                                        }}</span></div
                                    ><ActionButton
                                        class="btn-sm"
                                        variant="outline-danger"
                                        :aria-label="messages.t('packing.removeRow')"
                                        @click="rows.splice(index, 1)"
                                        ><i class="bi bi-x-lg" aria-hidden="true"></i
                                    ></ActionButton>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </template>
        <template #before-submit>
            <ActionButton variant="outline-info" @click="rows.push(newRow())">
                <i class="bi bi-plus-circle me-1" aria-hidden="true"></i>{{ messages.t('packing.addRow') }}
            </ActionButton>
        </template>
    </EntityListCreation>
</template>
