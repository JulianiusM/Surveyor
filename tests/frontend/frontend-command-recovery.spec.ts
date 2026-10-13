// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mount, flushPromises} from '@vue/test-utils';
import {defineComponent, nextTick, ref} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import I18NextVue from 'i18next-vue';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import {ApiFailure, InvalidInputError} from '../../src/frontend/app/transport';
import {useCommand} from '../../src/frontend/composables/command';
import type {components} from '../../src/types/api/v1';
import type {PilotRequestScope} from '../../src/types/FrontendPilotUiTypes';

const session: components['schemas']['SessionView'] = {
    kind: 'account', context: 'command-context-1234567890', csrfToken: 'command-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'},
    activeProfile: {id: '11111111-1111-4111-8111-111111111111', name: 'Owner'}, profiles: [],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'test', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mountedCommand(review = false, request?: typeof fetch) {
    const context = createPilotContext({session}, false, request);
    const refresh = vi.fn(async (): Promise<void> => undefined);
    let command!: ReturnType<typeof useCommand>;
    const component = defineComponent({
        setup() { command = useCommand(refresh, review); return {command}; },
        template: '<section><input value="Form draft" />'
            + '<p v-if="command.error.value" data-command-diagnostic>{{ command.error.value }}</p>'
            + '<p v-if="command.uncertain.value" data-command-unknown>Uncertain write</p></section>',
    });
    const router = createRouter({history: createMemoryHistory(), routes: [{path: '/', component}]});
    await router.push('/');
    const wrapper = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [I18NextVue, {i18next: context.i18next}]], provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();
    cleanups.push(() => { wrapper.unmount(); context.queryClient.clear(); context.updates.dispose(); });
    return {context, command, refresh, wrapper};
}

/** Remove the actual command-root component while its HTTP operation is outstanding.
 * The router/context remain mounted, as they do when a denied read closes an editor. */
async function mountedRetirableCommand(refresh: () => Promise<unknown> = async () => undefined) {
    const context = createPilotContext({session}, false);
    const visible = ref(true);
    let command!: ReturnType<typeof useCommand>;
    const editor = defineComponent({
        setup() { command = useCommand(refresh, true); return {}; }, template: '<p>Editor</p>',
    });
    const page = defineComponent({components: {Editor: editor}, setup() { return {visible}; },
        template: '<Editor v-if="visible" />'});
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/', component: page}, {path: '/away', component: defineComponent({template: '<p>Away</p>'})},
    ]});
    await router.push('/');
    const wrapper = mount(defineComponent({template: '<RouterView />'}), {global: {
        plugins: [router, [I18NextVue, {i18next: context.i18next}]], provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();
    cleanups.push(() => { wrapper.unmount(); context.queryClient.clear(); context.updates.dispose(); });
    return {context, command, router, visible};
}

function unloadAttempt(): Event {
    const event = new Event('beforeunload', {cancelable: true});
    window.dispatchEvent(event);
    return event;
}

describe('reconcile-only commands', () => {
    it.each(['future', 'known', 'malformed'] as const)('presents only validated %s server diagnostics while retaining unknown command protection', async representation => {
        const status = representation === 'known' ? 500 : 503;
        const safeDetail = 'The server could not confirm this write.';
        const body = representation === 'malformed' ? {detail: 'Untrusted proxy diagnostic'}
            : {type: 'urn:surveyor:problem:server-failure', title: 'Unavailable', status, detail: safeDetail,
                requestId: 'unknown-command-diagnostic', code: representation === 'known' ? 'INTERNAL_ERROR' : 'FUTURE_FAILURE',
                messageKey: representation === 'known' ? 'api:errors.INTERNAL_ERROR' : 'api:errors.FUTURE_FAILURE', params: {}};
        const request = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(body), {status,
            headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}}));
        const {context, command, refresh, wrapper} = await mountedCommand(true, request);
        const draft = wrapper.get<HTMLInputElement>('input');
        await draft.setValue('Retained unknown command draft');
        draft.element.focus();
        draft.element.setSelectionRange(3, 11);
        function submitLogout(scope: PilotRequestScope) { return context.api.logout(scope); }
        const write = vi.fn(submitLogout);

        await command.run(write, false);
        await nextTick();
        expect(command.outcome.value).toEqual({confirmation: 'unknown', refresh: 'not-requested'});
        expect(command.notice.value).toBe('state.unknownOutcome');
        expect(command.uncertain.value).toBe(true);
        expect(wrapper.find('[data-command-unknown]').exists()).toBe(true);
        if (representation === 'malformed') {
            expect(command.error.value).toBeNull();
            expect(wrapper.find('[data-command-diagnostic]').exists()).toBe(false);
            expect(wrapper.text()).not.toContain('Untrusted proxy diagnostic');
        } else {
            expect(command.transientError.value).toBe(false);
            expect(wrapper.get('[data-command-diagnostic]').text()).toBe(representation === 'known'
                ? context.messages.value.t('api:errors.INTERNAL_ERROR') : safeDetail);
            context.locale.value = 'de';
            await nextTick();
            expect(wrapper.get('[data-command-diagnostic]').text()).toBe(representation === 'known'
                ? context.messages.value.t('api:errors.INTERNAL_ERROR') : safeDetail);
        }

        // A rendered explanation never resolves uncertainty or admits another POST.
        // The explicit review-required read also retains the same draft and lease.
        await command.run(write, false);
        await command.reconcile();
        expect(refresh).toHaveBeenCalledOnce();
        expect(command.uncertain.value).toBe(true);
        expect(write).toHaveBeenCalledOnce();
        expect(request).toHaveBeenCalledOnce();
        expect((request.mock.calls[0][0] as Request).method).toBe('POST');
        expect(wrapper.get('input').element).toBe(draft.element);
        expect(draft.element.value).toBe('Retained unknown command draft');
        expect([draft.element.selectionStart, draft.element.selectionEnd]).toEqual([3, 11]);
        expect(document.activeElement).toBe(draft.element);
        command.acknowledge();
    });

    it('retains the synchronous initiating section through async confirmation and gives repeated native success a new receipt', async () => {
        const {command} = await mountedCommand();
        const dialog = document.createElement('section');
        dialog.setAttribute('role', 'dialog');
        dialog.innerHTML = '<div data-dialog-feedback></div><section data-entity-section="permissions">'
            + '<div data-command-feedback></div><button>Save</button></section>';
        document.body.appendChild(dialog);
        const source = dialog.querySelector('button')!;
        const target = dialog.querySelector<HTMLElement>('[data-command-feedback]')!;
        let resolveWrite!: (value: {changed: boolean}) => void;
        const write = new Promise<{changed: boolean}>(function captureWrite(resolve) { resolveWrite = resolve; });
        let submitted: Promise<unknown> | undefined;
        let initiatingEvent: Event | undefined;
        function save(event: Event): void {
            initiatingEvent = event;
            submitted = command.run(function submitWrite() { return write; }, true, false,
                {initiator: event, presentation: 'inline', success: 'permissions.updated'});
        }
        source.addEventListener('click', save);
        try {
            source.click();
            expect(initiatingEvent?.currentTarget).toBeNull();
            expect(command.feedbackTarget.value).toBe(target);
            resolveWrite({changed: true});
            await submitted;
            expect(command.feedbackTarget.value).toBe(target);
            expect(command.notice.value).toBe('permissions.updated');
            expect(command.noticeKind.value).toBe('success');
            expect(command.transientNotice.value).toBe(true);
            expect(command.noticeInline.value).toBe(true);
            const receipt = command.noticeRenewal.value;
            command.setNotice('permissions.updated', {initiator: source, presentation: 'inline'});
            expect(command.noticeRenewal.value).not.toBe(receipt);
            expect(command.feedbackTarget.value).toBe(target);
            command.notice.value = 'state.savedRefreshFailed';
            expect(command.noticeKind.value).toBe('warning');
            expect(command.transientNotice.value).toBe(false);
            expect(command.noticeInline.value).toBe(false);
        } finally { dialog.remove(); }
    });

    it.each(['recover', 'reconcile'] as const)('retains %s protection after editor retirement until the read settles, without acknowledging creation', async recovery => {
        let finishRead!: () => void;
        const read = new Promise<void>(resolve => { finishRead = resolve; });
        const {context, command, router, visible} = await mountedRetirableCommand(() => read);
        const write = vi.fn(async () => { throw new TypeError('Creation response lost'); });
        await command.run(write, false);
        const running = command[recovery]();
        visible.value = false;
        await nextTick();
        const confirmation = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmation);

        expect(command.recovering.value).toBe(true);
        expect(context.mayChangeIdentity()).toBe(false);
        expect(unloadAttempt().defaultPrevented).toBe(true);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/');
        expect(confirmation).not.toHaveBeenCalled();

        finishRead();
        await running;
        expect(command.recovering.value).toBe(false);
        expect(command.uncertain.value).toBe(true);
        expect(write).toHaveBeenCalledOnce();
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/away');
        expect(confirmation).toHaveBeenCalledOnce();
        expect(unloadAttempt().defaultPrevented).toBe(false);
    });

    it.each([false, true])('does not let an earlier ordinary refresh affect a later unknown command (failure=%s)', async failed => {
        let finishRead!: () => void;
        let failRead!: (reason: Error) => void;
        const read = new Promise<void>((resolve, reject) => { finishRead = resolve; failRead = reject; });
        const {command, refresh} = await mountedCommand();
        refresh.mockImplementationOnce(() => read);
        const refreshing = command.reconcile();
        // This read began before the mutation. Its later completion cannot prove
        // whether that independently submitted write persisted after response loss.
        await command.run(async () => { throw new TypeError('Later write response lost'); }, false);
        if (failed) failRead(new TypeError('Earlier read failed'));
        else finishRead();
        await refreshing;
        expect(command.uncertain.value).toBe(true);
        expect(command.outcome.value?.confirmation).toBe('unknown');
        expect(command.notice.value).toBe('state.unknownOutcome');
        // Deliberate acknowledgement ends this fixture's retained unknown lifetime.
        command.acknowledge();
    });

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

    it.each(['validation', 'success'] as const)('keeps native transient %s feedback through an ordinary successful refresh', async result => {
        const {command} = await mountedCommand();
        if (result === 'validation') {
            await command.run(async () => { throw new InvalidInputError(); }, false);
            const rejection = command.error.value;
            expect(rejection).toBeTruthy();
            await command.reconcile();
            expect(command.error.value).toBe(rejection);
            expect(command.transientError.value).toBe(true);
        } else {
            await command.run(async () => ({changed: true}), false);
            await command.reconcile();
            expect(command.notice.value).toBe('state.saved');
        }
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
        await command.reconcile();
        expect(command.notice.value).toBeNull();
    });

    it('retires a confirmed result when its following read changes the active identity', async () => {
        const {command, context, refresh} = await mountedCommand();
        refresh.mockImplementationOnce(async () => { context.epoch.value++; });
        expect(await command.run(async () => ({changed: true}))).toBeUndefined();
        expect(command.outcome.value).toEqual({confirmation: 'obsolete', refresh: 'succeeded'});
        expect(command.notice.value).toBeNull();
    });

    it('does not start a new command after its owner retires', async function retiredOwnerAdmission() {
        const {context, command, visible} = await mountedRetirableCommand();
        const operation = vi.fn(async function submitRetiredOperation(): Promise<void> { throw new TypeError('Fixture response lost'); });
        visible.value = false;
        await nextTick();

        // The same actor is still current, but this form has already closed. A
        // newly invoked run must not dispatch or invent an invisible uncertainty lease.
        try {
            expect(await command.run(operation, false)).toBeUndefined();
            expect(operation).not.toHaveBeenCalled();
            expect(command.outcome.value).toBeNull();
            expect(command.pending.value).toBe(false);
            expect(command.uncertain.value).toBe(false);
            expect(context.mayChangeIdentity()).toBe(true);
            expect(unloadAttempt().defaultPrevented).toBe(false);
        } finally { command.acknowledge(); }
    });

    it('lets an admitted deferred operation dispatch after retirement and protects it until settlement', async function admittedDeferredOperation() {
        let releasePrerequisite!: () => void;
        let finishRequest!: (result: {changed: boolean}) => void;
        const prerequisite = new Promise<void>(function holdPrerequisite(resolve) { releasePrerequisite = resolve; });
        const response = new Promise<{changed: boolean}>(function holdExternalResult(resolve) { finishRequest = resolve; });
        const {context, command, router, visible} = await mountedRetirableCommand();
        const request = vi.fn(function submitAdmittedRequest(_scope: PilotRequestScope) { return response; });
        const confirm = vi.fn(() => true);
        vi.stubGlobal('confirm', confirm);

        /** The public command is admitted while mounted. Its own operation may
         * legitimately wait before reaching the external request boundary. */
        async function submitAfterPrerequisite(scope: PilotRequestScope) {
            await prerequisite;
            return request(scope);
        }
        const running = command.run(submitAfterPrerequisite, false);
        try {
            visible.value = false;
            await nextTick();
            expect(request).not.toHaveBeenCalled();
            expect(command.pending.value).toBe(true);
            expect(context.mayChangeIdentity()).toBe(false);
            expect(unloadAttempt().defaultPrevented).toBe(true);
            await router.push('/away');
            expect(router.currentRoute.value.path).toBe('/');

            // Closure does not cancel previously admitted work or release its
            // captured-actor protection while the later request is outstanding.
            releasePrerequisite();
            await flushPromises();
            expect(request).toHaveBeenCalledOnce();
            expect(request.mock.calls[0][0].context).toBe(session.context);
            expect(command.pending.value).toBe(true);
            expect(context.mayChangeIdentity()).toBe(false);
            expect(unloadAttempt().defaultPrevented).toBe(true);

            finishRequest({changed: true});
            expect(await running).toEqual({changed: true});
            expect(command.outcome.value).toEqual({confirmation: 'confirmed', refresh: 'not-requested'});
            expect(command.pending.value).toBe(false);
            expect(context.mayChangeIdentity()).toBe(true);
            expect(unloadAttempt().defaultPrevented).toBe(false);
            await router.push('/away');
            expect(router.currentRoute.value.path).toBe('/away');
            expect(confirm).not.toHaveBeenCalled();
        } finally {
            releasePrerequisite();
            finishRequest({changed: true});
            await running;
        }
    });

    it('keeps a retired command root protected through its write and following read, then releases it', async () => {
        let finishWrite!: (value: {changed: boolean}) => void;
        let finishRead!: () => void;
        const write = new Promise<{changed: boolean}>(resolve => { finishWrite = resolve; });
        const read = new Promise<void>(resolve => { finishRead = resolve; });
        const {context, command, router, visible} = await mountedRetirableCommand(() => read);
        const confirmation = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmation);
        const running = command.run(() => write);
        visible.value = false;
        await nextTick();

        expect(context.mayChangeIdentity()).toBe(false);
        expect(unloadAttempt().defaultPrevented).toBe(true);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/');
        expect(confirmation).not.toHaveBeenCalled();

        finishWrite({changed: true});
        await flushPromises();
        expect(command.outcome.value).toEqual({confirmation: 'confirmed', refresh: 'pending'});
        expect(context.mayChangeIdentity()).toBe(false);
        expect(unloadAttempt().defaultPrevented).toBe(true);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/');

        finishRead();
        expect(await running).toEqual({changed: true});
        expect(context.mayChangeIdentity()).toBe(true);
        expect(unloadAttempt().defaultPrevented).toBe(false);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/away');
        expect(confirmation).not.toHaveBeenCalled();
    });

    it('retains a retired unknown command until an accepted departure, without replaying it', async () => {
        let rejectWrite!: (reason: Error) => void;
        const write = new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
        const {context, command, router, visible} = await mountedRetirableCommand();
        const operation = vi.fn(() => write);
        const running = command.run(operation, false);
        visible.value = false;
        await nextTick();
        rejectWrite(new TypeError('Response lost'));
        await running;

        const confirmation = vi.fn(() => false);
        vi.stubGlobal('confirm', confirmation);
        expect(command.uncertain.value).toBe(true);
        expect(unloadAttempt().defaultPrevented).toBe(true);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/');
        expect(confirmation).toHaveBeenCalledWith(context.messages.value.t('draft.leaveUnknown'));
        expect(context.mayChangeIdentity()).toBe(false);
        await command.run(operation, false);
        expect(operation).toHaveBeenCalledOnce();

        confirmation.mockReturnValue(true);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/away');
        expect(context.mayChangeIdentity()).toBe(true);
        expect(unloadAttempt().defaultPrevented).toBe(false);
    });

    it('retires old command guards immediately when a new authoritative actor supersedes their scope', async () => {
        let finishWrite!: (value: {changed: boolean}) => void;
        const write = new Promise<{changed: boolean}>(resolve => { finishWrite = resolve; });
        const {context, command, router, visible} = await mountedRetirableCommand();
        const running = command.run(() => write, false);
        visible.value = false;
        await nextTick();
        context.epoch.value++;
        expect(context.mayChangeIdentity()).toBe(true);
        expect(unloadAttempt().defaultPrevented).toBe(false);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/away');
        finishWrite({changed: true});
        expect(await running).toBeUndefined();
        expect(command.outcome.value?.confirmation).toBe('obsolete');
        expect(command.notice.value).toBeNull();
    });

    it('protects a later actor command from a persistent owner whose original draft scope retired', async () => {
        let finishWrite!: () => void;
        const write = new Promise<void>(resolve => { finishWrite = resolve; });
        const {context, command, router} = await mountedRetirableCommand();
        await command.run(async () => { throw new TypeError('Old actor response lost'); }, false);
        expect(command.uncertain.value).toBe(true);
        context.epoch.value++;
        expect(command.uncertain.value).toBe(false);
        const running = command.run(() => write, false);
        expect(command.pending.value).toBe(true);
        expect(context.mayChangeIdentity()).toBe(false);
        expect(unloadAttempt().defaultPrevented).toBe(true);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/');
        finishWrite();
        await running;
        expect(context.mayChangeIdentity()).toBe(true);
        expect(unloadAttempt().defaultPrevented).toBe(false);
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
