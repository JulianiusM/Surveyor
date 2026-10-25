import type {RouteRecordRaw} from 'vue-router';
// Common outcomes are already part of the application shell's entry bundle.
import CommonPage from '../features/common/CommonPage.vue';
import {usersRoutes} from './users';
import {surveyRoutes} from './survey';
import {packingRoutes} from './packing';
import {activityRoutes} from './activity';
import {driversRoutes} from './drivers';
import {eventRoutes} from './event';
import {helpRoutes} from './help';
import {guestsRoutes} from './guests';

const LandingPage = () => import('../features/common/LandingPage.vue');

/** Compose the same domain branches as Express. Feature modules own their
 * paths, lazy views and static metadata; unknown destinations are matched last. */
export const frontendRoutes: readonly RouteRecordRaw[] = [
    {path: '/', component: LandingPage},
    {path: '/message', component: CommonPage},
    ...usersRoutes,
    ...surveyRoutes,
    ...packingRoutes,
    ...activityRoutes,
    ...driversRoutes,
    ...eventRoutes,
    ...helpRoutes,
    ...guestsRoutes,
    {path: '/:pathMatch(.*)*', component: CommonPage},
];
