<script setup lang="ts">
import {computed} from 'vue';

// The admitted feature supplies its read-only description. This presentation
// owns newline rendering only; it retains no draft, permission or HTML content.
const props = withDefaults(defineProps<{
    description?: string | null;
    separator?: boolean;
    paragraphId?: string | null;
    paragraphClass?: string;
}>(), {paragraphId: 'planDesc', paragraphClass: 'mb-0 mt-2'});
const lines = computed(() => props.description?.split('\n') ?? []);
</script>

<template>
    <!-- Interpolation keeps authored text escaped. Explicit breaks preserve
         blank lines and native paragraph gaps. Normal text whitespace avoids
         pre-wrap's extra spaces/tabs changing the original line wrapping. -->
    <template v-if="description">
        <!-- Lists retain their native paragraph hook and spacing. Other admitted
             descriptions can supply their own paragraph without copying escaping
             or newline behavior; surrounding labels/columns stay feature-owned. -->
        <p :id="paragraphId ?? undefined" :class="paragraphClass"><template v-for="(line, index) in lines" :key="index">{{ line }}<br v-if="index < lines.length - 1" /></template></p>
        <hr v-if="separator" class="mb-1 mt-0" />
    </template>
</template>
