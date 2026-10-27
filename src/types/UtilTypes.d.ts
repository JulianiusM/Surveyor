/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {FindOperator} from "typeorm";

export type IdInput = string | number;
export type Maybe<T> = T | null | undefined;
export type PartialRecord<K extends PropertyKey, T> = { [P in K]?: T };
export type UserKey = "user";
export type GuestKey = "guest";
export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };
export type UserOrGuestKey = UserKey | GuestKey;

/** Retained document parameter loaders preserve their existing resource shape. */
export type ResourceLoader = (id: any) => Promise<any | null>;

/** The existing image-swap owner receives this only after a locked write commits. */
export interface ImageSwapReceipt {
    previousImage: string | null | undefined;
}

/** Pure money inputs shared by materialized pool totals and allocation. */
export interface InvoiceCostInput {
    status: string;
    amount: string | number;
    correctedAmount?: string | number | null;
}

export interface InvoiceAdjustmentInput {
    amount: string | number;
    subtractFromPool: boolean;
}

export interface InvoiceCostTotals {
    invoiceTotal: number;
    openAmount: number;
    extraAmount: number;
    subtractiveAmount: number;
}

/** Features select eligible rows before applying shared counter arithmetic. */
export interface ListCounterItem {
    id: string;
    maxAssignees?: number | null;
    assignedCount: number;
}

export interface ListCounterAssignee {
    profileId?: string | null;
    name?: string;
}

export type RelationEntry<E, K extends keyof E & string> = {
    /** Name of the relation property on E (e.g., 'slot', 'plan', 'user', 'guest'). */
    key: K;
    /**
     * For WHERE:
     *   - undefined -> omit condition
     *   - null      -> relation IS NULL
     *   - id        -> relation.id = id
     * For CREATE:
     *   - undefined -> omit field
     *   - null      -> set relation to null
     *   - id        -> set relation to { id }
     */
    id: Maybe<IdInput>;
};

export type ColumnEntry<E, K extends keyof E & string, V = any> = {
    /** Name of the scalar (non-relation) column on E. */
    key: K;
    /**
     * For WHERE:
     *   - undefined -> omit condition
     *   - null      -> column IS NULL
     *   - value     -> column = value
     *   - FindOperator -> passthrough (e.g., In([...]), MoreThan(...))
     * For CREATE:
     *   - undefined -> omit field
     *   - null      -> set to null
     *   - value     -> set to value
     *   - FindOperator -> NOT allowed (throws)
     */
    value: Maybe<V | FindOperator<V>>;
};

// Discriminated union for "exactly one party relation"
export type DualParty<L extends string, R extends string> =
    | { kind: L; id: Maybe<IdInput> }
    | { kind: R; id: Maybe<IdInput> };

export type EntityType = "activity" | "drivers" | "packing" | "event" | "survey";
export type EntityItemType = "activitySlot" | "driversItem" | "packingItem" | "eventRegistration" | "surveyItem";
export type CombEntityType = EntityType | EntityItemType;

/** Generic storage admission runs before disk bytes without owning persistence. */
export type UploadFileAllocation = (request: import('express').Request, filePath: string) => Promise<void>;
