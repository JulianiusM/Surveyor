import type {Request, Response} from 'express';
import type {components} from './api/v1';
import type {FrontendBootstrap} from './FrontendTypes';

/** Entity documents adopt the existing shell's read-only admission owner. */
export interface FrontendEntityDocumentHooks {
    bootstrap: (req: Request) => Promise<FrontendBootstrap>;
    applyPageEntry: (req: Request, res: Response, state: FrontendBootstrap,
        entry: components['schemas']['PageEntryOutcome']) => Promise<boolean>;
}
