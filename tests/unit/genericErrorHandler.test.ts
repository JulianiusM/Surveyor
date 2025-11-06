/**
 * Tests for the generic error handler. We mock the renderer module to observe calls.
 */
import {handleGenericError} from '../../src/middleware/genericErrorHandler';
import {APIError, ExpectedError, ValidationError} from '../../src/modules/lib/errors';
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
        app: {get: (_: string) => 'production'},
    };
    return res;
};

const makeReq = () => ({app: {get: (_: string) => 'production'}} as any);

describe('middleware/genericErrorHandler', () => {
    test('ExpectedError -> renderer.renderMessageData', () => {
        const err = new ExpectedError('bad form', 'error', 400, {x: 1});
        const req: any = makeReq();
        const res: any = makeRes();
        const next = jest.fn();

        handleGenericError(err as any, req, res, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect((renderer as any).renderMessageData).toHaveBeenCalled();
    });

    test('ValidationError -> renderer.renderWithErrorData', () => {
        const err = new ValidationError('form', '', {a: 1}) as any;
        err.status = 422;
        const req: any = makeReq();
        const res: any = makeRes();

        handleGenericError(err as any, req, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(422);
        expect((renderer as any).renderWithErrorData).toHaveBeenCalled();
    });

    test('APIError -> renderer.respondWithErrorDataJson', () => {
        const err = new APIError('nope', {x: 1}, 418);
        const req: any = makeReq();
        const res: any = makeRes();

        handleGenericError(err as any, req, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(418);
        expect((renderer as any).respondWithErrorDataJson).toHaveBeenCalled();
    });

    test('Unknown Error -> renderer.render', () => {
        const err = new Error('mystery');
        const req: any = makeReq();
        const res: any = makeRes();

        handleGenericError(err as any, req, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(500);
        expect((renderer as any).render).toHaveBeenCalledWith(res, 'error');
    });
});
