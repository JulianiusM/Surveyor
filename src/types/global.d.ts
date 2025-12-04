// src/types/global.d.ts
import type { ActivitySlot } from '../modules/database/entities/activity/ActivitySlot';

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
            };
        };
        
        // Entity IDs from server
        PACK_LIST_ID?: number;
        ACT_PLAN_ID?: number;
        DRIVER_LIST_ID?: number;
        EVENT_ID?: number;

        // Prefilled data from server
        PREFILLED_ITEMS?: any;
        PREFILLED_SLOTS?: Record<string, Partial<ActivitySlot>[]>;
        
    }
}
