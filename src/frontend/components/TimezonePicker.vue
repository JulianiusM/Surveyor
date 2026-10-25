<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref} from 'vue';
import {useFrontend} from '../app/context';
import ActionButton from './ActionButton.vue';
import AppDialog from './AppDialog.vue';
import TimezoneOptions from './TimezoneOptions.vue';

// Creation and property editing share the zone discovery and alias behavior.
// The feature retains the submitted zone and local deadline; this picker stores
// only disclosure/search state and never rewrites a deadline instant itself.
const props = withDefaults(defineProps<{modelValue: string; id: string; disabled?: boolean; reference?: string | null;
    mode?: 'inline' | 'modal'}>(), {mode: 'inline'});
const emit = defineEmits<{'update:modelValue': [value: string]}>();
const {messages} = useFrontend();
const open = ref(false);
const search = ref('');
const trigger = ref<HTMLButtonElement | null>(null);
const chosen = ref(false);
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(feedbackTimer));
const common = ['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Chicago',
    'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Africa/Johannesburg', 'Asia/Dubai',
    'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
const guessed = guessedZone();
const zones = computed(discoverZones);

/** Supplement canonical browser zones with valid saved/common aliases.
 * Keep the selected zone even when discovery omits its alias. Initialization preserves the configured value without emitting an edit. */
function discoverZones(): string[] {
    const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : common;
    const choices = new Set(['UTC', ...supported]);
    // Existing aliases may not appear in supportedValuesOf's canonical inventory.
    for (const zone of [props.modelValue, guessed, ...common]) {
        try { new Intl.DateTimeFormat(undefined, {timeZone: zone}); choices.add(zone); } catch { /* Ignore invalid aliases. */ }
    }
    return [...choices];
}

/** Offset labels use the supplied reference instant so saved DST offsets retain
 * their meaning. Invalid reference dates leave a selectable plain name. */
function label(zone: string): string {
    try {
        const date = props.reference ? new Date(props.reference) : new Date();
        const parts = new Intl.DateTimeFormat(undefined, {timeZone: zone, timeZoneName: 'longOffset'}).formatToParts(date);
        const offset = parts.find(part => part.type === 'timeZoneName')?.value.replace('GMT', 'UTC');
        return offset ? `${zone} • ${offset}` : zone;
    } catch { return zone; }
}

/** Only deliberate supported choices update the feature-owned draft. */
function choose(zone: string, closePicker = true): void {
    if (props.disabled || !zones.value.includes(zone)) return;
    emit('update:modelValue', zone);
    // Choices close the picker and briefly acknowledge the selected zone.
    // One owned timer avoids accumulated callbacks after repeated selections.
    chosen.value = true;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { chosen.value = false; }, 300);
    if (closePicker) close();
}

/** Browser detection can be unavailable while a saved valid alias stays usable. */
function guessedZone(): string {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
}

/** Opening focuses the shared search; inline closing returns to its own trigger. */
async function toggle(): Promise<void> {
    if (props.disabled) return;
    if (open.value) return close();
    // Focus follows the rendered search node, independently of the feature draft.
    open.value = true;
    await nextTick();
    document.getElementById(props.id + '-search')?.focus();
}
function close(): void {
    open.value = false;
    search.value = '';
    if (props.mode === 'inline') trigger.value?.focus();
}
</script>

<template>
    <!-- Keep the button, common-zone chips and searchable list geometry;
         inline disclosure avoids nested Bootstrap modals inside Entity settings. -->
    <div class="timezone-picker tz-picker-compact">
        <input :id="id" type="hidden" name="deadlineTz" :value="modelValue" :disabled="disabled" />
        <div class="d-flex gap-2">
            <button ref="trigger" :id="id + '-btn'" type="button" class="btn btn-outline-light flex-grow-1 text-start" :class="{'btn-outline-success': chosen}" :disabled="disabled" :aria-label="messages.t('event.timezone')"
                :aria-expanded="mode === 'inline' ? open : undefined" :aria-controls="id + (mode === 'inline' ? '-panel' : '-modal')" @click="toggle">
                <i class="bi bi-globe me-2" aria-hidden="true"></i>{{ label(modelValue) }}
            </button>
            <ActionButton variant="outline-light" :disabled="disabled" :title="messages.t('timezone.detect')"
                :aria-label="messages.t('timezone.detect')" @click="choose(guessed, false)"><i class="bi bi-geo-alt" aria-hidden="true"></i></ActionButton>
        </div>
        <div v-if="mode === 'inline'" v-show="open" :id="id + '-panel'" class="border border-secondary rounded p-2 mt-2">
            <TimezoneOptions :id="id" v-model:search="search" :zones="zones" :common="common" :selected="modelValue" :label="label" :disabled="disabled" @choose="choose" />
            <ActionButton class="btn-sm mt-2" variant="outline-secondary" :disabled="disabled" @click="close">{{ messages.t('timezone.close') }}</ActionButton>
        </div>
        <AppDialog v-else :open="open" :title="messages.t('timezone.choose')" standard :fullscreen-on-small="false"
            :initial-focus="'#' + id + '-search'" @close="close">
            <TimezoneOptions :id="id" v-model:search="search" :zones="zones" :common="common" :selected="modelValue" :label="label" :disabled="disabled" @choose="choose" />
            <template #footer><ActionButton variant="secondary" @click="close">{{ messages.t('common.cancel') }}</ActionButton></template>
        </AppDialog>
    </div>
</template>
