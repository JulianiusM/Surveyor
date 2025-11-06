import "express";

declare module "express" {
    // Inject additional properties on express.Request
    interface Request {
        resource?: Record<string, any>;
        additional?: Record<string, any>[];
    }
}

export {};