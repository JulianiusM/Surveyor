import {test} from '@playwright/test';
import type {APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {createE2EEvent, createE2ELogin} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E} from './e2eCoreKeywords';

/** Use the real session/bootstrap and configured browser origin for API commands. */
export async function frontendEventHeaders(request: APIRequestContext): Promise<Record<string, string>> {
    const session = await (await request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    const baseURL = test.info().project.use.baseURL;
    if (!baseURL) throw new Error('Built Event tests require their configured application origin.');
    return {Origin: new URL(baseURL).origin, 'X-Surveyor-Api-Compatibility': apiCompatibility,
        ...(session.context ? {'X-Surveyor-Context': session.context, 'X-CSRF-Token': session.csrfToken!} : {})};
}

/** Create independent records through native HTTP to prove actual coexistence. */
export async function createFrontendEventFixture(request: APIRequestContext, deadline = false) {
    await loginForE2E(request, createE2ELogin());
    const input = createE2EEvent();
    input.title = input.form.title = `P2 Event ${randomUUID().slice(0, 8)}`;
    Object.assign(input.form, {startDate: '2030-06-01', endDate: '2030-06-04',
        bindingDeadline: deadline ? '2000-01-01T00:00' : '',
        allowRegDateUpdatesAfterDeadline: 'on', allowRegDietUpdateAfterDeadline: 'on', allowRegCancelationAfterDeadline: 'on',
        // Indexed names encode the same permission arrays as the native form's
        // repeated checkboxes; omitted fields would deliberately create no grants.
        'defaultPerms[public][0]': 'ACCESS_REGISTRATION', 'defaultPerms[public][1]': 'ACCESS_VIEW',
        'defaultPerms[public][2]': 'ACCESS_CREATE', 'defaultPerms[public][3]': 'ACCESS_ITEMS',
        'defaultPerms[participant][0]': 'ACCESS_PARTICIPANTS'});
    return createResourceViaForm(request, input);
}
