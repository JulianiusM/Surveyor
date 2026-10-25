import type {RouteRecordRaw} from 'vue-router';

// Views stay lazy so opening another domain does not enlarge the initial route.
const HelpPage = () => import('../features/help/HelpPage.vue');

/** Help reads the index/search query or an explicit article in the same view. */
export const helpRoutes: readonly RouteRecordRaw[] = [
    {path: '/help', component: HelpPage, meta: {helpPage: true}},
    {path: '/help/:doc', component: HelpPage, meta: {helpPage: true}},
];
