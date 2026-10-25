<script setup lang="ts">
import type {components} from '../../../types/api/v1';
import {useFrontend} from '../../app/context';
import {answerVariants} from './presentation';
import StatusNotice from '../../components/StatusNotice.vue';
import SurveyCombinationHeaders from './SurveyCombinationHeaders.vue';

// Named results are an admitted shared projection. Missing answers retain the
// native lowercase No presentation and never become another person's draft.
defineProps<{combinations: components['schemas']['SurveyCombination'][]; responses: components['schemas']['SurveyView']['responses']}>();
const {messages} = useFrontend();
const labels = {yes: 'survey.answer.yes', maybe: 'survey.answer.maybe', no: 'survey.answer.no'} as const;
</script>

<template>
    <h2 class="text-center mt-5 mb-3"><i class="bi bi-people-fill me-2" aria-hidden="true"></i>{{ messages.t('survey.allAnswers') }}</h2>
    <div v-if="responses.length" class="table-responsive">
        <table class="table table-bordered table-striped table-dark table-hover align-middle">
            <thead><tr><th class="sticky-col"><i class="bi bi-person-lines-fill me-1" aria-hidden="true"></i>{{ messages.t('survey.user') }}</th>
                <SurveyCombinationHeaders :combinations="combinations" />
            </tr></thead>
            <tbody><tr v-for="response in responses" :key="response.profileId">
                <td class="sticky-col">{{ response.name }}</td>
                <td v-for="combination in combinations" :key="combination.id" class="text-center">
                    <input :id="'res-' + response.profileId + '-' + combination.id" class="btn-check" type="radio" checked disabled />
                    <label class="btn" :class="'btn-outline-' + answerVariants[response.answers[combination.id] ?? 'no']"
                        :for="'res-' + response.profileId + '-' + combination.id">{{ messages.t(labels[response.answers[combination.id] ?? 'no']) }}</label>
                </td>
            </tr></tbody>
        </table>
    </div>
    <StatusNotice v-else kind="info" :role="null" class="text-center"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>{{ messages.t('survey.noAnswers') }}</StatusNotice>
</template>
