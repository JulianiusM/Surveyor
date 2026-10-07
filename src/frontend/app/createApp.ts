import {createSSRApp} from 'vue';
import {createMemoryHistory, createRouter, createWebHistory} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import type {FrontendPilotBootstrap} from '../../types/FrontendPilotTypes';
import {createPilotContext, pilotContextKey} from './context';
import App from './App.vue';
import PackingEntry from '../features/packing/PackingEntry.vue';
import IdentityPage from '../features/identity/IdentityPage.vue';
import PackingCreatePage from '../features/packing/PackingCreatePage.vue';
import PackingHome from '../features/packing/PackingHome.vue';
import HelpPage from '../features/help/HelpPage.vue';

/** Server and browser construct the same component tree with separate application-owned state. */
export function createPilotApp(bootstrap: FrontendPilotBootstrap, browser: boolean) {
    const context = createPilotContext(bootstrap, browser);
    const app = createSSRApp(App);
    const router = createRouter({
        history: browser ? createWebHistory() : createMemoryHistory(),
        routes: [
            {path: '/frontend-pilot', component: PackingHome},
            {path: '/frontend-pilot/packing/create', component: PackingCreatePage},
            {path: '/frontend-pilot/packing/:listId/duplicate', component: PackingCreatePage},
            {path: '/frontend-pilot/packing/:listId/guest', component: PackingEntry},
            {path: '/frontend-pilot/packing/:listId', component: PackingEntry},
            {path: '/frontend-pilot/users/login', component: IdentityPage, meta: {identityMode: 'login'}},
            {path: '/frontend-pilot/users/register', component: IdentityPage, meta: {identityMode: 'register'}},
            {path: '/frontend-pilot/users/forgot-password', component: IdentityPage, meta: {identityMode: 'forgot'}},
            {path: '/frontend-pilot/users/reset-password/:token', component: IdentityPage, meta: {identityMode: 'reset'}},
            {path: '/frontend-pilot/users/activate/:token', component: IdentityPage, meta: {identityMode: 'activate'}},
            {path: '/frontend-pilot/guest/:guestId/login/:token', component: IdentityPage, meta: {identityMode: 'guest-login'}},
            {path: '/frontend-pilot/help', component: HelpPage},
            {path: '/frontend-pilot/help/:doc', component: HelpPage},
        ],
        scrollBehavior(to, _from, saved) {
            if (saved) return saved;
            if (to.hash) return {el: to.hash};
            return {top: 0};
        },
    });
    app.provide(pilotContextKey, context);
    app.use(VueQueryPlugin, {queryClient: context.queryClient});
    app.use(router);
    return {app, router, context};
}
