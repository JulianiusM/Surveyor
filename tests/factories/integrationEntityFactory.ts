import {randomUUID} from 'node:crypto';
import {ActivitySlot} from '../../src/modules/database/entities/activity/ActivitySlot';
import {DriversItem} from '../../src/modules/database/entities/drivers/DriversItem';
import {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {User} from '../../src/modules/database/entities/user/User';

let sequence = 0;

function nextSequence(): number {
    sequence += 1;
    return sequence;
}

export function createUserEntity(overrides: Partial<User> = {}): User {
    const suffix = nextSequence();
    return Object.assign(new User(), {
        username: `integration-user-${suffix}`,
        name: `Integration User ${suffix}`,
        email: `integration-${suffix}@example.com`,
        isActive: true,
        ...overrides,
    });
}

export function createProfileEntity(user: User, overrides: Partial<Profile> = {}): Profile {
    return Object.assign(new Profile(), {
        id: randomUUID(),
        name: user.name,
        type: 'user',
        user,
        ...overrides,
    });
}

export function createActivitySlotEntity(overrides: Partial<ActivitySlot> = {}): ActivitySlot {
    return Object.assign(new ActivitySlot(), {
        title: 'Breakfast setup',
        description: 'Prepare the dining hall',
        day: '2026-08-06',
        pos: 1,
        startTime: '08:00',
        endTime: '09:00',
        maxAssignees: 2,
        ...overrides,
    });
}

export function createPackingItemEntity(overrides: Partial<PackingItem> = {}): PackingItem {
    return Object.assign(new PackingItem(), {
        id: randomUUID(),
        title: 'Group tent',
        description: 'Shared sleeping tent',
        pos: 1,
        maxAssignees: 1,
        requiredByAll: false,
        ...overrides,
    });
}

export function createDriversItemEntity(overrides: Partial<DriversItem> = {}): DriversItem {
    return Object.assign(new DriversItem(), {
        id: randomUUID(),
        title: 'Airport pickup',
        description: 'Collect arriving participants',
        pos: 1,
        maxAssignees: 3,
        ...overrides,
    });
}
