<script setup lang="ts">
import {computed} from 'vue';
import {useRoute} from 'vue-router';
import {usePilot} from '../../app/context';
import {usePageTitle} from '../../composables/pageTitle';
import PageMessage from '../../components/PageMessage.vue';
import PackingPage from './PackingPage.vue';
import PackingGuestPage from '../identity/PackingGuestPage.vue';
const context = usePilot();
const route = useRoute();
// Initial admission belongs to one URL. A later SPA navigation must perform its
// normal resource query rather than carry a previous document's denial forward.
const admissionError = computed(() => context.bootstrap.initialUrl?.split('?')[0] === route.path
    && context.bootstrap.session.context === context.session.value?.context
    ? context.bootstrap.packingError : undefined);
usePageTitle(() => admissionError.value ? context.messages.value.t('common.errorTitle') : undefined);
</script>

<template>
    <!-- Reuse the ordinary error card/Home action. Admission errors disclose no
         private list values and mount no resource queries. -->
    <PageMessage v-if="admissionError" kind="error" :message="context.messages.value.t(admissionError)" />
    <PackingPage v-else-if="context.session.value?.activeProfile" />
    <PackingGuestPage v-else />
</template>
