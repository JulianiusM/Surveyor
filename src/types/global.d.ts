// src/types/global.d.ts
export {};

declare global {
    interface Window {
        Surveyor: {
            init?: () => void;
            initTimezoneSelect?: (id: number, opts: any) => void;
            // Add more functions/properties if needed
        };
    }
}
