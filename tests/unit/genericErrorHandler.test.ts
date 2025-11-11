/**
 * Tests for the generic error handler. We mock the renderer module to observe calls.
 */
import { handleGenericError } from '../../src/middleware/genericErrorHandler';
import { errorHandlerData } from '../data/unit/genericErrorHandlerData';
import renderer from '../../src/modules/renderer'; // after mock

// Mock the renderer used by the middleware
jest.mock('../../src/modules/renderer', () => ({
    __esModule: true,
    default: {
        render: jest.fn(),
        renderMessageData: jest.fn(),
        renderWithErrorData: jest.fn(),
        respondWithErrorDataJson: jest.fn(),
    }
}));

const makeRes = () => {
    const res: any = {
        status: jest.fn().mockReturnThis(),
        header: jest.fn().mockReturnThis(),
        end: jest.fn().mockReturnThis(),
        locals: {},
        app: { get: (_: string) => 'production' },
    };
    return res;
};

const makeReq = () => ({ app: { get: (_: string) => 'production' } } as any);

describe('middleware/genericErrorHandler - Data Driven', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test.each(errorHandlerData)(
        '$description',
        ({ error, expectedStatus, expectedRendererMethod, expectedRenderArgs }) => {
            const req: any = makeReq();
            const res: any = makeRes();
            const next = jest.fn();

            handleGenericError(error as any, req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(expectedStatus);
            
            if (expectedRenderArgs) {
                expect((renderer as any)[expectedRendererMethod]).toHaveBeenCalledWith(res, ...expectedRenderArgs);
            } else {
                expect((renderer as any)[expectedRendererMethod]).toHaveBeenCalled();
            }
        }
    );
});
