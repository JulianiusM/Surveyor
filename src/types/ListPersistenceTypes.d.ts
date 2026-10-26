import type {PackingList} from '../backend/modules/database/entities/packing/PackingList';
import type {PackingItem} from '../backend/modules/database/entities/packing/PackingItem';
import type {PackingAssignment} from '../backend/modules/database/entities/packing/PackingAssignment';
import type {DriversList} from '../backend/modules/database/entities/drivers/DriversList';
import type {DriversItem} from '../backend/modules/database/entities/drivers/DriversItem';
import type {DriversAssignment} from '../backend/modules/database/entities/drivers/DriversAssignment';

/** Select concrete persisted list rows while keeping repository targets private to DBAL. */
export type ListPersistenceType = 'packing' | 'drivers';
export interface ListRootRows {packing: PackingList; drivers: DriversList}
export interface ListItemRows {packing: PackingItem; drivers: DriversItem}
export interface ListAssignmentRows {packing: PackingAssignment; drivers: DriversAssignment}
