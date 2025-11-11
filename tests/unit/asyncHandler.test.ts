import { asyncHandler, asyncParamHandler } from '../../src/modules/lib/asyncHandler';
import { asyncHandlerData, asyncParamHandlerData } from '../data/unit/asyncHandlerData';

const makeReq = () => ({}) as any;
const makeRes = () => ({}) as any;

describe('lib/asyncHandler', () => {
    describe('asyncHandler - Data Driven', () => {
        test.each(asyncHandlerData)('$description', async ({ error }) => {
            const h = asyncHandler(async () => {
                throw error;
            });
            const next = jest.fn();
            await h(makeReq(), makeRes(), next);
            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('asyncParamHandler - Data Driven', () => {
        test.each(asyncParamHandlerData)('$description', async ({ error, paramId }) => {
            const h = asyncParamHandler(async (_req, _res, _next, _id) => {
                throw error;
            });
            const next = jest.fn();
            await h(makeReq(), makeRes(), next, paramId);
            expect(next).toHaveBeenCalledWith(error);
        });
    });
});
