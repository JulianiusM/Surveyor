// src/types/express-session.d.ts
import "express-session";
import {User} from "../modules/database/entities/user/User";
import {Guest} from "../modules/database/entities/user/Guest";
import {TokenEndpointResponse} from "openid-client";

declare module "express-session" {
    interface SessionData {
        user?: User | null;
        guest?: Guest | null;
        tokens?: TokenEndpointResponse;
        oidc?: { code_verifier: string; state: string; nonce?: string };
    }
}
export {}; // ensure this file is treated as a module