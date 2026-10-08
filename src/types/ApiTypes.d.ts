import type {SessionLike} from './PermissionTypes';
import type {components, operations} from './api/v1';

/** Identity admitted once for a request. It is never replaced midway through a command. */
export interface ApiActor extends SessionLike {
    context: string;
}
export type ApiProblemCode = components['schemas']['Problem']['code'];
export type ApiProblemParameters<Code extends ApiProblemCode> = Extract<components['schemas']['Problem'], {code: Code}>['params'];
export type ApiProblemArguments = {
    [Code in ApiProblemCode]: {} extends ApiProblemParameters<Code>
        ? [code: Code, params?: ApiProblemParameters<Code>]
        : [code: Code, params: ApiProblemParameters<Code>]
}[ApiProblemCode];
