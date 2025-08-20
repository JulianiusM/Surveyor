// src/types/global.d.ts
export {};

declare global {
    interface Window {
        Surveyor: {
            init: () => void;
            // Add more functions/properties if needed
        };
    }
}
