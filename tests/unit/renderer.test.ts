export {}; // ensure this file is a module to avoid global var collisions

/**
 * Unit tests for the page/JSON response wrapper.
 * Adjust the import path below to the actual file location.
 * Example assumes: src/modules/renderer.ts
 */
// IMPORTANT: update this path to match your repo structure
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

describe('message rendering helpers', () => {
    test('renderError uses "message" page with error status and message only', async () => {
        const mod = await importModule();
        const res = makeRes();
        mod.renderError(res as any, 'Oops');
        expect(res.render).toHaveBeenCalledWith('message', {status: 'error', message: 'Oops', data: undefined});
    });

    test('renderInfoData uses "message" page with info status and passes data', async () => {
        const mod = await importModule();
        const res = makeRes();
        const data = {a: 1};
        mod.renderInfoData(res as any, 'Heads up', data);
        expect(res.render).toHaveBeenCalledWith('message', {status: 'info', message: 'Heads up', data});
    });

    test('renderSuccess defaults data to undefined', async () => {
        const mod = await importModule();
        const res = makeRes();
        mod.renderSuccess(res as any, 'All good');
        expect(res.render).toHaveBeenCalledWith('message', {status: 'success', message: 'All good', data: undefined});
    });

    test('renderMessage forwards arbitrary status', async () => {
        const mod = await importModule();
        const res = makeRes();
        mod.renderMessage(res as any, 'success', 'Yay');
        expect(res.render).toHaveBeenCalledWith('message', {status: 'success', message: 'Yay', data: undefined});
    });
});

describe('page rendering helpers', () => {
    test('render(page) renders with all fields undefined', async () => {
        const mod = await importModule();
        const res = makeRes();
        mod.render(res as any, 'dashboard');
        expect(res.render).toHaveBeenCalledWith('dashboard', {
            status: undefined, message: undefined, data: undefined,
        });
    });

    test('renderWithErrorData renders given page with error status and data', async () => {
        const mod = await importModule();
        const res = makeRes();
        const data = {retry: true};
        mod.renderWithErrorData(res as any, 'login', 'Bad creds', data);
        expect(res.render).toHaveBeenCalledWith('login', {status: 'error', message: 'Bad creds', data});
    });

    test('renderWithInfo renders given page with info status and no data', async () => {
        const mod = await importModule();
        const res = makeRes();
        mod.renderWithInfo(res as any, 'profile', 'Updated');
        expect(res.render).toHaveBeenCalledWith('profile', {status: 'info', message: 'Updated', data: undefined});
    });

    test('renderWithSuccessData renders with success status and provided data', async () => {
        const mod = await importModule();
        const res = makeRes();
        const data = {id: 5};
        mod.renderWithSuccessData(res as any, 'done', 'OK', data);
        expect(res.render).toHaveBeenCalledWith('done', {status: 'success', message: 'OK', data});
    });

    test('renderWithMessage renders with provided status/message and undefined data', async () => {
        const mod = await importModule();
        const res = makeRes();
        mod.renderWithMessage(res as any, 'pageX', 'success', 'Alright');
        expect(res.render).toHaveBeenCalledWith('pageX', {status: 'success', message: 'Alright', data: undefined});
    });

    test('renderWithData renders with data only (status/message undefined)', async () => {
        const mod = await importModule();
        const res = makeRes();
        const data = {x: 1};
        mod.renderWithData(res as any, 'pageY', data);
        expect(res.render).toHaveBeenCalledWith('pageY', {status: undefined, message: undefined, data});
    });
});

describe('JSON response helpers', () => {
    function expectJson(res: MockRes, obj: any) {
        expect(res.header).toHaveBeenCalledWith('Content-Type', 'application/json');
        expect(res.end).toHaveBeenCalledTimes(1);
        const payload = res.end.mock.calls[0][0];
        expect(typeof payload).toBe('string');
        const parsed = JSON.parse(payload);
        expect(parsed).toEqual(obj);
    }

    test('respondWithErrorJson sends structured error JSON with null data', async () => {
        const mod = await importModule();
        const res = makeRes();
        mod.respondWithErrorJson(res as any, 'Nope');
        expectJson(res, {status: 'error', message: 'Nope', data: null});
    });

    test('respondWithInfoDataJson sends structured info JSON with data', async () => {
        const mod = await importModule();
        const res = makeRes();
        const data = {hint: 'try again'};
        mod.respondWithInfoDataJson(res as any, 'Heads', data);
        expectJson(res, {status: 'info', message: 'Heads', data});
    });

    test('respondWithSuccessJson sends success JSON with null data', async () => {
        const mod = await importModule();
        const res = makeRes();
        mod.respondWithSuccessJson(res as any, 'OK');
        expectJson(res, {status: 'success', message: 'OK', data: null});
    });

    test('respondStructuredJson uses respondWithJson under the hood', async () => {
        const mod = await importModule();
        const res = makeRes();
        mod.respondStructuredJson(res as any, 'success', 'Fine', {a: 1});
        expectJson(res, {status: 'success', message: 'Fine', data: {a: 1}});
    });

    test('respondWithJson sets header and ends with raw JSON string', async () => {
        const mod = await importModule();
        const res = makeRes();
        const obj = {a: 1};
        mod.respondWithJson(res as any, obj);
        expect(res.header).toHaveBeenCalledWith('Content-Type', 'application/json');
        expect(res.end).toHaveBeenCalledTimes(1);
        expect(res.end.mock.calls[0][0]).toBe(JSON.stringify(obj));
    });

    test('respond sends raw payload and does not set header', async () => {
        const mod = await importModule();
        const res = makeRes();
        mod.respond(res as any, 'raw');
        expect(res.header).not.toHaveBeenCalled();
        expect(res.end).toHaveBeenCalledWith('raw');
    });
});
