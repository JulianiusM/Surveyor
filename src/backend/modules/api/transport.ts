import type {Request, RequestHandler, Response} from 'express';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {SessionLike} from '../../../types/PermissionTypes';
import type {ApiOperationId, ApiSuccessStatus, ApiResponseBody, PreparedApiJsonResponse} from '../../../types/ApiTransportTypes';
import {contractValidator, operationContract} from './contracts';
import {ApiProblem} from './problem';
import {requestLocale} from '../lib/http';
import type {ErrorObject} from 'ajv';
import {decodeScalarParameter, fieldDiagnostic} from '../../../common/localization/inputValidation';
import {resolveStoredFile} from '../lib/fileCommons';

/** Await the caller's uploader without changing its filename, byte or type policy.
 * Parser diagnostics stay private; routes retain admission and upload cleanup. */
export async function receiveApiUpload(req: Request, res: Response, upload: RequestHandler): Promise<void> {
    // Only the existing bounded upload categories cross the versioned boundary.
    /** Settle parser completion before the route validates or consumes its uploaded bytes. */
    await new Promise<void>(function receiveUpload(resolve, reject) {
        // The injected parser retains its own storage policy; expose only bounded completion categories.
        upload(req, res, error => {
            if (!error) resolve();
            else reject(new ApiProblem(error.code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'UPLOAD_INVALID'));
        });
    });
}

/** Populate wire image metadata only from the actual upload, preserving unknown form fields. */
export function decodeApiMultipartImage(body: unknown, file?: Express.Multer.File): unknown {
    return {...body as object, ...(file ? {image: file.originalname} : {})};
}

/** Decode the shared multipart data part before generated closed-shape validation.
 * A submitted filename cannot substitute for uploaded bytes or hide unknown fields. */
export function decodeApiMultipartData(body: unknown, file?: Express.Multer.File, field = 'image'): unknown {
    const form = body as Record<string, unknown>;
    if (Object.hasOwn(form, field) && !file) throw new ApiProblem('UPLOAD_INVALID');

    // Keep already decoded values and absent/malformed JSON distinctions intact.
    let data: unknown;
    try { data = typeof form.data === 'string' ? JSON.parse(form.data) : form.data; }
    catch { throw new ApiProblem('INVALID_JSON'); }
    return {...form, data, ...(file ? {[field]: file.originalname} : {})};
}

/** Decode only the serialization subset declared in the contract; JSON request bodies stay untouched. */
function scalarParameter(value: unknown, type: unknown, pointer: string): unknown {
    // Invalid scalar syntax receives the same field vocabulary as generated body
    // errors. Only the declared type/path enters feedback, never its raw value.
    const decoded = decodeScalarParameter(value, type);
    if (!decoded.valid) throw validationProblem([{instancePath: pointer, schemaPath: '', keyword: 'type', params: {type}}]);
    return decoded.value;
}

/** Decode declared scalar path/query/header values without transforming JSON body arrays.
 * Unknown parameter names remain present for the generated closed-schema validator to reject. */
export function decodeApiParameters(operationId: ApiOperationId, input: {path: object; query: object; header: object}) {
    // Work on transport copies: request values and later body normalization retain
    // their own owners, while undeclared names still reach structural validation.
    const decoded: Record<string, Record<string, unknown>> = {path: {...input.path}, query: {...input.query}, header: {...input.header}};

    // Declared parameters share the scalar decoder. Repeated or structured
    // submitted values fail in the same decoder as malformed scalars.
    for (const parameter of operationContract(operationId).parameters) {
        const value = decoded[parameter.in]?.[parameter.name];
        if (value === undefined) continue;
        const schema = parameter.schema as {type?: string};
        decoded[parameter.in]![parameter.name] = scalarParameter(value, schema.type, '/' + parameter.in + '/' + parameter.name);
    }
    return decoded;
}

/** Generated schemas are the structural authority; only transport decoding belongs here. */
export function validateApiInput(operationId: ApiOperationId, value: unknown): void {
    const schema = operationContract(operationId).requestSchema;
    if (!schema) throw new Error(`Operation has no request schema: ${operationId}`);
    const validator = contractValidator(schema);
    if (validator(value)) return;

    throw validationProblem(validator.errors);
}

/** Keep a bounded structural rejection with safe display identities. Shared
 * server/client formatting owns its wording; the generated rule supplies limits.
 * Submitted values, parser messages and schema locations are never retained. */
function validationProblem(errors: readonly ErrorObject[] | null | undefined): ApiProblem {
    const problem = new ApiProblem('VALIDATION_FAILED');
    // Required errors identify their missing field rather than only the parent.
    // Unknown-field errors keep the parent pointer and never echo an unknown key.
    problem.fieldErrors = (errors ?? []).slice(0, 20).map(error => {
        const missing = error.keyword === 'required' ? String(error.params.missingProperty ?? '') : '';
        const pointer = error.instancePath + (missing ? '/' + missing.replaceAll('~', '~0').replaceAll('/', '~1') : '');
        const diagnostic = fieldDiagnostic(error);
        return {
            pointer: pointer.slice(0, 512),
            code: ['required', 'type', 'format'].includes(error.keyword) ? error.keyword as 'required' | 'type' | 'format'
                : error.keyword === 'additionalProperties' ? 'unknown' : 'invalid',
            ...(diagnostic ? {diagnostic} : {}),
        };
    });
    return problem;
}

/** Decode declared parameters before validating the operation's media type and closed body shape. */
export function validateOperationRequest(req: Request, operationId: ApiOperationId, normalizeBody?: (body: unknown) => unknown): void {
    const operation = operationContract(operationId);
    const header: Record<string, string> = {};
    // Context/CSRF/preconditions have dedicated admission owners; the generated
    // transport validator handles only the remaining declared scalar headers here.
    for (const parameter of operation.parameters) {
        if (parameter.in !== 'header' || ['X-Surveyor-Context', 'X-CSRF-Token', 'If-Match'].includes(parameter.name)) continue;
        const value = req.get(parameter.name);
        if (value !== undefined) header[parameter.name] = value;
    }

    const parameters = decodeApiParameters(operationId, {path: req.params, query: req.query, header});
    const parameterValidator = contractValidator(operation.parametersValidator);
    if (!parameterValidator(parameters)) throw validationProblem(parameterValidator.errors);

    // Feature normalization runs only after media admission, preserving form-shaped
    // trim/empty-value semantics while retaining the generated structural contract.
    if (operation.requestSchema) {
        if (!req.is(operation.requestMediaType ?? 'application/json')) throw new ApiProblem('UNSUPPORTED_MEDIA_TYPE');
        if (normalizeBody) req.body = normalizeBody(req.body as unknown);
        validateApiInput(operationId, req.body as unknown);
    } else if (Number(req.get('Content-Length') ?? 0) > 0 || req.get('Transfer-Encoding') || req.body !== undefined) {
        throw validationProblem([{instancePath: '', schemaPath: '', keyword: 'additionalProperties', params: {}}]);
    }
}

/** All successful API representations share the same private cache and locale boundary. */
function privateResponse(req: Request, res: Response, locale = requestLocale(req)): void {
    res.set('Cache-Control', 'private, no-store').set('Content-Language', locale)
        .vary('Cookie').vary('X-Surveyor-Context').vary('X-Surveyor-Locale');
    if (req.apiActor?.context) res.set('X-Surveyor-Context', req.apiActor.context);
}

/** Validate the common JSON boundary once for ordinary replies and commit-sensitive receipts. */
function jsonResponseContract(operationId: ApiOperationId, status: number, data: unknown) {
    const operation = operationContract(operationId);
    const schema = operation.responseSchemas[String(status)];
    if (!schema || !contractValidator(schema)(data)) throw new ApiProblem('INTERNAL_ERROR');
    return operation;
}

/**
 * Validate, serialize and capture response metadata while a controller can still
 * roll back. The immutable string cannot acquire another actor's data or fail a
 * second projection after the transaction commits.
 */
export function prepareValidatedJson<Operation extends ApiOperationId, Status extends ApiSuccessStatus<NoInfer<Operation>>>(
    req: Request, operationId: Operation, status: Status, data: ApiResponseBody<NoInfer<Operation>, NoInfer<Status>>,
    context: string | null | undefined = req.apiActor?.context): PreparedApiJsonResponse {
    // Generated shape/status admission precedes serialization. Locale/context
    // are captured with this receipt rather than resolved from a later session.
    const operation = jsonResponseContract(operationId, status, data);
    return Object.freeze({status, mediaType: operation.responseMediaTypes[String(status)] ?? 'application/json',
        locale: requestLocale(req), context: context ?? undefined, json: JSON.stringify(data)});
}

/** Prepare every finite postcommit outcome while its owning transaction can still roll back.
 * Identity delivery and domain follow-up work use the same validation/serialization
 * procedure; after commit they select only an already prepared immutable receipt. */
export function prepareValidatedJsonVariants<Variant extends string, Operation extends ApiOperationId,
    Status extends ApiSuccessStatus<NoInfer<Operation>>>(req: Request, operationId: Operation, status: Status,
    variants: Readonly<Record<Variant, ApiResponseBody<NoInfer<Operation>, NoInfer<Status>>>>,
    context: string | null | undefined = req.apiActor?.context): Readonly<Record<Variant, PreparedApiJsonResponse>> {
    const prepared = {} as Record<Variant, PreparedApiJsonResponse>;
    // Enumeration order belongs to the explicit caller-supplied alternatives;
    // a failed variant prevents the entire transaction from committing.
    for (const variant of Object.keys(variants) as Variant[]) {
        prepared[variant] = prepareValidatedJson(req, operationId, status, variants[variant], context);
    }
    return Object.freeze(prepared);
}

/** Deliver a prepared commit receipt without another read, validation or serialization. */
export function sendPreparedJson(req: Request, res: Response, prepared: PreparedApiJsonResponse): void {
    // Only HTTP delivery remains fallible. An interrupted response cannot undo
    // the transaction and must not create a second command or identity check.
    privateResponse(req, res, prepared.locale);
    if (prepared.context) res.set('X-Surveyor-Context', prepared.context);
    res.status(prepared.status).type(prepared.mediaType).send(prepared.json);
}

/** Binary validation concerns declared transport and authorized byte ownership, not JSON string coercion. */
export function sendValidatedBinary<Operation extends ApiOperationId>(req: Request, res: Response, operationId: Operation,
    status: ApiSuccessStatus<NoInfer<Operation>>, bytes: Buffer): void {
    const operation = operationContract(operationId);
    if (!operation.successStatuses.includes(status) || operation.responseMediaTypes[String(status)] !== 'application/octet-stream') {
        throw new ApiProblem('INTERNAL_ERROR');
    }
    privateResponse(req, res);
    res.status(status).type('application/octet-stream').send(bytes);
}

/** Read an authorized stored reference within the caller's configured directory.
 * Feature admission precedes this helper; path/read failures reveal no filesystem details. */
export async function sendStoredApiBinary<Operation extends ApiOperationId>(req: Request, res: Response, operationId: Operation,
    status: ApiSuccessStatus<NoInfer<Operation>>, directory: string, storedPath: string): Promise<void> {
    // Preserve the existing application-relative confinement policy before I/O.
    const fullPath = resolveStoredFile(directory, storedPath);
    if (!fullPath) throw new ApiProblem('NOT_FOUND');

    let bytes: Buffer;
    try { bytes = await fs.readFile(fullPath); }
    catch { throw new ApiProblem('NOT_FOUND'); }
    sendValidatedBinary(req, res, operationId, status, bytes);
}

/** Reauthorization/projection occurs before this helper, including before a conditional 304. */
export function sendValidatedJson<Operation extends ApiOperationId, Status extends ApiSuccessStatus<NoInfer<Operation>>>(
    req: Request, res: Response, operationId: Operation, status: Status,
    data: ApiResponseBody<NoInfer<Operation>, NoInfer<Status>>, etag?: string): void {
    // Admit the declared status/media/payload before setting response metadata.
    const operation = jsonResponseContract(operationId, status, data);
    privateResponse(req, res);
    if (etag) {
        res.set('ETag', etag);
        // Only an exact listed tag on GET suppresses this already validated
        // representation; writes still receive their ordinary JSON receipt.
        if (req.method === 'GET' && req.get('If-None-Match')?.split(',').map(value => value.trim()).includes(etag)) {
            res.status(304).end();
            return;
        }
    }
    res.status(status).type(operation.responseMediaTypes[String(status)] ?? 'application/json').json(data);
}

/** Hash canonical machine data; translated labels do not change edit evidence. */
export function entityTag(scope: string, value: unknown): string {
    return `"${scope}-${createHash('sha256').update(JSON.stringify(value)).digest('base64url')}"`;
}

/**
 * Preserve profile and frontend-context comparison scopes without creating an
 * anonymous identity. Current grants remain mandatory for public baselines.
 */
export function comparisonActor(session: SessionLike): string | {context: string} | null {
    if (session.profile?.id) return session.profile.id;
    if ('context' in session && typeof session.context === 'string' && session.context) {
        return {context: session.context};
    }
    if (!session.auth?.user && !session.auth?.guest) return null;
    throw new ApiProblem('AUTH_REQUIRED');
}

/**
 * Bind hashed current values to an operation, resource and admitted actor. Public
 * projections also bind their available field set; tokens never grant authority.
 */
export function comparisonToken(scope: string, id: string, session: SessionLike, values: Record<string, unknown>): string {
    // Only field hashes leave the owner, never the underlying private values.
    const actor = comparisonActor(session);
    const context = entityTag(scope, {id, actor,
        ...(actor === null ? {fields: Object.keys(values).sort()} : {})});
    const fields = Object.fromEntries(Object.entries(values).map(([field, value]) => [field, entityTag('field', value)]));
    return `"edit-${Buffer.from(JSON.stringify({context, fields})).toString('base64url')}"`;
}

/**
 * Compare selected fields with the freshly authorized locked baseline. Missing
 * review is 428; malformed, foreign or changed evidence is 412. Other fields may
 * change independently without rejecting this sparse edit.
 */
export function requireFieldComparison(expected: string | undefined, current: string, fields: string[]): void {
    if (!expected) throw new ApiProblem('PRECONDITION_REQUIRED');

    /** Decode only the bounded generated envelope and its private hash shape. */
    function decode(token: string): {context: string; fields: Record<string, string>} | null {
        // Validate before allocating decoded bytes; request and response bounds
        // come from the same authored contract rather than a second limit.
        if (!contractValidator('FieldComparisonToken')(token)) return null;

        try {
            const value = JSON.parse(Buffer.from(token.slice(6, -1), 'base64url').toString('utf8')) as unknown;
            if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
            const data = value as {context?: unknown; fields?: unknown};
            if (typeof data.context !== 'string' || !data.fields || typeof data.fields !== 'object' || Array.isArray(data.fields)) return null;
            const hashes = data.fields as Record<string, unknown>;
            if (!Object.values(hashes).every(hash => typeof hash === 'string' && /^"field-[A-Za-z0-9_-]{43}"$/.test(hash))) return null;
            return {context: data.context, fields: hashes as Record<string, string>};
        } catch { return null; }
    }

    // Both tokens must describe this actor/resource and every submitted field.
    const baseline = decode(expected);
    const latest = decode(current);
    if (!baseline || !latest || baseline.context !== latest.context
        || fields.some(field => !Object.hasOwn(baseline.fields, field) || baseline.fields[field] !== latest.fields[field])) {
        throw new ApiProblem('PRECONDITION_FAILED');
    }
}

/** Complete-order commands require an exact strong token, unlike sparse field
 * commands that compare only their submitted hashes. Missing and stale differ. */
export function requireComparisonToken(expected: string | undefined, current: string): void {
    if (!expected) throw new ApiProblem('PRECONDITION_REQUIRED');
    if (expected !== current) throw new ApiProblem('PRECONDITION_FAILED');
}
