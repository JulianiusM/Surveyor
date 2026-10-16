import type {Request, Response} from 'express';
import type {components} from './api/v1';
import type {FrontendPilotBootstrap} from './FrontendPilotTypes';

/** Event documents adopt the existing shell's admission and one-time feedback owners. */
export interface FrontendEventDocumentHooks {
    bootstrap: (req: Request) => Promise<FrontendPilotBootstrap>;
    applyPageEntry: (req: Request, res: Response, state: FrontendPilotBootstrap,
        entry: components['schemas']['PageEntryOutcome']) => Promise<boolean>;
    flashNotice: (req: Request, notice: components['schemas']['EntryNotice']) => void;
    persistFeedback: (req: Request) => Promise<void>;
}
