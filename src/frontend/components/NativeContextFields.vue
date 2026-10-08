<script setup lang="ts">
import {usePilot} from '../app/context';
defineProps<{next?: string}>();
const {session, locale} = usePilot();
</script>
<template>
    <!-- Native POST and hydrated fetch commands share admission values. These controls
         carry no authority independently; the server rechecks the stored session and origin. -->
    <input type="hidden" name="_context" :value="session?.context" />
    <input type="hidden" name="_csrf" :value="session?.csrfToken" />
    <input type="hidden" name="_compatibility" :value="session?.deployment.apiCompatibility" />
    <input type="hidden" name="locale" :value="locale" />
    <input v-if="next" type="hidden" name="next" :value="next" />
</template>
