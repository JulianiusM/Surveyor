/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0.
 */

import type {ApiOperationId} from './ApiTransportTypes';
import type {components} from './api/v1';
import type {SessionLike} from './PermissionTypes';

export type EntityHeaderUploadOperation = Extract<ApiOperationId, `upload${string}Header`>;
export type EntityHeaderDeleteOperation = Extract<ApiOperationId, `delete${string}Header`>;
export type EntityHeaderMutationResult = components['schemas']['MutationResult'];

/** Captured transport values passed to the existing feature business operation. */
export interface EntityHeaderCommandInput {
    id: string;
    actor: SessionLike;
    file: Express.Multer.File | undefined;
    ifMatch: string | undefined;
}

/** Preserve each feature's existing receipt preparation boundary rather than
 * strengthening legacy writes or validating a prepared receipt after commit. */
export type EntityHeaderCommand = {
    receipt: 'after-write';
    execute(input: EntityHeaderCommandInput): Promise<EntityHeaderMutationResult>;
} | {
    receipt: 'controller';
    execute(input: EntityHeaderCommandInput, prepare: (result: EntityHeaderMutationResult) => void): Promise<unknown>;
} | {
    receipt: 'before-write';
    execute(input: EntityHeaderCommandInput): Promise<void>;
};

/** Route composition only: controllers retain owner/method grants, reviewed
 * comparisons, persistence and image-swap behavior. Callbacks receive the new
 * upload, never a request/response handler or the previously stored image path. */
export interface EntityHeaderUpdateConfig {
    parameter: 'listId' | 'eventId' | 'surveyId' | 'planId';
    uploadOperation: EntityHeaderUploadOperation;
    deleteOperation: EntityHeaderDeleteOperation;
    requireProfile: boolean;
    admitUpload(id: string, actor: SessionLike): Promise<unknown>;
    command: EntityHeaderCommand;
}
