// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mount} from '@vue/test-utils';
import {flushFrontendPromises as flushPromises} from '../keywords/frontendUiKeywords';
import {defineComponent} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import PackingSettings from '../../src/frontend/features/packing/PackingSettings.vue';
import {createFrontendContext, frontendContextKey} from '../../src/frontend/app/context';
import {packingKeys} from '../../src/frontend/app/queryKeys';
import type {components} from '../../src/types/api/v1';

const listId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', deployment: {buildId: 'fixture', apiCompatibility},
    context: 'component-context-1234567890', csrfToken: 'component-csrf-1234567890', locale: 'en',
    activeProfile: {id: profileId, name: 'Owner'}, profiles: [{id: profileId, name: 'Owner'}],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'test', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Single sign-on'},
};

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

/** The HTTP fixture changes the shared grant while the production query observer owns the form. */
async function mountSettings() {
    let settings: components['schemas']['ListSettings'] = {
        id: listId, title: 'Shared equipment', settingsToken: '"edit-settingsOriginal"', headerUrl: null,
        headerVersion: null, editableFields: [], currentEvent: null,
        archive: {direct: false, inherited: false, archivedAt: null, autoArchivePaused: false, eventUrl: null},
        capabilities: {editHeader: false, linkEvent: false, managePermissions: true, duplicate: false,
            remove: false, archive: false, restore: false, manageArchive: false},
        access: {defaults: {public: 0, guest: 0, authenticated: 0, participant: 0},
            permissions: [{key: 'ACCESS_VIEW', bit: 1}], presets: [],
            admins: [{profileId: adminId, name: 'Alex', isGuest: false, mask: 0, editToken: '"edit-adminOriginal"'}]},
    };
    const writes: Request[] = [];
    const request = vi.fn(async (input: RequestInfo | URL) => {
        const captured = input as Request;
        if (captured.method === 'POST') {
            writes.push(captured.clone());
            const body = await captured.json() as {profileId: string; mask: number};
            settings = {...settings, access: {...settings.access!, admins: [{profileId: body.profileId,
                name: 'Alex', isGuest: false, mask: body.mask, editToken: '"edit-adminRegranted"'}]}};
        }
        return new Response(JSON.stringify(captured.method === 'POST' ? {changed: true} : settings), {
            headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context},
        });
    });
    const context = createFrontendContext({session}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/packing/:listId', component: PackingSettings, props: {listId}},
    ]});
    await router.push(`/packing/${listId}`);
    await router.isReady();
    const wrapper = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[frontendContextKey as symbol]: context},
        stubs: {AppDialog: defineComponent({template: '<section><slot name="navigation" /><slot /></section>'})},
    }});
    await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === 'Administrators')!.trigger('click');
    await wrapper.get('.accordion-button').trigger('click');
    async function removeRemoteAdmin() {
        settings = {...settings, settingsToken: '"edit-settingsAfterRemoval"', access: {...settings.access!, admins: []}};
        await context.queryClient.refetchQueries({queryKey: packingKeys.settings(session.context, listId)});
        await flushPromises();
    }
    async function dispose() {
        wrapper.unmount();
        await context.queryClient.cancelQueries();
        context.queryClient.clear();
    }
    return {wrapper, writes, removeRemoteAdmin, dispose};
}

describe('administrator permission drafts', () => {
    it('keeps a removed administrator draft and requires review plus an explicit save before regranting', async () => {
        const mounted = await mountSettings();
        try {
            await mounted.wrapper.get(`#admin-${adminId}-ACCESS_VIEW`).setValue(true);
            await mounted.removeRemoteAdmin();
            expect(mounted.wrapper.get('.accordion-button').text()).toContain('Alex');
            expect(mounted.wrapper.get<HTMLInputElement>(`#admin-${adminId}-ACCESS_VIEW`).element.checked).toBe(true);
            expect(mounted.wrapper.text()).toContain('This administrator was removed while you were editing.');
            const save = mounted.wrapper.findAll('button').find(button => button.text() === 'Save')!;
            expect(save.attributes('disabled')).toBeDefined();
            expect(mounted.writes).toHaveLength(0);
            await mounted.wrapper.findAll('button').find(button => button.text() === 'Review before adding again')!.trigger('click');
            expect(save.attributes('disabled')).toBeUndefined();
            expect(mounted.writes).toHaveLength(0);
            await save.trigger('click');
            await flushPromises();
            expect(mounted.writes).toHaveLength(1);
            expect(mounted.writes[0]!.headers.get('If-Match')).toBe('"edit-settingsAfterRemoval"');
            expect(await mounted.writes[0]!.json()).toEqual({profileId: adminId, mask: 1});
            expect(mounted.wrapper.text()).not.toContain('This administrator was removed while you were editing.');
        } finally { await mounted.dispose(); }
    });

    it('allows discarding the retained draft without restoring the removed grant', async () => {
        const mounted = await mountSettings();
        try {
            await mounted.wrapper.get(`#admin-${adminId}-ACCESS_VIEW`).setValue(true);
            await mounted.removeRemoteAdmin();
            await mounted.wrapper.findAll('button').find(button => button.text() === 'Discard changes')!.trigger('click');
            expect(mounted.wrapper.findAll('.accordion-button')).toHaveLength(0);
            expect(mounted.writes).toHaveLength(0);
        } finally { await mounted.dispose(); }
    });

    it('removes a remotely deleted administrator row when it has no local changes', async () => {
        const mounted = await mountSettings();
        try {
            await mounted.removeRemoteAdmin();
            expect(mounted.wrapper.findAll('.accordion-button')).toHaveLength(0);
            expect(mounted.writes).toHaveLength(0);
        } finally { await mounted.dispose(); }
    });
});
