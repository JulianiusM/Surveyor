import * as userService from "../modules/database/services/UserService";

export type OidcClaims = {
    sub: string;
    email?: string;
    email_verified?: boolean;
    preferred_username?: string;
    name?: string;
    // add whatever custom claims you mapped in authentik (e.g., groups)
    groups?: string[];
};

export type GuestFlowConfig = {
    entityType: string,
    addToEvent: boolean,
    db: Partial<GuestFlowDb>,
    templates: { create: string, view: string },
    buildRedirect: (id: any) => string,
    preprocessCreate: (body: any) => any,
    createEntity: (ownerId: number, data: any) => Promise<any>,
    afterCreateItems: (id: any, data: any) => Promise<void>,
    fetchForView: (entity: any, session: Request['session']) => Promise<any | null>,
    fetchForDuplicate: (entity: any, session: Request['session']) => Promise<any | null>,
    deleteEntity: (entity: any, session: Request['session']) => Promise<any>,
};

export type GuestFlowDb = {
    getById: (id: any) => Promise<any | null>,
    registerGuest: typeof userService.registerGuest,
    getGuestInternal: typeof userService.getGuestInternal,
    getGuestByToken: typeof userService.getGuestByToken,
    getGuestLinkToken: typeof userService.getGuestLinkToken,
    createGuestLink: typeof userService.createGuestLink,
};