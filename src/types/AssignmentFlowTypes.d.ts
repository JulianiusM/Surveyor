import type {ApiActor} from './ApiTypes';
import type {operations} from './api/v1';

/** The restored transport factory handles self membership only, never organizer role management. */
export type AssignmentOperation = 'assignPackingItem' | 'unassignPackingItem'
    | 'assignDriversItem' | 'unassignDriversItem' | 'setActivityAssignment';

/** Generated operation contracts remain the single owner of accepted bodies and returned data. */
export type AssignmentResult<Operation extends AssignmentOperation> =
    operations[Operation]['responses'][200]['content']['application/json'];
export type AssignmentBody<Operation extends AssignmentOperation> = operations[Operation] extends {
    requestBody: {content: {'application/json': infer Body}};
} ? Body : undefined;

/** Domain hooks receive admitted values, with no Express response or request lifecycle to duplicate. */
export interface AssignmentInput<Operation extends AssignmentOperation> {
    entityId: string;
    itemId: string;
    actor: ApiActor;
    body: AssignmentBody<Operation>;
}

/** Preserve the selected feature's established preparation boundary rather than strengthening its writes. */
export type AssignmentCommand<Operation extends AssignmentOperation> = {
    operation: Operation;
} & ({
    delivery: 'result';
    execute: (input: AssignmentInput<Operation>) => Promise<AssignmentResult<Operation>>;
} | {
    delivery: 'transaction';
    execute: (input: AssignmentInput<Operation>, prepare: (data: AssignmentResult<Operation>) => void) => Promise<unknown>;
} | {
    delivery: 'invariant';
    result: AssignmentResult<Operation>;
    execute: (input: AssignmentInput<Operation>) => Promise<unknown>;
});

/** Route identifiers and profile admission are transport configuration; controllers retain scoped authorization. */
export interface AssignmentRouteParameters {
    path: string;
    entityParameter: string;
    itemParameter: string;
    requireProfile: boolean;
}

/** List adapters use separate desired-membership methods on the same existing URL. */
export interface AssignmentRoutePair<Assign extends 'assignPackingItem' | 'assignDriversItem',
    Unassign extends 'unassignPackingItem' | 'unassignDriversItem'> extends AssignmentRouteParameters {
    assign: AssignmentCommand<Assign>;
    unassign: AssignmentCommand<Unassign>;
}

/** Activity's one existing command combines joining/leaving with optional named-role selection. */
export interface AssignmentRoleRoute extends AssignmentRouteParameters {
    command: AssignmentCommand<'setActivityAssignment'>;
}
