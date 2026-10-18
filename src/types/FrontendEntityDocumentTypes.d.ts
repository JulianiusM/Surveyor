import type {Request, Response} from 'express';
import type {components} from './api/v1';
import type {FrontendPilotBootstrap} from './FrontendPilotTypes';

/** Migrated entity documents adopt the existing shell's read-only admission owner. */
export interface FrontendEntityDocumentHooks {
    bootstrap: (req: Request) => Promise<FrontendPilotBootstrap>;
    applyPageEntry: (req: Request, res: Response, state: FrontendPilotBootstrap,
        entry: components['schemas']['PageEntryOutcome']) => Promise<boolean>;
}
