import type {Request, Response} from 'express';
import type {ApiOperationId} from '../../types/ApiTypes';
import {contractValidator, operationContract} from './contracts';
import {ApiProblem, requestLocale} from './problem';

/** Generated schemas are the structural authority; only transport decoding belongs here. */
export function validateApiInput(operationId: ApiOperationId, value: unknown): void {
    const schema = operationContract(operationId).requestSchema;
    if (!schema) throw new Error(`Operation has no request schema: ${operationId}`);
    const validator = contractValidator(schema);
    if (validator(value)) return;
    const problem = new ApiProblem('VALIDATION_FAILED');
    problem.fieldErrors = (validator.errors ?? []).slice(0, 20).map(error => ({
        pointer: error.instancePath,
        code: ['required', 'type', 'format'].includes(error.keyword) ? error.keyword as 'required' | 'type' | 'format'
            : error.keyword === 'additionalProperties' ? 'unknown' : 'invalid',
    }));
    throw problem;
}

export function validateOperationRequest(req: Request, operationId: ApiOperationId, normalizeBody?: (body: unknown) => unknown): void {
    const operation = operationContract(operationId);
    const header: Record<string, string> = {};
    for (const parameter of operation.parameters) {
        if (parameter.in !== 'header' || ['X-Surveyor-Context', 'X-CSRF-Token', 'If-Match'].includes(parameter.name)) continue;
        const value = req.get(parameter.name);
        if (value !== undefined) header[parameter.name] = value;
    }
    if (!contractValidator(operation.parametersValidator)({path: req.params, query: req.query, header})) throw new ApiProblem('VALIDATION_FAILED');
    if (operation.requestSchema) {
        if (!req.is(operation.requestMediaType ?? 'application/json')) throw new ApiProblem('UNSUPPORTED_MEDIA_TYPE');
        if (normalizeBody) req.body = normalizeBody(req.body as unknown);
        validateApiInput(operationId, req.body as unknown);
    } else if (Number(req.get('Content-Length') ?? 0) > 0 || req.get('Transfer-Encoding') || req.body !== undefined) {
        throw new ApiProblem('VALIDATION_FAILED');
    }
}

/** Reauthorization/projection occurs before this helper, including before a conditional 304. */
export function sendValidatedJson(req: Request, res: Response, operationId: ApiOperationId, status: number,
    data: unknown, etag?: string): void {
    const operation = operationContract(operationId);
    const schema = operation.responseSchemas[String(status)];
    if (!schema || !contractValidator(schema)(data)) throw new ApiProblem('INTERNAL_ERROR');
    res.set('Cache-Control', 'private, no-store').set('Content-Language', requestLocale(req))
        .vary('Cookie').vary('X-Surveyor-Context').vary('X-Surveyor-Locale');
    if (req.apiActor) res.set('X-Surveyor-Context', req.apiActor.context);
    if (etag) {
        res.set('ETag', etag);
        if (req.method === 'GET' && req.get('If-None-Match')?.split(',').map(value => value.trim()).includes(etag)) {
            res.status(304).end();
            return;
        }
    }
    res.status(status).type(operation.responseMediaTypes[String(status)] ?? 'application/json').json(data);
}
