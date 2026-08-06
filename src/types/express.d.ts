import "express";
import type {TokenEndpointResponse} from "openid-client";
import type {EntityAdminAssignment} from "../modules/database/entities/permissions/EntityAdminAssignment";
import type {Guest} from "../modules/database/entities/user/Guest";
import type {Profile} from "../modules/database/entities/user/Profile";
import type {User} from "../modules/database/entities/user/User";
import type {Settings} from "../modules/settings";
import type {PermBundle, PermMetaBundle} from "./PermissionTypes";

declare module "express" {
    // Inject additional properties on express.Request
    interface Request {
        resource?: Record<string, any>;
        additional?: Record<string, any>[];
    }
}

declare module "express-serve-static-core" {
    interface Locals {
        data?: any,
        auth?: {
            user?: User | null,
            guest?: Guest | null,
        },
        profile?: Profile | null,
        version: string,
        settings?: Partial<Settings>,
        permData?: PermBundle,
        perms?: PermMetaBundle,
        admins?: EntityAdminAssignment[],
    }
}

declare module "express-session" {
    interface SessionData {
        auth: {
            user?: User | null;
            guest?: Guest | null;
        },
        profile?: Profile | null,
        tokens?: TokenEndpointResponse;
        oidc?: { code_verifier: string; state: string; nonce?: string };
    }
}

export {};