/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import type {EntityType} from './UtilTypes';
import type {EntityManager} from 'typeorm';
import type {ArchivePresentation, ArchiveTarget} from './ArchiveTypes';

/** Explicit edit surface; omitted values are never made available to unauthorized forms. */
export type EntityPropertyField = 'title' | 'description' | 'startDate' | 'endDate' | 'location'
    | 'bindingDeadline' | 'deadlineTz' | 'maxParticipants' | 'allowRegDateUpdatesAfterDeadline'
    | 'allowRegCancelationAfterDeadline' | 'requireDietaryInfo' | 'allowDietComment'
    | 'allowRegDietUpdateAfterDeadline';

export interface EntityPropertyPresentation {
    entityType: EntityType;
    id: string;
    updateUrl: string;
    eventUrl?: string;
    exportUrl?: string;
    exportLabel?: string;
    values: Partial<Record<EntityPropertyField, string | number | boolean | null>>;
    editableFields: EntityPropertyField[];
    canEditProperties: boolean;
    canLinkEvent: boolean;
    canEditHeader: boolean;
    canDuplicate: boolean;
    canDelete: boolean;
    canManagePermissions: boolean;
    /** Identity is needed for optimistic concurrency; labels require parent disclosure authority. */
    currentEvent: {id: string; title?: string; startDate?: string; endDate?: string; url?: string} | null;
}

export interface BasicEntityPropertyPatch {
    title?: string;
    description?: string | null;
}

/** Locked mutation evidence describes the resulting root, never a later mutable page read. */
export interface EntityMutationOutcome {
    readonly root: ArchiveTarget;
    readonly changed: boolean;
}

/** Feature adapters prepare their own receipt on the shared mutation's connection before commit. */
export interface EntityMutationCompletion<Result> {
    prepare(manager: EntityManager, outcome: EntityMutationOutcome): Result | Promise<Result>;
}

/** Native reassociation retains its existing postcommit archive presentation and navigation choice. */
export interface EntityEventChangeResult {
    archive: ArchivePresentation | undefined;
    redirectUrl: string | undefined;
    changed: boolean;
}

export interface EntityCommand {
    success(message: string, redirectUrl?: string): void;
    error(error: unknown): void;
}

export interface EntityCommandHost {
    begin(control: HTMLButtonElement): EntityCommand | null;
    reportError(control: Element, error: unknown): void;
}
