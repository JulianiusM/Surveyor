import type {components, paths} from '../../types/api/v1';
import type {ApiOperationId} from '../../types/ApiTransportTypes';
import type {PilotRead, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import {PilotTransport, ObsoleteRequestError, UnconfirmedResponseError} from './transport';
import {validateSessionView} from '../../../.generated/api/v1/browser/validateSessionView.mjs';
import {validatePasswordResetCheck} from '../../../.generated/api/v1/browser/validatePasswordResetCheck.mjs';
import {validateIdentityResult} from '../../../.generated/api/v1/browser/validateIdentityResult.mjs';
import {validateMutationResult} from '../../../.generated/api/v1/browser/validateMutationResult.mjs';
import {validateGuestEmailExists} from '../../../.generated/api/v1/browser/validateGuestEmailExists.mjs';

type Session = components['schemas']['SessionView'];

/** Session and identity commands are needed by the shell; product feature operations stay with their routes. */
export class PilotApi extends PilotTransport {
    async bootstrap(signal?: AbortSignal): Promise<Session> {
        return this.allowedRead('session', undefined, async () =>
            this.read("getSession", await this.client.GET('/session', {signal, cache: 'no-store'}), validateSessionView).data);
    }

    async setLocale(locale: string, scope: PilotRequestScope): Promise<Session> {
        return this.read("setLocale", await this.client.PUT('/locale', {
            body: {locale}, params: {header: this.headers(scope)}, cache: 'no-store',
        }), validateSessionView, scope).data;
    }

    async checkPasswordReset(token: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PasswordResetCheck']> {
        return this.allowedRead(`identity/reset/${token}`, scope, async () => this.read("checkPasswordReset", await this.client.GET('/auth/reset-password', {
            params: {query: {token}, header: this.headers(scope)}, signal, cache: 'no-store',
        }), validatePasswordResetCheck, scope).data);
    }

    identity(operationId: ApiOperationId, result: {data?: unknown; error?: unknown; response: Response}, scope: PilotRequestScope) {
        if (!this.isCurrent(scope)) throw new ObsoleteRequestError();
        const value = this.read(operationId, result, validateIdentityResult).data;
        if (result.response.headers.get('X-Surveyor-Context') !== value.session.context) throw new UnconfirmedResponseError();
        return value;
    }

    async login(input: components['schemas']['LoginInput'], scope: PilotRequestScope) {
        return this.identity("loginIdentity", await this.client.POST('/auth/login', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), scope);
    }

    async logout(scope: PilotRequestScope) {
        return this.identity("logoutIdentity", await this.client.POST('/auth/logout', {params: {header: this.headers(scope)}, cache: 'no-store'}), scope);
    }

    async guestLogin(input: components['schemas']['GuestLoginInput'], scope: PilotRequestScope) {
        return this.identity("loginGuestIdentity", await this.client.POST('/auth/guest-login', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), scope);
    }

    async switchProfile(profileId: string, scope: PilotRequestScope) {
        return this.identity("switchIdentityProfile", await this.client.PUT('/auth/profile', {params: {header: this.headers(scope)}, body: {profileId}, cache: 'no-store'}), scope);
    }

    async register(input: components['schemas']['RegistrationInput'], scope: PilotRequestScope) {
        return this.read("registerAccount", await this.client.POST('/auth/register', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateMutationResult, scope).data;
    }

    async forgotPassword(input: components['schemas']['UsernameInput'], scope: PilotRequestScope) {
        return this.read("requestPasswordReset", await this.client.POST('/auth/forgot-password', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateMutationResult, scope).data;
    }

    async resetPassword(input: components['schemas']['ResetInput'], scope: PilotRequestScope) {
        return this.read("resetAccountPassword", await this.client.POST('/auth/reset-password', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateMutationResult, scope).data;
    }

    async activate(input: components['schemas']['TokenInput'], scope: PilotRequestScope) {
        return this.read("activateIdentity", await this.client.POST('/auth/activate', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateMutationResult, scope).data;
    }

    async recoverGuest(input: components['schemas']['EmailInput'], scope: PilotRequestScope) {
        return this.read("recoverGuestIdentity", await this.client.POST('/auth/guest-recovery', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateMutationResult, scope).data;
    }

    async guestEmailExists(input: components['schemas']['EmailInput'], scope: PilotRequestScope) {
        return this.read("findGuestEmail", await this.client.POST('/auth/guest-email-exists', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateGuestEmailExists, scope).data;
    }
}
