import type {components, paths} from '../../types/api/v1';
import type {ApiOperationId} from '../../types/ApiTransportTypes';
import type {PilotRead, PilotRequestScope} from '../../types/FrontendPilotUiTypes';
import {PilotTransport, ObsoleteRequestError, UnconfirmedResponseError} from './transport';
import {validateSessionView} from '../../../.generated/api/v1/browser/validateSessionView.mjs';
import {validatePasswordResetCheck} from '../../../.generated/api/v1/browser/validatePasswordResetCheck.mjs';
import {validateIdentityResult} from '../../../.generated/api/v1/browser/validateIdentityResult.mjs';
import {validateRegistrationResult} from '../../../.generated/api/v1/browser/validateRegistrationResult.mjs';
import {validateMutationResult} from '../../../.generated/api/v1/browser/validateMutationResult.mjs';
import {validateGuestEmailExists} from '../../../.generated/api/v1/browser/validateGuestEmailExists.mjs';
import {validateProfileWorkflowCompletion} from '../../../.generated/api/v1/browser/validateProfileWorkflowCompletion.mjs';

type Session = components['schemas']['SessionView'];
type IdentityEvidence = {session: Pick<Session, 'context'>} | {resultingContext: Session['context']};

/** Session and identity commands are needed by the shell; product feature operations stay with their routes. */
export class PilotApi extends PilotTransport {
    /** Bootstrap reads the current server identity without establishing a session.
     * Its shared deadline is application-local; no conditional private snapshot or
     * previously captured actor is supplied to this identity admission request. */
    async bootstrap(signal?: AbortSignal): Promise<Session> {
        const transport = this;
        async function readSession(): Promise<Session> {
            const response = await transport.client.GET('/session', {signal, cache: 'no-store'});
            return transport.read("getSession", {...response, signal}, validateSessionView).data;
        }
        return this.allowedRead('session', undefined, readSession, signal);
    }

    async setLocale(locale: string, scope: PilotRequestScope): Promise<Session> {
        return this.read("setLocale", await this.client.PUT('/locale', {
            body: {locale}, params: {header: this.headers(scope)}, cache: 'no-store',
        }), validateSessionView, scope).data;
    }

    /** Check this token without consuming it or replaying password submission.
     * Cancellation, captured actor validation and the token-specific read deadline
     * remain with the transport; only validated admission reaches the reset form. */
    async checkPasswordReset(token: string, scope: PilotRequestScope, signal?: AbortSignal): Promise<components['schemas']['PasswordResetCheck']> {
        const transport = this;
        async function readResetAdmission(): Promise<components['schemas']['PasswordResetCheck']> {
            const response = await transport.client.GET('/auth/reset-password', {
                params: {query: {token}, header: transport.headers(scope)}, signal, cache: 'no-store',
            });
            return transport.read("checkPasswordReset", {...response, signal}, validatePasswordResetCheck, scope).data;
        }
        return this.allowedRead(`identity/reset/${token}`, scope, readResetAdmission, signal);
    }

    /** Validate a cookie-changing command from its still-current original actor.
     * Its response legitimately carries a new context; bind that header to the
     * returned session, leaving authoritative new-actor bootstrap to the context owner. */
    identity(operationId: ApiOperationId, result: {data?: unknown; error?: unknown; response: Response}, scope: PilotRequestScope) {
        return this.readIdentity(operationId, result, validateIdentityResult, scope);
    }

    /** Legacy workflow completion supplies a scalar actor receipt, not a fallible
     * postcommit SessionView. The same confirmation boundary admits either shape. */
    workflow(operationId: ApiOperationId, result: {data?: unknown; error?: unknown; response: Response}, scope: PilotRequestScope) {
        return this.readIdentity(operationId, result, validateProfileWorkflowCompletion, scope);
    }

    /** Bind generated confirmation to the initiating actor and resulting header.
     * Only the existing authoritative session read can open the resulting identity. */
    private readIdentity<T extends IdentityEvidence>(operationId: ApiOperationId,
        result: {data?: unknown; error?: unknown; response: Response},
        validate: (value: unknown) => value is T, scope: PilotRequestScope): T {
        if (!this.isCurrent(scope)) throw new ObsoleteRequestError();

        // Intentionally omit the old scope from ordinary response validation:
        // login/logout/profile/guest success returns the resulting session context,
        // so comparing its header with the submitted actor would reject confirmation.
        const value = this.read(operationId, result, validate).data;

        // The new context must positively bind both header and validated payload.
        // Accepting this result alone does not open private views under that actor.
        const resultingContext = 'session' in value ? value.session.context : value.resultingContext;
        if (result.response.headers.get('X-Surveyor-Context') !== resultingContext) throw new UnconfirmedResponseError();
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
        return this.read("registerAccount", await this.client.POST('/auth/register', {params: {header: this.headers(scope)}, body: input, cache: 'no-store'}), validateRegistrationResult, scope).data;
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
