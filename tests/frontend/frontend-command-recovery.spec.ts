// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mount, flushPromises} from '@vue/test-utils';
import {defineComponent, nextTick, ref} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import I18NextVue from 'i18next-vue';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import {ApiFailure} from '../../src/frontend/app/transport';
import {useCommand} from '../../src/frontend/composables/command';
import type {components} from '../../src/types/api/v1';

const session: components['schemas']['SessionView'] = {
    kind: 'account', context: 'command-context-1234567890', csrfToken: 'command-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'},
    activeProfile: {id: '11111111-1111-4111-8111-111111111111', name: 'Owner'}, profiles: [],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'test', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mountedCommand(review = false) {
    const context = createPilotContext({session}, false);
    const refresh = vi.fn(async () => undefined);
    let command!: ReturnType<typeof useCommand>;
    const component = defineComponent({setup() { command = useCommand(refresh, review); return {}; }, template: '<p>Form</p>'});
    const router = createRouter({history: createMemoryHistory(), routes: [{path: '/', component}]});
    await router.push('/');
    const wrapper = mount(defineComponent({template: '<RouterView />'}), {global: {
        plugins: [router, [I18NextVue, {i18next: context.i18next}]], provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();
    cleanups.push(() => { wrapper.unmount(); context.queryClient.clear(); context.updates.dispose(); });
    return {context, command, refresh};
}

describe('reconcile-only commands', () => {
    it('keeps a creation unknown after a successful read until deliberate acknowledgement, without replay', async () => {
        const {command, refresh} = await mountedCommand(true);
        const create = vi.fn(async () => { throw new TypeError('Response was lost'); });
        await command.run(create);
        expect(command.uncertain.value).toBe(true);
        expect(command.outcome.value).toEqual({confirmation: 'unknown', refresh: 'not-requested'});
        await command.reconcile();
        expect(refresh).toHaveBeenCalledOnce();
        expect(command.uncertain.value).toBe(true);
        await command.run(create);
        expect(create).toHaveBeenCalledOnce();
        command.acknowledge();
        expect(command.uncertain.value).toBe(false);
    });

    it('reconciles a desired-state command and retains confirmed success when its read fails', async () => {
        const {command, refresh} = await mountedCommand();
        await command.run(async () => { throw new TypeError('Response was lost'); });
        await command.reconcile();
        expect(command.uncertain.value).toBe(false);
        refresh.mockRejectedValueOnce(new TypeError('Read failed'));
        expect(await command.run(async () => ({changed: true}))).toEqual({changed: true});
        expect(command.notice.value).toBe('state.savedRefreshFailed');
        expect(command.outcome.value).toEqual({confirmation: 'confirmed', refresh: 'failed'});
        expect(command.uncertain.value).toBe(false);
    });

    it('retires a confirmed result when its following read changes the active identity', async () => {
        const {command, context, refresh} = await mountedCommand();
        refresh.mockImplementationOnce(async () => { context.epoch.value++; });
        expect(await command.run(async () => ({changed: true}))).toBeUndefined();
        expect(command.outcome.value).toEqual({confirmation: 'obsolete', refresh: 'succeeded'});
        expect(command.notice.value).toBeNull();
    });

    it('aggregates parent and child drafts into one departure, preserving cancellation and blocking pending work', async () => {
        const context = createPilotContext({session}, false);
        const parentDirty = ref(true);
        const childDirty = ref(true);
        const refresh = async () => undefined;
        let parentCommand!: ReturnType<typeof useCommand>;
        let childCommand!: ReturnType<typeof useCommand>;
        const identityGuard = vi.spyOn(context, 'registerIdentityGuard');
        const child = defineComponent({
            setup() {
                childCommand = useCommand(refresh, true, {dirty: () => childDirty.value,
                    unknownMessage: 'auth.leaveUnknown'});
                return {};
            },
            template: '<p>Child draft</p>',
        });
        const parent = defineComponent({
            components: {ChildDraft: child},
            setup() {
                parentCommand = useCommand(refresh, false, {dirty: () => parentDirty.value,
                    unknownMessage: 'draft.leaveUnknown'});
                return {};
            },
            template: '<ChildDraft />',
        });
        const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/', component: parent}, {path: '/away', component: defineComponent({template: '<p>Away</p>'})},
        ]});
        await router.push('/');
        const wrapper = mount(defineComponent({template: '<RouterView />'}), {global: {
            plugins: [router, [I18NextVue, {i18next: context.i18next}]], provide: {[pilotContextKey as symbol]: context},
        }});
        cleanups.push(() => { wrapper.unmount(); context.queryClient.clear(); context.updates.dispose(); });
        await flushPromises();
        expect(identityGuard).toHaveBeenCalledOnce();

        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/');
        expect(confirm).toHaveBeenCalledOnce();
        expect(parentDirty.value).toBe(true);
        expect(childDirty.value).toBe(true);

        await childCommand.run(async () => { throw new TypeError('Response lost'); });
        confirm.mockClear();
        expect(context.mayChangeIdentity()).toBe(false);
        expect(confirm).toHaveBeenCalledOnce();
        expect(confirm).toHaveBeenCalledWith(context.messages.value.t('auth.leaveUnknown'));
        expect(childCommand.uncertain.value).toBe(true);
        childCommand.acknowledge();

        let finish!: () => void;
        const pending = childCommand.run(() => new Promise<void>(resolve => { finish = resolve; }), false);
        confirm.mockClear();
        expect(parentCommand.mayLeave()).toBe(false);
        expect(confirm).not.toHaveBeenCalled();
        finish();
        await pending;

        confirm.mockReturnValue(true);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/away');
        expect(confirm).toHaveBeenCalledOnce();
        expect(context.mayChangeIdentity()).toBe(true);
    });

    it('changes known server and local validation messages with the mounted form language', async () => {
        const {command, context} = await mountedCommand();
        const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Request failed',
            status: 400, detail: 'English server detail', requestId: 'command-validation', code: 'VALIDATION_FAILED',
            messageKey: 'api:errors.VALIDATION_FAILED', params: {}};
        await command.run(async () => { throw new ApiFailure(400, problem); });
        const english = command.error.value;
        context.locale.value = 'de';
        await nextTick();
        expect(command.error.value).not.toBe(english);
        expect(command.error.value).toBe(context.messages.value.t('api:errors.VALIDATION_FAILED'));
        command.setError('auth.passwordMismatch');
        expect(command.error.value).toBe(context.messages.value.t('auth.passwordMismatch'));
    });
});
