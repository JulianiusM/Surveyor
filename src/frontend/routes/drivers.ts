import type {RouteRecordRaw} from 'vue-router';
import {javascriptPage, guestPage} from './metadata';

// Views stay lazy so opening another domain does not enlarge the initial route.
const DriversCreatePage = () => import('../features/drivers/DriversCreatePage.vue');
const listCreatePage = javascriptPage({variant: 'list-create'});
const DriversEntry = () => import('../features/drivers/DriversEntry.vue');
const driversPage = javascriptPage({variant: 'list-detail', rows: 4, columns: 5});

/** Drivers paths keep specific creation, guest and workflow entries before resource parameters. */
export const driversRoutes: readonly RouteRecordRaw[] = [
    {path: '/drivers/create', component: DriversCreatePage, meta: listCreatePage},
    {path: '/drivers/:listId/duplicate', component: DriversCreatePage, meta: listCreatePage},
    {path: '/drivers/:listId/guest', component: DriversEntry, meta: guestPage},
    {path: '/drivers/:listId', component: DriversEntry, meta: {...driversPage, dynamicContent: true}},
];
