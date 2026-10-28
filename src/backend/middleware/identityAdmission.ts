import {createHmac, randomBytes} from 'node:crypto';
import rateLimit, {ipKeyGenerator, MemoryStore} from 'express-rate-limit';
import type {Request, Response} from 'express';
import type {AugmentedRequest, RateLimitRequestHandler} from 'express-rate-limit';
import type {IdentityAdmission, IdentityAdmissionLimits, IdentityLoginAdmission} from '../../types/IdentityAdmissionTypes';
import {ApiProblem} from '../modules/api/problem';
import settings from '../modules/settings';

type AdmissionRule = {store: MemoryStore; handler: RateLimitRequestHandler; keys: WeakMap<Request, string>};
type FailureReservation = {release(): Promise<void>};
let sharedAdmission: IdentityAdmission | undefined;

/** Settings are initialized before the first request, rather than captured by router imports. */
export function getIdentityAdmission(): IdentityAdmission {
    return sharedAdmission ??= createIdentityAdmission(settings.value);
}

/** Own one process's installed-limiter budgets across every matching identity route.
 * Counters expire through MemoryStore; HMAC keys retain no submitted names or
 * passwords. Credential reservations conservatively include in-flight checks. */
export function createIdentityAdmission(limits: IdentityAdmissionLimits): IdentityAdmission {
    const secret = randomBytes(32);
    const rules = {
        attempts: createRule(limits.authLoginClientLimit, limits.authLoginWindowMinutes),
        failures: createRule(limits.authLoginFailureClientLimit, limits.authLoginWindowMinutes),
        account: createRule(limits.authLoginAccountLimit, limits.authLoginWindowMinutes),
        signup: createRule(limits.authSignupClientLimit, limits.authSignupWindowMinutes),
        guest: createRule(limits.authGuestCreationClientLimit, limits.authGuestCreationWindowMinutes),
        mailClient: createRule(limits.authMailClientLimit, limits.authMailClientWindowMinutes),
        mailRecipient: createRule(limits.authMailRecipientLimit, limits.authMailRecipientWindowMinutes),
        lookup: createRule(limits.authGuestLookupClientLimit, limits.authGuestLookupWindowMinutes),
    };

    /** Match the established proxy-derived address and the installed IPv6 subnet policy. */
    function clientKey(request: Request): string { return ipKeyGenerator(request.ip ?? request.socket.remoteAddress ?? 'unknown'); }
    function opaque(value: string): string { return createHmac('sha256', secret).update(value).digest('hex'); }

    /** Admit client work before lookup; all identifier/password spellings share failures. */
    async function login(request: Request, response: Response, identifier: string): Promise<IdentityLoginAdmission> {
        const client = clientKey(request);
        await admit(rules.attempts, request, response, client);
        const clientFailure = await reserve(rules.failures, request, response, client);
        let accountFailure: FailureReservation | undefined;
        let accountKey: string | undefined;
        let verifiedCredentials = false;
        let finished = false;

        /** Existing identity resolution collapses username/email and database aliases. */
        async function account(accountId: number | null): Promise<void> {
            accountKey = opaque(accountId === null ? 'unknown:' + identifier.trim().toLowerCase() : 'account:' + accountId);
            accountFailure = await reserve(rules.account, request, response, accountKey);
        }

        /** A valid password is not a failed credential, even when activation later rejects. */
        async function verified(): Promise<void> {
            verifiedCredentials = true;
            await clientFailure.release();
            await accountFailure?.release();
        }

        /** Only completed login clears account failures; client history is never reset. */
        async function succeeded(): Promise<void> {
            if (verifiedCredentials && accountKey) await rules.account.store.resetKey(accountKey);
        }

        /** Preserve only actual invalid-credential checks, not operational/admission faults. */
        async function finish(error?: unknown): Promise<void> {
            if (finished) return;
            finished = true;
            // Unknown accounts and wrong passwords have the same existing cause.
            // A blocked account, store fault or later identity failure spends no
            // failed-credential reservation beyond actual attempted verification.
            const rejected = error instanceof Error && error.cause === 'INVALID_CREDENTIALS';
            if (!rejected || verifiedCredentials) {
                await clientFailure.release();
                await accountFailure?.release();
            }
        }
        return {account, verified, succeeded, finish};
    }

    async function signup(request: Request, response: Response): Promise<void> {
        await admit(rules.signup, request, response, clientKey(request));
    }
    async function guestCreation(request: Request, response: Response): Promise<void> {
        await admit(rules.guest, request, response, clientKey(request));
    }
    async function guestLookup(request: Request, response: Response): Promise<void> {
        await admit(rules.lookup, request, response, clientKey(request));
    }

    /** Reserve before token replacement or mail preparation, including unknown recipients. */
    async function mail(request: Request, response: Response, recipient: string): Promise<void> {
        await admit(rules.mailClient, request, response, clientKey(request));
        // Matching email spellings share delivery pressure without changing the
        // submitted value used by the existing identity or mail operation.
        await admit(rules.mailRecipient, request, response, opaque('mail:' + recipient.trim().toLowerCase()));
    }
    /** Release this owner's installed expiry timers together at its own disposal. */
    function dispose(): void {
        // Store shutdown owns timer cleanup; no second counter or expiry job survives.
        for (const rule of Object.values(rules)) rule.store.shutdown();
    }
    return {login, signup, guestCreation, guestLookup, mail, dispose};
}

/** Reuse installed middleware initialization, expiry, counting and bounded 429 delivery. */
function createRule(limit: number, minutes: number): AdmissionRule {
    const store = new MemoryStore();
    const keys = new WeakMap<Request, string>();
    const handler = rateLimit({limit, windowMs: minutes * 60_000, store, legacyHeaders: false, standardHeaders: false,
        // This one process owner initializes lazily after settings. It does not
        // recreate a limiter for each request; retain every other library check.
        validate: {creationStack: false},
        keyGenerator: request => keys.get(request)!,
        handler(request, response, next, options) {
            // Use the library's actual deadline without publishing opaque keys or
            // account-found information through separate per-account headers.
            const reset = (request as AugmentedRequest).rateLimit?.resetTime?.getTime();
            response.set('Retry-After', String(Math.max(1, Math.ceil(((reset ?? Date.now() + options.windowMs) - Date.now()) / 1000))));
            next(new ApiProblem('RATE_LIMITED'));
        },
    });
    return {store, keys, handler};
}

/** Wait for one middleware admission without adding another response or request-state owner. */
async function admit(rule: AdmissionRule, request: Request, response: Response, key: string): Promise<number | undefined> {
    rule.keys.set(request, key);
    try {
        return await new Promise<number | undefined>(function completeAdmission(resolve, reject) {
            // Capture this increment's own immutable deadline in the middleware
            // callback. A later store read could already belong to a new window.
            const result = rule.handler(request, response, error => error ? reject(error)
                : resolve((request as AugmentedRequest).rateLimit?.resetTime?.getTime()));
            void Promise.resolve(result).catch(reject);
        });
    } finally {
        rule.keys.delete(request);
    }
}

/** A credential check can release only its own reservation in the same counter window. */
async function reserve(rule: AdmissionRule, request: Request, response: Response, key: string): Promise<FailureReservation> {
    let reset: number | undefined;
    try {
        reset = await admit(rule, request, response, key);
    } catch (error) {
        // A blocked check never reached credentials. Leave the exhausted history
        // intact without increasing it for this unperformed password check.
        await releaseCurrentWindow(rule, key, (request as AugmentedRequest).rateLimit?.resetTime?.getTime());
        throw error;
    }
    let active = true;
    /** Release this lease once, without touching failures in a successor window. */
    async function release(): Promise<void> {
        if (!active) return;
        active = false;
        // Slow password work cannot decrement a successor window's attempts.
        await releaseCurrentWindow(rule, key, reset);
    }
    return {release};
}

/** Never let a delayed completion spend a successor counter window's allowance. */
async function releaseCurrentWindow(rule: AdmissionRule, key: string, reset: number | undefined): Promise<void> {
    if (reset === undefined || Date.now() >= reset) return;
    const current = await rule.store.get(key);
    // MemoryStore decrements synchronously before its promise resolves. Recheck
    // time and identity after the awaited read, then call it without another gap.
    if (Date.now() < reset && current?.resetTime?.getTime() === reset) await rule.store.decrement(key);
}
