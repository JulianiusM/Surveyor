// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mount} from '@vue/test-utils';
import {flushFrontendPromises as flushPromises} from '../keywords/frontendUiKeywords';
import {defineComponent, provide, ref, shallowRef} from 'vue';
import I18NextVue from 'i18next-vue';
import {createFrontendContext, frontendContextKey} from '../../src/frontend/app/context';
import {noticeTargetKey} from '../../src/frontend/composables/feedback';
import StatusNotice from '../../src/frontend/components/StatusNotice.vue';
import {createFrontendEventSession} from '../factories/frontendEventFactory';

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

/** Only visible notice inputs are supplied. The real shared notice, Teleport,
 * lifecycle and per-application presentation owner remain production code. */
async function mounted(initialError: Error | null, ready = true) {
    // Happy DOM has no layout. Supply visible geometry while the production
    // helper still checks hidden/disclosed ancestors independently.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const context = createFrontendContext({session: createFrontendEventSession()}, true);
    context.hydrated.value = true;
    const readError = shallowRef(initialError);
    const commonError = shallowRef(initialError);
    const common = ref(true);
    const hostReady = ref(ready);
    const source = defineComponent({components: {StatusNotice}, setup() {
        const target = ref<HTMLElement | null>(null);
        provide(noticeTargetKey, target);
        return {readError, commonError, common, hostReady, target};
    }, template: '<section><div v-if="hostReady" ref="target" data-frontend-notices></div>'
        + '<StatusNotice class="local-read" :read-error="readError" :last-updated-at="1700000000000" :retry-at="1900000000000">Ordinary read</StatusNotice>'
        + '<StatusNotice v-if="common" class="common-read" placement="notification" :read-error="commonError">Confirmed action; read failed</StatusNotice></section>'});
    const wrapper = mount(source, {attachTo: document.body, global: {
        plugins: [[I18NextVue, {i18next: context.i18next}]], provide: {[frontendContextKey as symbol]: context},
    }});
    cleanups.push(() => { wrapper.unmount(); context.queryClient.clear(); });
    await flushPromises();
    return {wrapper, context, readError, commonError, common, hostReady};
}

describe('Common read-failure presentation ownership', () => {
    it('presents the same failed GET once with its actual query freshness and deadline', async () => {
        const {wrapper} = await mounted(new Error('Private transport text'));
        expect(wrapper.find('.local-read').exists()).toBe(false);
        const common = wrapper.get('[data-frontend-notices] .common-read');
        expect(common.get('[data-last-successful-refresh] time').attributes('datetime')).toBe(new Date(1700000000000).toISOString());
        expect(common.get('[data-read-retry-at] time').attributes('datetime')).toBe(new Date(1900000000000).toISOString());
        expect(wrapper.findAll('.status-notice')).toHaveLength(1);
        expect(wrapper.text()).not.toContain('Private transport text');
    });

    it('keeps a later independent failure visible and restores ordinary recovery after common unmount', async () => {
        const {wrapper, readError, common} = await mounted(new Error('First failed GET'));
        readError.value = new Error('First failed GET');
        await flushPromises();
        // Equal text or error category cannot join independently failed reads.
        expect(wrapper.find('.local-read').exists()).toBe(true);
        expect(wrapper.find('.common-read').exists()).toBe(true);
        common.value = false;
        await flushPromises();
        expect(wrapper.find('.common-read').exists()).toBe(false);
        expect(wrapper.get('.local-read').text()).toContain('Ordinary read');
    });

    it('never treats missing errors as the same causal failure', async () => {
        const {wrapper} = await mounted(null);
        expect(wrapper.find('.local-read').exists()).toBe(true);
        expect(wrapper.find('.common-read').exists()).toBe(true);
    });

    it('restores the ordinary warning when its matching common host is hidden and deduplicates again on disclosure', async () => {
        const {wrapper} = await mounted(new Error('Failed GET'));
        const host = wrapper.get<HTMLElement>('[data-frontend-notices]');
        expect(wrapper.find('.local-read').exists()).toBe(false);
        host.element.hidden = true;
        await flushPromises();
        expect(wrapper.find('.local-read').exists()).toBe(true);
        host.element.hidden = false;
        await flushPromises();
        expect(wrapper.find('.local-read').exists()).toBe(false);
        host.element.style.display = 'none';
        // Happy DOM does not compute layout rectangles from display. Its hidden
        // ancestry remains a real DOM mutation observed by the production owner.
        host.element.setAttribute('aria-hidden', 'true');
        await flushPromises();
        expect(wrapper.find('.local-read').exists()).toBe(true);
    });

    it('keeps one visible presentation while the common host becomes available', async () => {
        const {wrapper, hostReady, common} = await mounted(new Error('Failed GET'), false);
        expect(wrapper.find('.local-read').exists()).toBe(false);
        const notice = wrapper.get('.common-read').element;
        hostReady.value = true;
        await flushPromises();
        expect(wrapper.get('[data-frontend-notices] .common-read').element).toBe(notice);
        expect(wrapper.findAll('.status-notice')).toHaveLength(1);
        common.value = false;
        await flushPromises();
        expect(wrapper.find('.local-read').exists()).toBe(true);
    });

    it('does not deduplicate another application that received the same Error object', async () => {
        const failure = new Error('Shared external failure identity');
        const first = await mounted(failure);
        const second = await mounted(failure);
        second.common.value = false;
        await flushPromises();
        expect(first.wrapper.find('.local-read').exists()).toBe(false);
        expect(second.wrapper.find('.local-read').exists()).toBe(true);
    });
});
