/**
 * Common test keywords for controller testing
 * These keywords provide reusable actions for testing controllers with mocked services
 */

/**
 * Setup a mock for a service function
 */
export function setupMock(mockFn: jest.Mock, returnValue?: any): void {
    if (returnValue !== undefined) {
        mockFn.mockResolvedValue(returnValue);
    }
}

/**
 * Setup multiple mocks at once
 */
export function setupMocks(mocks: Array<{ fn: jest.Mock; returnValue?: any }>): void {
    mocks.forEach(({ fn, returnValue }) => setupMock(fn, returnValue));
}

/**
 * Verify a mock was called with specific arguments
 */
export function verifyMockCall(mockFn: jest.Mock, ...args: any[]): void {
    expect(mockFn).toHaveBeenCalledWith(...args);
}

/**
 * Verify a mock was called N times
 */
export function verifyMockCallCount(mockFn: jest.Mock, times: number): void {
    expect(mockFn).toHaveBeenCalledTimes(times);
}

/**
 * Verify a mock was not called
 */
export function verifyMockNotCalled(mockFn: jest.Mock): void {
    expect(mockFn).not.toHaveBeenCalled();
}

/**
 * Verify a mock's Nth call with specific arguments
 */
export function verifyMockNthCall(mockFn: jest.Mock, callNumber: number, ...args: any[]): void {
    expect(mockFn).toHaveBeenNthCalledWith(callNumber, ...args);
}

/**
 * Clear all mocks before each test
 */
export function clearAllMocks(): void {
    jest.clearAllMocks();
}

/**
 * Test that a function throws a specific error type
 */
export async function expectToThrowError(
    fn: () => any | Promise<any>,
    errorType: any,
    errorMessage?: string | RegExp
): Promise<void> {
    if (errorMessage) {
        await expect(fn()).rejects.toThrow(errorType);
        await expect(fn()).rejects.toThrow(errorMessage);
    } else {
        await expect(fn()).rejects.toThrow(errorType);
    }
}

/**
 * Test that a synchronous function throws a specific error type
 */
export function expectSyncToThrowError(
    fn: () => any,
    errorType: any,
    errorMessage?: string | RegExp
): void {
    if (errorMessage) {
        expect(fn).toThrow(errorType);
        expect(fn).toThrow(errorMessage);
    } else {
        expect(fn).toThrow(errorType);
    }
}

/**
 * Verify the result matches expected value
 */
export function verifyResult(actual: any, expected: any): void {
    expect(actual).toEqual(expected);
}

/**
 * Verify the result contains expected properties
 */
export function verifyResultContains(actual: any, expected: any): void {
    expect(actual).toEqual(expect.objectContaining(expected));
}

/**
 * Verify an object has specific properties
 */
export function verifyHasProperties(obj: any, properties: string[]): void {
    properties.forEach(prop => {
        expect(obj).toHaveProperty(prop);
    });
}

/**
 * Verify an array has specific length
 */
export function verifyArrayLength(arr: any[], length: number): void {
    expect(arr).toHaveLength(length);
}

/**
 * Verify a value is truthy
 */
export function verifyTruthy(value: any): void {
    expect(value).toBeTruthy();
}

/**
 * Verify a value is falsy
 */
export function verifyFalsy(value: any): void {
    expect(value).toBeFalsy();
}

/**
 * Verify a value is null
 */
export function verifyNull(value: any): void {
    expect(value).toBeNull();
}

/**
 * Verify a value is undefined
 */
export function verifyUndefined(value: any): void {
    expect(value).toBeUndefined();
}

/**
 * Verify a value is defined (not undefined)
 */
export function verifyDefined(value: any): void {
    expect(value).toBeDefined();
}

/**
 * Create a standardized test case runner for data-driven tests
 */
export function runDataDrivenTests<T>(
    testCases: T[],
    testFn: (testCase: T) => void | Promise<void>
): void {
    testCases.forEach(testCase => {
        testFn(testCase);
    });
}

/**
 * Execute a controller function and return the result
 */
export async function executeControllerFunction<T>(
    fn: (...args: any[]) => Promise<T>,
    ...args: any[]
): Promise<T> {
    return await fn(...args);
}

/**
 * Execute a controller function and expect it to throw
 */
export async function executeAndExpectError(
    fn: (...args: any[]) => Promise<any>,
    errorType: any,
    ...args: any[]
): Promise<void> {
    await expect(fn(...args)).rejects.toThrow(errorType);
}

/**
 * Setup and execute a test with a controller function
 */
export async function testControllerFunction<T>(config: {
    fn: (...args: any[]) => Promise<T>;
    args: any[];
    mocks?: Array<{ fn: jest.Mock; returnValue?: any }>;
    expected?: T;
    verifyFn?: (result: T) => void;
}): Promise<T> {
    const { fn, args, mocks, expected, verifyFn } = config;

    // Setup mocks if provided
    if (mocks) {
        setupMocks(mocks);
    }

    // Execute function
    const result = await executeControllerFunction(fn, ...args);

    // Verify result if expected value provided
    if (expected !== undefined) {
        verifyResult(result, expected);
    }

    // Run custom verification if provided
    if (verifyFn) {
        verifyFn(result);
    }

    return result;
}
