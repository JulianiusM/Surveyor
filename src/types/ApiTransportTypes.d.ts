import type {operations} from './api/v1';

export type ApiOperationId = keyof operations;

/** The operation and status select the only legal wire shape; callers cannot widen them from data. */
export type ApiSuccessStatus<Operation extends ApiOperationId> = Extract<keyof operations[Operation]['responses'],
    200 | 201 | 202 | 204 | 206>;
export type ApiResponseBody<Operation extends ApiOperationId, Status extends ApiSuccessStatus<Operation>> =
    operations[Operation]['responses'][Status] extends {content: infer Content}
        ? Content[keyof Content] : never;

export interface ApiOperationContract {
    operationId: ApiOperationId;
    method: string;
    path: string;
    parameters: Array<{in: string; name: string; required?: boolean; explode?: boolean; schema: unknown}>;
    parametersValidator: string;
    requestSchema: string | null;
    requestMediaType: 'application/json' | 'multipart/form-data' | null;
    responseSchemas: Record<string, string | null>;
    responseMediaTypes: Record<string, string>;
    successStatuses: number[];
    policy: {retryPolicy: 'read' | 'natural-idempotent' | 'reconcile-only'; precondition: 'none' | 'metadata' | 'item' | 'order' | 'settings'};
}

export interface ApiProblemContract {code: string; status: number; messageKey: string; paramsSchema: unknown;}
export interface ApiContractManifest {sourceHash: string; apiCompatibility: string; operations: ApiOperationContract[]; problems: ApiProblemContract[];}
