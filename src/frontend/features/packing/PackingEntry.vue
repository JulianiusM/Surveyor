<script setup lang="ts">
import {usePilot} from '../../app/context';
import PackingPage from './PackingPage.vue';
import PackingGuestPage from '../identity/PackingGuestPage.vue';
const context = usePilot();
</script>
<template><PackingPage v-if="context.session.value?.activeProfile" /><PackingGuestPage v-else /></template>
