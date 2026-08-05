import {expect} from 'vitest';
import {APIError, ExpectedError, ValidationError} from '../../src/modules/lib/errors';

export async function expectValidationFailure(action: () => unknown | Promise<unknown>): Promise<void> {
    await expect(async () => action()).rejects.toBeInstanceOf(ValidationError);
}

export async function expectApiFailure(action: () => unknown | Promise<unknown>, status?: number): Promise<void> {
    if (status) {
        await expect(async () => action()).rejects.toMatchObject({status});
        return;
    }
    await expect(async () => action()).rejects.toBeInstanceOf(APIError);
}

export async function expectExpectedFailure(action: () => unknown | Promise<unknown>, status?: number): Promise<void> {
    if (status) {
        await expect(async () => action()).rejects.toMatchObject({status});
        return;
    }
    await expect(async () => action()).rejects.toBeInstanceOf(ExpectedError);
}
