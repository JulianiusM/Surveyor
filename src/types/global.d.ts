// src/types/global.d.ts
export {};

declare global {
    interface Window {
        Surveyor: {
            init?: () => void;
            // Add more functions/properties if needed
        };
        
        // Bootstrap types
        bootstrap: {
            Modal: {
                getOrCreateInstance(element: HTMLElement): { show(): void; hide(): void };
                getInstance(element: HTMLElement): { show(): void; hide(): void } | null;
            };
        };
    }
}
