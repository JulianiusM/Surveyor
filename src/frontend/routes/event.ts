import type {RouteRecordRaw} from 'vue-router';
import {javascriptPage, guestPage} from './metadata';

// Views stay lazy so opening another domain does not enlarge the initial route.
const EventCreatePage = () => import('../features/event/EventCreatePage.vue');
const eventCreatePage = javascriptPage({variant: 'event-create'});
const EventEntry = () => import('../features/event/EventEntry.vue');
const eventAdminPage = javascriptPage({variant: 'event-admin'});
const eventPage = javascriptPage({variant: 'event'});

/** Event paths keep specific creation, guest and workflow entries before resource parameters. */
export const eventRoutes: readonly RouteRecordRaw[] = [
    {path: '/event/create', component: EventCreatePage, meta: eventCreatePage},
    {path: '/event/:eventId/duplicate', component: EventCreatePage, meta: eventCreatePage},
    {path: '/event/:eventId/guest', component: EventEntry, meta: guestPage},
    {path: '/event/:eventId/admin', component: EventEntry, meta: {...eventAdminPage, dynamicContent: true}},
    {path: '/event/:eventId', component: EventEntry, meta: {...eventPage, dynamicContent: true}},
];
