<script setup lang="ts" generic="TKey extends RichMessageKey">
import {computed} from 'vue';
import type {VNode} from 'vue';
import {TranslationComponent as I18next} from 'i18next-vue';
import type {MessageNodes, MessageParameters, RichMessageKey} from '../../types/LocalizationTypes';
import {assertRichMessageNodes} from '../../common/localization/translator';
import {useFrontend} from '../app/context';

// Catalog declarations own placement and names; features supply authored nodes.
// Parameters remain required here, including an explicit empty object for a
// node-only message. The shared translator checks their runtime scalar types.
const props = defineProps<{message: TKey; parameters: MessageParameters[TKey]}>();
const {messages} = useFrontend();
const slots = defineSlots<{[TNode in MessageNodes[TKey]]: () => VNode[]}>();
const content = computed(() => messages.value.rich(props.message, props.parameters));

/** Validate current slots on every render, including a changed dynamic caller.
 * Binding-owned substitution never receives user values as parser input. */
function translation(): string {
    assertRichMessageNodes(props.message, Object.keys(slots));
    return content.value.text;
}
</script>

<template>
    <I18next :translation="translation()">
        <template v-for="(_slot, name) in slots" #[name]>
            <slot :name="name as MessageNodes[TKey]" />
        </template>
        <template v-for="(value, name) in content.values" #[name]>{{ value }}</template>
    </I18next>
</template>
