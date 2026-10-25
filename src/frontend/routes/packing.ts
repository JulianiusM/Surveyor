import type {RouteRecordRaw} from 'vue-router';
import {javascriptPage, guestPage} from './metadata';

// Views stay lazy so opening another domain does not enlarge the initial route.
const PackingCreatePage = () => import('../features/packing/PackingCreatePage.vue');
const packingCreatePage = javascriptPage({variant: 'packing-create'});
const PackingEntry = () => import('../features/packing/PackingEntry.vue');
const packingPage = javascriptPage({variant: 'list-detail', rows: 4, columns: 6});

/** Packing paths keep specific creation, guest and workflow entries before resource parameters. */
export const packingRoutes: readonly RouteRecordRaw[] = [
    {path: '/packing/create', component: PackingCreatePage, meta: packingCreatePage},
    {path: '/packing/:listId/duplicate', component: PackingCreatePage, meta: packingCreatePage},
    {path: '/packing/:listId/guest', component: PackingEntry, meta: guestPage},
    {path: '/packing/:listId', component: PackingEntry, meta: {...packingPage, dynamicContent: true}},
];
