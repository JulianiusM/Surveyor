// @vitest-environment happy-dom
import {describe, expect, it, vi} from 'vitest';
import {flushFrontendPromises as flushPromises} from '../keywords/frontendUiKeywords';
import {computed, defineComponent, ref} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {createPageReadiness, observePageNavigation} from '../../src/frontend/composables/pageNavigation';

const page = defineComponent({template: '<p>Admitted page</p>'});

describe('shared pending page navigation', () => {
    it('waits for the mounted current render and reads its existing readiness directly', async () => {
        const router = createRouter({history: createMemoryHistory(), routes: [{path: '/', component: page}]});
        await router.push('/');
        const readiness = createPageReadiness(router);
        const readable = ref(false);
        const release = readiness.register({destination: computed(() => router.currentRoute.value.fullPath), ready: readable});
        const completed = vi.fn();
        const pending = readiness.wait(router.currentRoute.value).then(completed);
        try {
            await flushPromises();
            expect(completed).not.toHaveBeenCalled();
            readable.value = true;
            await pending;
            expect(completed).toHaveBeenCalledExactlyOnceWith(true);
            expect(await readiness.wait(router.currentRoute.value)).toBe(true);
        } finally { release(); readiness.dispose(); router.options.history.destroy(); }
    });

    it('cancels an older visit and an application retirement without inheriting its scroll intent', async () => {
        const router = createRouter({history: createMemoryHistory(), routes: [
                {path: '/', component: page}, {path: '/other', component: page},
            ]});
        await router.push('/');
        const readiness = createPageReadiness(router);
        try {
            const pending = readiness.wait(router.currentRoute.value);
            await router.push('/other');
            expect(await pending).toBe(false);
            const retired = readiness.wait(router.currentRoute.value);
            readiness.dispose();
            expect(await retired).toBe(false);
            expect(await readiness.wait(router.currentRoute.value)).toBe(false);
        } finally { readiness.dispose(); router.options.history.destroy(); }
    });

    it('releases an unready render on unmount even while its route remains current', async () => {
        const router = createRouter({history: createMemoryHistory(), routes: [{path: '/', component: page}]});
        await router.push('/');
        const readiness = createPageReadiness(router);
        const release = readiness.register({destination: computed(() => router.currentRoute.value.fullPath), ready: ref(false)});
        try {
            const pending = readiness.wait(router.currentRoute.value);
            release();
            expect(await pending).toBe(false);
        } finally { readiness.dispose(); router.options.history.destroy(); }
    });

    it('does not let a retiring page unregister its replacement render', async () => {
        const router = createRouter({history: createMemoryHistory(), routes: [{path: '/', component: page}]});
        await router.push('/');
        const readiness = createPageReadiness(router);
        const destination = computed(() => router.currentRoute.value.fullPath);
        const releaseOld = readiness.register({destination, ready: ref(false)});
        const releaseCurrent = readiness.register({destination, ready: ref(true)});
        try {
            releaseOld();
            expect(await readiness.wait(router.currentRoute.value)).toBe(true);
        } finally { releaseCurrent(); readiness.dispose(); router.options.history.destroy(); }
    });

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
