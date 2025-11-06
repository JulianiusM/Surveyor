import {asyncHandler, asyncParamHandler} from '../../src/modules/lib/asyncHandler';

const makeReq = () => ({}) as any;
const makeRes = () => ({}) as any;

describe('lib/asyncHandler', () => {
    test('asyncHandler forwards thrown error to next', async () => {
        const boom = new Error('boom');
        const h = asyncHandler(async () => {
            throw boom;
        });
        const next = jest.fn();
        await h(makeReq(), makeRes(), next);
        expect(next).toHaveBeenCalledWith(boom);
    });

    test('asyncParamHandler forwards thrown error to next', async () => {
        const boom = new Error('boom2');
        const h = asyncParamHandler(async (_req, _res, _next, _id) => {
            throw boom;
        });
        const next = jest.fn();
        await h(makeReq(), makeRes(), next, 123);
        expect(next).toHaveBeenCalledWith(boom);
    });
});
