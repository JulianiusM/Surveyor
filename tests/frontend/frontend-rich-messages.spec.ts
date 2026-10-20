// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {createSSRApp, h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import RichMessage from '../../src/frontend/components/RichMessage.vue';
import RichMessageHint from '../fixtures/RichMessageHint.vue';

const session: components['schemas']['SessionView'] = {kind: 'anonymous', context: null, csrfToken: null, locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility}, activeProfile: null, profiles: [],
    loginUrl: '/users/login', logoutUrl: null, shell: {version: 'test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy',
        localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'}};
const releases: Array<() => void> = [];
afterEach(() => { for (const release of releases.splice(0)) release(); });

/** Use the real catalog, request-local context and selected Vue binding. */
function mounted() {
    const context = createPilotContext({session}, false);
    const wrapper = mount(RichMessage, {props: {message: 'activity.progressComplete', parameters: {assigned: 0, required: 2}},
        slots: {done: () => [h('strong', 'Complete')]}, global: {plugins: [[I18NextVue, {i18next: context.i18next}]],
            provide: {[pilotContextKey as symbol]: context}}});
    releases.push(() => { wrapper.unmount(); context.queryClient.clear(); });
    return {wrapper, context};
}

describe('declared authored-node translations', () => {
    it('preserves zero scalar text, authored emphasis and live language changes', async () => {
        const {wrapper, context} = mounted();
        expect(wrapper.get('strong').element.parentElement!.textContent).toBe('Complete 0 of 2 required slots covered.');
        expect(wrapper.findAll('strong')).toHaveLength(1);
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.get('strong').element.parentElement!.textContent).toBe('Complete 0 von 2 erforderlichen Einsätzen abgedeckt.');
        expect(wrapper.get('strong').text()).toBe('Complete');
        expect(wrapper.findAll('img, script')).toHaveLength(0);
    });

    it('keeps slot content literal even when user text resembles placeholders or HTML', () => {
        const text = '{done}<img src=x onerror=alert(1)>';
        const context = createPilotContext({session}, false);
        const wrapper = mount(RichMessage, {props: {message: 'activity.recommendations.scheduleHint', parameters: {}},
            slots: {add: () => [h('span', {class: 'badge'}, text)]}, global: {plugins: [[I18NextVue, {i18next: context.i18next}]],
                provide: {[pilotContextKey as symbol]: context}}});
        releases.push(() => { wrapper.unmount(); context.queryClient.clear(); });
        expect(wrapper.get('.badge').text()).toBe(text);
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('{add}');
    });

    it('lets each catalog place the same authored node without shared SSR locale state', async () => {
        const outputs = await Promise.all(['en', 'de'].map(async locale => {
            const context = createPilotContext({session: {...session, locale}}, false);
            const app = createSSRApp(RichMessageHint);
            app.use(I18NextVue, {i18next: context.i18next});
            app.provide(pilotContextKey, context);
            try { return await renderToString(app); } finally { context.queryClient.clear(); }
        }));
        // Vue's fragment comments carry hydration boundaries, not visible text.
        const visible = outputs.map(html => html.replaceAll('<!--[-->', '').replaceAll('<!--]-->', ''));
        expect(visible[0]).toContain('using the <b>+</b> buttons.');
        expect(visible[1]).toContain('mit den <b>+</b>-Schaltflächen');
    });
});
