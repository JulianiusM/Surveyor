/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import type {EntityType} from './UtilTypes';
import type {EntityManager} from 'typeorm';
import type {ArchivePresentation, ArchiveTarget} from './ArchiveTypes';
import type {EntityBase} from './UserTypes';
import type {PermView, SessionLike} from './PermissionTypes';
import type {ListPersistenceType, ListRootRows, ListItemRows, ListAssignmentRows} from './ListPersistenceTypes';

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

/** Shared scalar root values, used by admitted projections and sparse changes. */
export interface BasicEntityPropertyValues {
    title?: string;
    description?: string | null;
}

export type BasicEntityPropertyField = keyof BasicEntityPropertyValues;
export type BasicEntityPropertyPatch = BasicEntityPropertyValues;

/** Locked mutation evidence describes the resulting root, never a later mutable page read. */
export interface EntityMutationOutcome {
    readonly root: ArchiveTarget;
    readonly changed: boolean;
}

/** Feature adapters prepare their own receipt on the shared mutation's connection before commit. */
export interface EntityMutationCompletion<Result> {
    prepare(manager: EntityManager, outcome: EntityMutationOutcome): Result | Promise<Result>;
}

/** Reassociation retains its existing postcommit archive presentation and navigation choice. */
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
/** Select the comparison resource separately from query/write references;
 * the shared token owner canonicalizes typed UUID components. */
export interface EntityDefaultReviewOptions {
    comparisonId?: string;
    prepareToken?: () => Promise<string>;
}

/** Select the comparison resource while preserving the feature's profile/review validation order. */
export interface EntityAdministratorReviewOptions {
    comparisonId?: string;
    reviewOrder?: 'profile-first' | 'review-first';
}

/** Matching list reads retain their feature's existing method-policy declarations. */
export type ListReadMethod = 'reorderItems' | 'editDescription' | 'managePermissions'
    | 'editHeader' | 'changeEvent' | 'duplicate';

/** Existing feature/DBAL operations used by the shared list read workflows.
 * The controller owns admission and projection; these callbacks retain concrete
 * rows, snapshot scope and the feature's read/write comparison-token owners. */
export interface ListReadOperations<Root extends EntityBase, Item extends {id: string; pos: number}, Description> {
    withSnapshot<Result>(id: string, read: (manager: EntityManager, root: Root | null) => Promise<Result>): Promise<Result>;
    requireRoot(root: Root | null): Root;
    requireProfile(session: SessionLike): string;
    mayPerform(permissions: PermView, method: ListReadMethod): boolean;
    descriptionBaseline(root: Root, session: SessionLike): Description;
    items(manager: EntityManager, id: string): Promise<Item[]>;
    orderToken(root: Root, items: Item[], session: SessionLike): string;
}

/** Feature differences consumed by matching item baselines and locked workflows.
 * Outer command admission/transactions and receipt timing remain with each feature. */
export interface ListItemCommandOperations<Type extends ListPersistenceType, Patch extends object, Values extends object> {
    readonly type: Type;
    mayEditField(permissions: PermView, field: keyof Patch): boolean;
    item(manager: EntityManager, id: string): Promise<ListItemRows[Type] | null>;
    projectItem(item: ListItemRows[Type], permissions: PermView): {values: Values; editableFields: (keyof Values & string)[]};
    itemToken(root: ListRootRows[Type], item: ListItemRows[Type], session: SessionLike, values: Values): string;
    applyPatch(itemId: string, fields: Patch, context: {kind: 'versioned'; manager: EntityManager; item: ListItemRows[Type]}): Promise<boolean>;
    capabilities(permissions: PermView): {removeItem: boolean; removeAssignments: boolean};
    deleteItem(itemId: string, manager: EntityManager): Promise<unknown>;
    mayPerform(permissions: PermView, method: 'reorderItems'): boolean;
    items(manager: EntityManager, id: string, lock: boolean): Promise<ListItemRows[Type][]>;
    orderToken(root: ListRootRows[Type], items: ListItemRows[Type][], session: SessionLike): string;
    reorder(id: string, order: {itemId: string; position: number}[], manager: EntityManager): Promise<unknown>;
    assignment(id: number, manager: EntityManager): Promise<ListAssignmentRows[Type] | null>;
    deleteAssignment(id: string, manager: EntityManager): Promise<unknown>;
}
