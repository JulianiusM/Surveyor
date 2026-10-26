import type {operations} from './api/v1';

export type ApiOperationId = keyof operations;

/** The operation and status select the only legal wire shape; callers cannot widen them from data. */
export type ApiSuccessStatus<Operation extends ApiOperationId> = Extract<keyof operations[Operation]['responses'],
    200 | 201 | 202 | 204 | 206>;
export type ApiResponseBody<Operation extends ApiOperationId, Status extends ApiSuccessStatus<Operation>> =
    operations[Operation]['responses'][Status] extends {content: infer Content}
        ? Content[keyof Content] : never;

/** Prepare one declared adapter response before its controller's transaction commits. */
export type ApiResponsePreparer<Operation extends ApiOperationId, Status extends ApiSuccessStatus<Operation>, Result> =
    (data: ApiResponseBody<Operation, Status>) => Result | Promise<Result>;

/** Validated and serialized before a transaction commits; sending this receipt performs no new projection. */
export interface PreparedApiJsonResponse {
    readonly status: number;
    readonly mediaType: string;
    readonly locale: string;
    readonly context?: string;
    readonly json: string;
}

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

export interface ApiProblemContract {code: string; status: number; messageKey: string; paramsSchema: unknown;
    /** Authored compatibility for trusted controller APIError causes only. */
    controllerStatusOverride?: true;
}
export interface ApiContractManifest {sourceHash: string; apiCompatibility: string; operations: ApiOperationContract[]; problems: ApiProblemContract[];}
