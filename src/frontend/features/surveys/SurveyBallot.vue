<script setup lang="ts">
import type {components} from '../../../types/api/v1';
import type {PilotActionState} from '../../../types/FrontendPilotUiTypes';
import {usePilot} from '../../app/context';
import ActionButton from '../../components/ActionButton.vue';
import SurveyCombinationHeaders from './SurveyCombinationHeaders.vue';

// This personal table renders the parent's current ballot draft. The detail
// owner merges background reads and submits all visible radio values together.
defineProps<{combinations: components['schemas']['SurveyCombination'][]; answers: Record<string, string>;
    profileName: string; disabled: boolean; action: PilotActionState}>();
const emit = defineEmits<{answer: [id: string, answer: 'yes' | 'maybe' | 'no']; submit: []}>();
const {messages} = usePilot();
const choices = ['yes', 'maybe', 'no'] as const;
const variants = {yes: 'success', maybe: 'warning', no: 'danger'};
const labels = {yes: 'survey.yes', maybe: 'survey.maybe', no: 'survey.no'} as const;
</script>

<template>
    <h2 class="text-center mb-4"><i class="bi bi-pencil-fill me-2" aria-hidden="true"></i>{{ messages.t('survey.yourResponse') }}</h2>
    <form id="survey-ballot" @submit.prevent="emit('submit')">
        <div class="table-responsive">
            <table class="table table-bordered table-striped table-dark table-hover align-middle">
                <thead><tr><th class="sticky-col"><i class="bi bi-person-lines-fill me-1" aria-hidden="true"></i>{{ messages.t('survey.you') }}</th>
                    <SurveyCombinationHeaders :combinations="combinations" />
                </tr></thead>
                <tbody><tr><td class="sticky-col">{{ profileName }}</td>
                    <td v-for="combination in combinations" :key="combination.id" class="text-center">
                        <div class="btn-group" role="group" :aria-label="messages.t('survey.yourResponse')">
                            <template v-for="choice in choices" :key="choice">
                                <input :id="choice + '-' + combination.id" class="btn-check" type="radio" :name="combination.id"
                                    :value="choice" :checked="(answers[combination.id] ?? 'no') === choice" :disabled="disabled"
                                    @change="emit('answer', combination.id, choice)" />
                                <label class="btn" :class="'btn-outline-' + variants[choice]" :for="choice + '-' + combination.id">{{ messages.t(labels[choice]) }}</label>
                            </template>
                        </div>
                    </td>
                </tr></tbody>
            </table>
        </div>
        <div class="d-grid mt-3"><ActionButton type="submit" variant="success" :state="action"><i class="bi bi-check-lg me-1" aria-hidden="true"></i>{{ messages.t('survey.submit') }}</ActionButton></div>
    </form>
</template>
