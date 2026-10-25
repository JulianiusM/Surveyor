import type {RouteRecordRaw} from 'vue-router';
import {javascriptPage, guestPage} from './metadata';

// Views stay lazy so opening another domain does not enlarge the initial route.
const ActivityCreatePage = () => import('../features/activity/ActivityCreatePage.vue');
const activityCreatePage = javascriptPage({variant: 'activity-create', footer: 'full'});
const ActivityEntry = () => import('../features/activity/ActivityEntry.vue');
const activityPage = javascriptPage({variant: 'activity', rows: 2, columns: 7});

/** Activity paths keep specific creation, guest and workflow entries before resource parameters. */
export const activityRoutes: readonly RouteRecordRaw[] = [
    {path: '/activity/create', component: ActivityCreatePage, meta: activityCreatePage},
    {path: '/activity/:planId/duplicate', component: ActivityCreatePage, meta: activityCreatePage},
    {path: '/activity/:planId/guest', component: ActivityEntry, meta: guestPage},
    {path: '/activity/:planId', component: ActivityEntry, meta: {...activityPage, dynamicContent: true}},
];
