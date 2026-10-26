import type {RouteRecordRaw} from 'vue-router';
import {javascriptPage, identityMessagePage} from './metadata';
import {frontendOverviewPath} from '../../common/lib/frontendIdentity';

// Views stay lazy so opening another domain does not enlarge the initial route.
const OverviewPage = () => import('../features/overview/OverviewPage.vue');
const overviewPage = javascriptPage({variant: 'overview'});
const ProfileAdministrationPage = () => import('../features/identity/ProfileAdministrationPage.vue');
const profilePage = javascriptPage({variant: 'profile', rows: 1, balancedHeader: true, headerActions: true});
const profileRosterPage = javascriptPage({variant: 'roster', rows: 3, balancedHeader: true, headerActions: true});
const profileCreatePage = javascriptPage({variant: 'profile', rows: 1, balancedHeader: true});
const ProfileWorkflowPage = () => import('../features/identity/ProfileWorkflowPage.vue');
const workflowPage = javascriptPage({variant: 'workflow', balancedHeader: true, headerActions: true});
const IdentityPage = () => import('../features/identity/IdentityPage.vue');
const loginPage = javascriptPage({variant: 'login', rows: 2});
const registerPage = javascriptPage({variant: 'identity', rows: 5});
const forgotPage = javascriptPage({variant: 'identity', rows: 1, footer: 'full'});
const resetPage = javascriptPage({variant: 'identity', rows: 2, footer: 'full'});

/** Account and profile entries retain their explicit workflow and identity modes. */
export const usersRoutes: readonly RouteRecordRaw[] = [
    {path: frontendOverviewPath, component: OverviewPage, meta: {...overviewPage, dynamicContent: true}},
    {path: '/users/profile', component: ProfileAdministrationPage, meta: {...profilePage, profileMode: 'edit'}},
    {path: '/users/profile/manage', component: ProfileAdministrationPage, meta: {...profileRosterPage, profileMode: 'manage'}},
    {path: '/users/profile/create', component: ProfileAdministrationPage, meta: {...profileCreatePage, profileMode: 'create'}},
    {path: '/users/profile/migrate/request', component: ProfileWorkflowPage, meta: {...workflowPage, profileWorkflow: 'token'}},
    {path: '/users/profile/migrate/show', component: ProfileWorkflowPage,
        meta: {...workflowPage, profileWorkflow: 'entry', profilePreviewHash: '#migration-preview'}},
    {path: '/users/profile/delete', component: ProfileWorkflowPage, meta: {...workflowPage, profileWorkflow: 'deactivate'}},
    {path: '/users/account/delete', component: ProfileWorkflowPage, meta: {...workflowPage, profileWorkflow: 'delete-account'}},
    {path: '/users/login', component: IdentityPage, meta: {...loginPage, identityMode: 'login'}},
    {path: '/users/register', component: IdentityPage, meta: {...registerPage, identityMode: 'register'}},
    {path: '/users/oidc/login', component: IdentityPage, meta: {...identityMessagePage, identityMode: 'oidc'}},
    {path: '/users/forgot-password', component: IdentityPage, meta: {...forgotPage, identityMode: 'forgot'}},
    {path: '/users/reset-password/:token', component: IdentityPage, meta: {...resetPage, identityMode: 'reset'}},
    {path: '/users/activate/:token', component: IdentityPage, meta: {...identityMessagePage, identityMode: 'activate'}},
];
