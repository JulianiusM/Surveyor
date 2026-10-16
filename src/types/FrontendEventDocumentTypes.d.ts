import type {Request, Response} from 'express';
import type {components} from './api/v1';
import type {FrontendPilotBootstrap} from './FrontendPilotTypes';

/** Initial Event documents adopt the existing shell's read-only admission owner. */
export interface FrontendEventDocumentHooks {
    bootstrap: (req: Request) => Promise<FrontendPilotBootstrap>;
    applyPageEntry: (req: Request, res: Response, state: FrontendPilotBootstrap,
        entry: components['schemas']['PageEntryOutcome']) => Promise<boolean>;
}
