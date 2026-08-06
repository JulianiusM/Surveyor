import type {Entity, EntityBase} from '../../src/types/UserTypes';
import type {EntityType} from '../../src/types/UtilTypes';

export function createEntityBase(overrides: Partial<EntityBase> = {}): EntityBase {
    return {
        id: 'entity-1',
        title: 'Summer Camp',
        ownerId: 'owner-1',
        description: null,
        eventId: undefined,
        headerImg: null,
        ...overrides,
    };
}

export function createExpectedEntity(entityType: EntityType, overrides: Partial<EntityBase> = {}): Entity {
    const entity = createEntityBase(overrides);
    const url = `/${entityType}/${entity.id}`;

    return {
        id: entity.id,
        title: entity.title,
        ownerId: entity.ownerId,
        description: entity.description,
        eventId: entity.eventId,
        imageUrl: entity.headerImg ? `${url}/header` : undefined,
        type: entityType,
        url,
    };
}
