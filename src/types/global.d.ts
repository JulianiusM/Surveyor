// src/types/global.d.ts
import type { ActivitySlot } from '../modules/database/entities/activity/ActivitySlot';
import type { PackingItem } from '../modules/database/entities/packing/PackingItem';
import type { PermBundle } from './PermissionTypes';

export {};

declare global {
    interface Window {
        Surveyor: {
            init?: () => void;
            // Add more functions/properties if needed
        };

        // Bootstrap types
        bootstrap?: {
            Modal: {
                getOrCreateInstance(element: HTMLElement): { show(): void; hide(): void };
                getInstance(element: HTMLElement): { show(): void; hide(): void } | null;
                new (element: HTMLElement): { show(): void; hide(): void };
            };
        };

        // Entity IDs from server
        PACK_LIST_ID?: string;
        ACT_PLAN_ID?: string;
        DRIVER_LIST_ID?: string;
        EVENT_ID?: string;

        // Prefilled data from server
        PREFILLED_ITEMS?: Partial<PackingItem>[];
        PREFILLED_SLOTS?: Record<string, Partial<ActivitySlot>[]>;

        // Serialized permissions bundle
        PERM_DATA?: string;
        PERMS?: PermBundle;

        // Survey creation combinations
        PREFILLED_COMBINATIONS?: { weekday: number; nth_week?: number }[];

    }
}
