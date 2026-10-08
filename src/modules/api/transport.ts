import type {Request, Response} from 'express';
import type {ApiOperationId, ApiSuccessStatus, ApiResponseBody} from '../../types/ApiTransportTypes';
import {contractValidator, operationContract} from './contracts';
import {ApiProblem, requestLocale} from './problem';

/** Decode only the serialization subset declared in the contract; JSON request bodies stay untouched. */
function scalarParameter(value: unknown, type: unknown): unknown {
    if (typeof value !== 'string') throw new ApiProblem('VALIDATION_FAILED');
    if (type === 'boolean') {
        if (value !== 'true' && value !== 'false') throw new ApiProblem('VALIDATION_FAILED');
        return value === 'true';
    }
    if (type === 'integer' || type === 'number') {
        const pattern = type === 'integer' ? /^-?(?:0|[1-9]\d*)$/u : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
        const number = Number(value);
        if (!pattern.test(value) || !Number.isFinite(number) || type === 'integer' && !Number.isSafeInteger(number)) {
            throw new ApiProblem('VALIDATION_FAILED');
        }
        return number;
    }
    return value;
}

/** Repeated arrays are legal only for explicitly declared form/explode query parameters. */
export function decodeApiParameters(operationId: ApiOperationId, input: {path: object; query: object; header: object}) {
    const decoded: Record<string, Record<string, unknown>> = {path: {...input.path}, query: {...input.query}, header: {...input.header}};
    for (const parameter of operationContract(operationId).parameters) {
        const value = decoded[parameter.in]?.[parameter.name];
        if (value === undefined) continue;
        const schema = parameter.schema as {type?: string; items?: {type?: string}};
        if (schema.type === 'array') {
            if (parameter.in !== 'query' || parameter.explode === false) throw new ApiProblem('VALIDATION_FAILED');
            decoded.query![parameter.name] = (Array.isArray(value) ? value : [value]).map(entry => scalarParameter(entry, schema.items?.type));
        } else decoded[parameter.in]![parameter.name] = scalarParameter(value, schema.type);
    }
    return decoded;
}

/** Generated schemas are the structural authority; only transport decoding belongs here. */
export function validateApiInput(operationId: ApiOperationId, value: unknown): void {
    const schema = operationContract(operationId).requestSchema;
    if (!schema) throw new Error(`Operation has no request schema: ${operationId}`);
    const validator = contractValidator(schema);
    if (validator(value)) return;

    // Bound structural diagnostics and expose machine pointers, never schema internals
    // or user-supplied values. Localized presentation belongs to the problem adapter.
    const problem = new ApiProblem('VALIDATION_FAILED');
    problem.fieldErrors = (validator.errors ?? []).slice(0, 20).map(error => ({
        pointer: error.instancePath,
        code: ['required', 'type', 'format'].includes(error.keyword) ? error.keyword as 'required' | 'type' | 'format'
            : error.keyword === 'additionalProperties' ? 'unknown' : 'invalid',
    }));
    throw problem;
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
    if (!contractValidator(operation.parametersValidator)(parameters)) throw new ApiProblem('VALIDATION_FAILED');

    // Feature normalization runs only after media admission, preserving native
    // trim/empty-value semantics while retaining the generated structural contract.
    if (operation.requestSchema) {
        if (!req.is(operation.requestMediaType ?? 'application/json')) throw new ApiProblem('UNSUPPORTED_MEDIA_TYPE');
        if (normalizeBody) req.body = normalizeBody(req.body as unknown);
        validateApiInput(operationId, req.body as unknown);
    } else if (Number(req.get('Content-Length') ?? 0) > 0 || req.get('Transfer-Encoding') || req.body !== undefined) {
        throw new ApiProblem('VALIDATION_FAILED');
    }
}

/** All successful API representations share the same private cache and locale boundary. */
function privateResponse(req: Request, res: Response): void {
    res.set('Cache-Control', 'private, no-store').set('Content-Language', requestLocale(req))
        .vary('Cookie').vary('X-Surveyor-Context').vary('X-Surveyor-Locale');
    if (req.apiActor) res.set('X-Surveyor-Context', req.apiActor.context);
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

/** Plain text is a supported declared output, with the same generated scalar bounds as JSON. */
export function sendValidatedText<Operation extends ApiOperationId, Status extends ApiSuccessStatus<NoInfer<Operation>>>(
    req: Request, res: Response, operationId: Operation, status: Status, data: ApiResponseBody<NoInfer<Operation>, NoInfer<Status>>): void {
    const operation = operationContract(operationId);
    const schema = operation.responseSchemas[String(status)];
    if (operation.responseMediaTypes[String(status)] !== 'text/plain' || !schema || !contractValidator(schema)(data)) {
        throw new ApiProblem('INTERNAL_ERROR');
    }
    privateResponse(req, res);
    res.status(status).type('text/plain').send(data);
}

/** Reauthorization/projection occurs before this helper, including before a conditional 304. */
export function sendValidatedJson<Operation extends ApiOperationId, Status extends ApiSuccessStatus<NoInfer<Operation>>>(
    req: Request, res: Response, operationId: Operation, status: Status,
    data: ApiResponseBody<NoInfer<Operation>, NoInfer<Status>>, etag?: string): void {
    const operation = operationContract(operationId);
    const schema = operation.responseSchemas[String(status)];
    if (!schema || !contractValidator(schema)(data)) throw new ApiProblem('INTERNAL_ERROR');
    privateResponse(req, res);
    if (etag) {
        res.set('ETag', etag);
        if (req.method === 'GET' && req.get('If-None-Match')?.split(',').map(value => value.trim()).includes(etag)) {
            res.status(304).end();
            return;
        }
    }
    res.status(status).type(operation.responseMediaTypes[String(status)] ?? 'application/json').json(data);
}
