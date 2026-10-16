import {expect, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent} from 'vue';
import type {Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import {createFrontendEventSession, frontendEventId} from '../factories/frontendEventFactory';

/** Return a normal admitted wire response; tests replace no decoder or production owner. */
export function frontendEventJson(value: unknown): Response {
    return new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': createFrontendEventSession().context}});
}

/** Mount the actual Event consumer with request-local identity, routing and query owners.
 * Only HTTP is supplied by the test; disposal retires all observers and held reads. */
export async function mountFrontendEvent(component: Component, handler: (request: Request) => Promise<Response>,
    props: Record<string, unknown>, path = `/frontend-pilot/event/${frontendEventId}`) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session: createFrontendEventSession()}, true, request);
    context.hydrated.value = true;
    context.visible.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/event/:eventId', component: defineComponent({template: '<p>Event host</p>'})},
        {path: '/frontend-pilot/packing/:listId', component: defineComponent({template: '<p>Packing destination</p>'})},
    ]});
    await router.push(path);
    const wrapper = mount(component, {props, attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();

    async function dispose(): Promise<void> {
        wrapper.unmount();
        await context.queryClient.cancelQueries();
        context.queryClient.clear();
    }
    return {wrapper, request, context, router, dispose};
}

/** Read visible action names through the component's actual public controls. */
export function frontendEventButton(root: Pick<ReturnType<typeof mount>, 'findAll'>, label: string) {
    const found = root.findAll('button').find(item => item.text().trim() === label);
    expect(found, label).toBeDefined();
    return found!;
}
