<script setup lang="ts">
import type {components} from '../../../types/api/v1';
import type {FrontendListCreationSource} from '../../../types/FrontendListTypes';
import {usePilot} from '../../app/context';
import {driversKeys} from '../../app/queryKeys';
import {useDriversApi} from './api';
import EntityListCreation from '../../components/EntityListCreation.vue';

// Drivers adopts the matching root create/duplicate form and generated transport.
// Native duplication copies metadata/defaults only; every ride remains a separate
// offer by its own active profile on the resulting detail page.
const context = usePilot();
const api = useDriversApi(context);
const source: FrontendListCreationSource<components['schemas']['DriversDuplicate']> = {
    creationKey: driversKeys.creation, duplicateKey: driversKeys.duplicate, eventPicker: api.eventPicker,
    initialContext: context.bootstrap.driversCreateContext, initialSelectedEvent: context.bootstrap.driversSelectedEvent,
    initialDuplicate: context.bootstrap.driversDuplicate,
    createEntry: api.createEntry.bind(api), duplicate: api.duplicate.bind(api),
    destination: result => '/frontend-pilot/drivers/' + result.id,
    prepare: (values, image) => ({operation: scope => api.createDrivers(values, image, scope)}),
};
</script>

<template>
    <EntityListCreation icon="bi-car-front" heading="drivers.create" document-title="drivers.createDocumentTitle" header-label="drivers.headerOptional" not-found="drivers.notFound"
        created="drivers.created" leave-unknown="drivers.leaveUnknown" creation-unknown="drivers.creationUnknown" :source="source">
        <!-- The native form renders its empty table without ride-creation controls. -->
        <div class="mb-3"><table class="table table-dark"><tbody></tbody></table></div>
    </EntityListCreation>
</template>
