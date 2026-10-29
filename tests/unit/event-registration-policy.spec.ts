import {describe, expect, it} from 'vitest';
import {createDeadlineBypassLink, eventCapacityReached} from '../../src/backend/modules/event/registration';
import type {Event} from '../../src/backend/modules/database/entities/event/Event';
import type {SessionLike} from '../../src/types/PermissionTypes';

describe('Event registration input policy', () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 32768, null, '2'])
        ('rejects unsupported Uses %j before allocating a link', async value => {
            const event = {id: 'de26dfbc-f86b-459f-9ffd-31c8459df652'} as Event;
            const session = {auth: {user: {id: 1}}} as SessionLike;
            await expect(createDeadlineBypassLink(event, {maxUses: value}, session)).rejects.toMatchObject({status: 400});
        });

    it('keeps absent capacity unlimited and zero or reached limits full', () => {
        expect(eventCapacityReached(null, 10)).toBe(false);
        expect(eventCapacityReached(undefined, 10)).toBe(false);
        expect(eventCapacityReached(0, 0)).toBe(true);
        expect(eventCapacityReached(1, 1)).toBe(true);
        expect(eventCapacityReached(2, 1)).toBe(false);
    });
});
