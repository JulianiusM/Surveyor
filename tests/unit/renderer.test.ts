export {}; // ensure this file is a module to avoid global var collisions

/**
 * Unit tests for the page/JSON response wrapper - Data Driven
 */
import { messageRenderingData, pageRenderingData, jsonResponseData, rawResponseData } from '../data/unit/rendererData';

const importModule = async () => (await import('../../src/modules/renderer')).default;

type MockRes = {
    render: jest.Mock<any, any>,
    header: jest.Mock<any, any>,
    end: jest.Mock<any, any>,
};

const makeRes = (): MockRes => ({
    render: jest.fn(),
    header: jest.fn(),
    end: jest.fn(),
});

describe('message rendering helpers - Data Driven', () => {
    test.each(messageRenderingData)('$description', async ({ method, args, expected }) => {
        const mod = await importModule();
        const res = makeRes();
        (mod as any)[method](res as any, ...args);
        expect(res.render).toHaveBeenCalledWith(expected.template, expected.params);
    });
});

describe('page rendering helpers - Data Driven', () => {
    test.each(pageRenderingData)('$description', async ({ method, args, expected }) => {
        const mod = await importModule();
        const res = makeRes();
        (mod as any)[method](res as any, ...args);
        expect(res.render).toHaveBeenCalledWith(expected.template, expected.params);
    });
});

describe('JSON response helpers - Data Driven', () => {
    function expectJson(res: MockRes, obj: any) {
        expect(res.header).toHaveBeenCalledWith('Content-Type', 'application/json');
        expect(res.end).toHaveBeenCalledTimes(1);
        const payload = res.end.mock.calls[0][0];
        expect(typeof payload).toBe('string');
        const parsed = JSON.parse(payload);
        expect(parsed).toEqual(obj);
    }

    test.each(jsonResponseData)('$description', async ({ method, args, expected }) => {
        const mod = await importModule();
        const res = makeRes();
        (mod as any)[method](res as any, ...args);
        expectJson(res, expected);
    });

    test.each(rawResponseData)('$description', async ({ method, args, expectedJson, expectedRaw, expectsHeader }) => {
        const mod = await importModule();
        const res = makeRes();
        (mod as any)[method](res as any, ...args);
        
        if (expectsHeader) {
            expect(res.header).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(res.end).toHaveBeenCalledTimes(1);
            expect(res.end.mock.calls[0][0]).toBe(expectedJson);
        } else {
            expect(res.header).not.toHaveBeenCalled();
            expect(res.end).toHaveBeenCalledWith(expectedRaw);
        }
    });
});
