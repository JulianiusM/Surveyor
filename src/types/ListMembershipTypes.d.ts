import type {EntityManager} from 'typeorm';
import type {ListPersistenceType, ListItemRows, ListAssignmentRows} from './ListPersistenceTypes';

/** The existing DBAL lock owner supplies one current membership/capacity snapshot. */
export interface ListMembershipSnapshot<Type extends ListPersistenceType> {
    manager: EntityManager;
    item: ListItemRows[Type];
    existing: ListAssignmentRows[Type] | null;
    count: number;
}
