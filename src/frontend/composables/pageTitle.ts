import {toValue, watchEffect, type MaybeRefOrGetter} from 'vue';
import {usePilot} from '../app/context';

/** One title owner serves both the SSR document and subsequent SPA/locale transitions. */
export function usePageTitle(title: MaybeRefOrGetter<string>): void {
    const context = usePilot();
    watchEffect(() => {
        context.pageTitle.value = `${toValue(title)} | ${context.messages.value.t('app.title')}`;
        if (context.browser) document.title = context.pageTitle.value;
    });
}
