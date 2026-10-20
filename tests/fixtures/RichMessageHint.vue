<script setup lang="ts">
import RichMessage from '../../src/frontend/components/RichMessage.vue';
</script>

<template>
    <RichMessage message="activity.recommendations.scheduleHint" :parameters="{}">
        <template #add><b>+</b></template>
    </RichMessage>
</template>
