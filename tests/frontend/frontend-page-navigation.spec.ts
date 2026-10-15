// @vitest-environment happy-dom
import {describe, expect, it, vi} from 'vitest';
import {flushPromises} from '@vue/test-utils';
import {defineComponent} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {observePageNavigation} from '../../src/frontend/composables/pageNavigation';

const page = defineComponent({template: '<p>Admitted page</p>'});

describe('shared pending page navigation', () => {
    it('keeps a newer lazy destination pending when an older import is cancelled', async () => {
        let finishFirst!: (value: typeof page) => void;
        let finishSecond!: (value: typeof page) => void;
        const firstModule = new Promise<typeof page>(resolve => { finishFirst = resolve; });
        const secondModule = new Promise<typeof page>(resolve => { finishSecond = resolve; });
        const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/', component: page},
            {path: '/first', component: () => firstModule},
            {path: '/second', component: () => secondModule},
        ]});
        await router.push('/');
        const finished = vi.fn();
        const navigation = observePageNavigation(router, {finished});
        try {
            const first = router.push('/first');
            await flushPromises();
            const second = router.push('/second');
            await flushPromises();
            expect(navigation.destination.value?.path).toBe('/second');

            // The abandoned import settles while its replacement is still loading.
            // Its failure must not reopen reads or remove the replacement indicator.
            finishFirst(page);
            await first;
            expect(navigation.pending()).toBe(true);
            expect(navigation.destination.value?.path).toBe('/second');

            finishSecond(page);
            await second;
            expect(navigation.pending()).toBe(false);
            expect(router.currentRoute.value.path).toBe('/second');
            expect(finished).toHaveBeenCalledTimes(2);
        } finally { navigation.dispose(); router.options.history.destroy(); }
    });

    it.each([
        {target: '/?q=next', all: true, document: true, path: false},
        {target: '/#section', all: true, document: false, path: false},
        {target: '/other', all: true, document: true, path: true},
    ])('retains caller-specific URL boundaries for $target', async expected => {
        const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/', component: page}, {path: '/other', component: page},
        ]});
        await router.push('/');
        const all = observePageNavigation(router, {scope: 'all'});
        const document = observePageNavigation(router);
        const path = observePageNavigation(router, {scope: 'path'});
        let release!: () => void;
        const stopDelivery = router.beforeResolve(() => new Promise<void>(resolve => { release = resolve; }));
        try {
            const transition = router.push(expected.target);
            await flushPromises();
            expect(all.pending()).toBe(expected.all);
            expect(document.pending()).toBe(expected.document);
            expect(path.pending()).toBe(expected.path);
            release();
            await transition;
            expect(all.pending() || document.pending() || path.pending()).toBe(false);
        } finally {
            all.dispose(); document.dispose(); path.dispose(); stopDelivery();
            router.options.history.destroy();
        }
    });

    it('retires failed delivery and releases its callbacks when the owner is disposed', async () => {
        const failure = new Error('Fixture route module is unavailable.');
        const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/', component: page}, {path: '/other', component: page},
            {path: '/broken', component: () => Promise.reject(failure)},
        ]});
        await router.push('/');
        const started = vi.fn();
        const finished = vi.fn();
        const navigation = observePageNavigation(router, {started, finished});
        try {
            await expect(router.push('/broken')).rejects.toBe(failure);
            expect(navigation.pending()).toBe(false);
            expect(router.currentRoute.value.path).toBe('/');
            expect(finished).toHaveBeenCalledOnce();
            navigation.dispose();
            await router.push('/other');
            expect(started).toHaveBeenCalledOnce();
            expect(finished).toHaveBeenCalledOnce();
        } finally { navigation.dispose(); router.options.history.destroy(); }
    });
});
