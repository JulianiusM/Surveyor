import type {RouteRecordRaw} from 'vue-router';
import {javascriptPage, guestPage} from './metadata';

// Views stay lazy so opening another domain does not enlarge the initial route.
const SurveyCreatePage = () => import('../features/surveys/SurveyCreatePage.vue');
const surveyCreatePage = javascriptPage({variant: 'survey-create'});
const SurveyEntry = () => import('../features/surveys/SurveyEntry.vue');
const surveyPage = javascriptPage({variant: 'survey', rows: 2, columns: 4});

/** Survey paths keep specific creation, guest and workflow entries before resource parameters. */
export const surveyRoutes: readonly RouteRecordRaw[] = [
    {path: '/survey/create', component: SurveyCreatePage, meta: surveyCreatePage},
    {path: '/survey/:surveyId/duplicate', component: SurveyCreatePage, meta: surveyCreatePage},
    {path: '/survey/:surveyId/guest', component: SurveyEntry, meta: guestPage},
    {path: '/survey/:surveyId', component: SurveyEntry, meta: {...surveyPage, dynamicContent: true}},
];
