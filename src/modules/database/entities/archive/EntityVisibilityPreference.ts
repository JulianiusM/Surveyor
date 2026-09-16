/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import {Column, Entity, Index, Unique} from 'typeorm';
import type {EntityType} from '../../../../types/UtilTypes';
import {NumericProfileBase} from '../abstract/Base';

/**
 * One private overview override per profile and root. Absence means follow the
 * root's effective archival; explicit choices do not change shared archival or access.
 * The profile has a real FK and deletion cascade. The polymorphic root reference
 * cannot have a single FK, so normal domain deletion may leave an inert preference.
 * Overview queries discover existing roots first and only then apply their choices;
 * a retained row cannot create a card. New and duplicated roots receive new UUIDs.
 */
@Entity('entity_visibility_preferences')
@Unique('uk_entity_visibility_profile_target', ['profile', 'entityType', 'entityId'])
@Index('idx_entity_visibility_target', ['entityType', 'entityId'])
export class EntityVisibilityPreference extends NumericProfileBase {
    // Together these columns identify a root; the ID alone is not the lookup key.
    @Column('varchar', {name: 'entity_type', length: 32})
    entityType!: EntityType;

    @Column('char', {name: 'entity_id', length: 36})
    entityId!: string;

    // Store only overrides. Resetting to the default removes this profile's row,
    // allowing future archive/restore changes to determine placement automatically.
    @Column('simple-enum', {name: 'visibility', enum: ['HIDDEN', 'SHOWN']})
    visibility!: 'HIDDEN' | 'SHOWN';
}
