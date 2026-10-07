<script setup lang="ts">
import {computed} from 'vue';
import {RouterLink} from 'vue-router';
import {usePilot} from '../app/context';
import StatusNotice from './StatusNotice.vue';

const props = defineProps<{kind: 'info' | 'success' | 'error'; message: string}>();
const {messages} = usePilot();
const title = computed(() => messages.value.t(props.kind === 'info' ? 'common.infoTitle'
    : props.kind === 'success' ? 'common.successTitle' : 'common.errorTitle'));
</script>

<template>
    <section class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center bg-dark text-light">
            <i class="bi me-2" :class="kind === 'error' ? 'bi-exclamation-triangle-fill'
                : kind === 'success' ? 'bi-check-circle-fill' : 'bi-info-circle-fill'" aria-hidden="true"></i>{{ title }}
        </h1>
        <div class="card-body">
            <StatusNotice :kind="kind === 'error' ? 'danger' : kind">{{ message }}</StatusNotice>
            <slot />
            <div class="d-flex justify-content-center gap-3 mt-4">
                <RouterLink class="btn btn-primary" to="/frontend-pilot">
                    <i class="bi bi-house-door-fill me-1" aria-hidden="true"></i>{{ messages.t('app.home') }}
                </RouterLink>
            </div>
        </div>
    </section>
</template>
