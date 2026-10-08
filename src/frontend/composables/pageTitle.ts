import {toValue, watchEffect, type MaybeRefOrGetter} from 'vue';
import {usePilot} from '../app/context';

/** One title owner serves both the SSR document and subsequent SPA/locale transitions. */
export function usePageTitle(title: MaybeRefOrGetter<string | undefined>): void {
    const context = usePilot();
    watchEffect(() => {
        // A route wrapper may own only an admission error. Undefined leaves the
        // mounted feature in charge of its ordinary page title.
        const value = toValue(title);
        if (value === undefined) return;

        // Do not read the shared output inside this effect: two mounted consumers
        // would otherwise subscribe to each other's writes and repeatedly rerun.
        const pageTitle = `${value} | ${context.messages.value.t('app.title')}`;
        context.pageTitle.value = pageTitle;
        if (context.browser) document.title = pageTitle;
    });
}
