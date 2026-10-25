import type {RouteRecordRaw} from 'vue-router';
import {identityMessagePage, guestPage} from './metadata';

// Views stay lazy so opening another domain does not enlarge the initial route.
const IdentityPage = () => import('../features/identity/IdentityPage.vue');

/** Guest identity handles capability links and recovery through its shared identity view. */
export const guestsRoutes: readonly RouteRecordRaw[] = [
    {path: '/guest/:guestId/login/:token', component: IdentityPage, meta: {...identityMessagePage, identityMode: 'guest-login'}},
    {path: '/guest/recovery', component: IdentityPage, meta: {...guestPage, identityMode: 'recovery'}},
];
