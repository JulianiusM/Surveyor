<script setup lang="ts">
import {computed} from 'vue';
import {RouterLink, useRoute} from 'vue-router';
import type {FrontendLandingQuickCreate} from '../../../types/FrontendPilotTypes';
import {usePilot} from '../../app/context';
import {usePageTitle} from '../../composables/pageTitle';

const context = usePilot();
const {messages, session} = context;
const route = useRoute();

const initialDocument = context.initialDocumentFor(route.fullPath);
const quickCreateTypes = ['survey', 'event', 'activity', 'packing', 'drivers'] as const;
// The admitted document captures its random suggestion before SSR. Hydration reuses
// that value; a later client visit chooses once without changing on locale/refresh.
const quickCreate = initialDocument?.landing?.quickCreate
    ?? (initialDocument || !context.browser ? 'survey' : chooseQuickCreate());
const creationTargets = {
    survey: {url: '/survey/create', icon: 'bi-bar-chart-steps'},
    event: {url: '/frontend-pilot/event/create', icon: 'bi-calendar-event'},
    activity: {url: '/activity/create', icon: 'bi-clock-history'},
    packing: {url: '/frontend-pilot/packing/create', icon: 'bi-bag-fill'},
    drivers: {url: '/drivers/create', icon: 'bi-car-front-fill'},
} as const;
const quickTarget = creationTargets[quickCreate];

const loginUrl = computed(() => '/frontend-pilot/users/login?next=' + encodeURIComponent(route.fullPath));
const registerUrl = computed(() => '/frontend-pilot/users/register?next=' + encodeURIComponent(route.fullPath));
const signedInPoints = ['landing.signedOverview', 'landing.signedCreate', 'landing.signedPacking', 'landing.signedRights'] as const;
const publicPoints = ['landing.plan', 'landing.share', 'landing.link', 'landing.dashboard'] as const;
// Account/guest admission changes the copy and actions, not the welcome layout.
// Keep the repeated list in one feature-owned presentation without copying state.
const welcomePoints = computed(() => session.value?.activeProfile ? signedInPoints : publicPoints);
const welcomeText = computed(() => session.value?.activeProfile
    ? messages.value.t('landing.welcome', {name: session.value.activeProfile.name}) : messages.value.t('landing.intro'));

// Preserve the native three-card/two-card rows. This is static feature copy, not a
// permission or route registry; unfinished creation journeys stay ordinary links.
const featureRows = [
    {classes: 'row row-cols-1 row-cols-md-2 row-cols-xl-3 g-4 mb-4', features: [
        {type: 'survey', points: [
            'landing.features.survey.point1',
            'landing.features.survey.point2',
            'landing.features.survey.point3',
            'landing.features.survey.point4',
        ]},
        {type: 'event', points: [
            'landing.features.event.point1',
            'landing.features.event.point2',
            'landing.features.event.point3',
            'landing.features.event.point4',
            'landing.features.event.point5',
        ]},
        {type: 'packing', points: [
            'landing.features.packing.point1',
            'landing.features.packing.point2',
            'landing.features.packing.point3',
            'landing.features.packing.point4',
        ]},
    ]},
    {classes: 'row row-cols-1 row-cols-md-2 g-4 mb-4', features: [
        {type: 'activity', points: [
            'landing.features.activity.point1',
            'landing.features.activity.point2',
            'landing.features.activity.point3',
            'landing.features.activity.point4',
            'landing.features.activity.point5',
            'landing.features.activity.point6',
        ]},
        {type: 'drivers', points: [
            'landing.features.drivers.point1',
            'landing.features.drivers.point2',
            'landing.features.drivers.point3',
            'landing.features.drivers.point4',
        ]},
    ]},
] as const;

usePageTitle(() => messages.value.t('landing.documentTitle'), true);

/** A warm landing visit keeps the native random quick-create suggestion without
 * any request, persisted preference or subsequent presentation-driven reselection. */
function chooseQuickCreate(): FrontendLandingQuickCreate {
    return quickCreateTypes[Math.floor(Math.random() * quickCreateTypes.length)]!;
}
</script>

<template>
    <section class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center py-3 mb-0">
            <i class="bi bi-diagram-3 me-2" aria-hidden="true"></i>{{ messages.t('app.title') }}
        </h1>
        <div class="card-body">
            <!-- Account and guest profiles share the native welcome presentation.
                 Identity remains application-owned; no private profile copy is retained here. -->
            <div class="text-center mb-4">
                <p class="lead mb-2">{{ welcomeText }}</p>
                <ul class="list-unstyled small d-inline-block text-start mb-0">
                    <li v-for="(point, index) in welcomePoints" :key="point" :class="{'mb-1': index < welcomePoints.length - 1}">
                        <i class="bi bi-check-circle-fill me-2" aria-hidden="true"></i>{{ messages.t(point) }}
                    </li>
                </ul>
            </div>
            <template v-if="session?.activeProfile">
                <div class="d-flex flex-wrap justify-content-center gap-2 mb-4">
                    <RouterLink class="btn btn-primary btn-lg d-inline-flex align-items-center gap-2" to="/frontend-pilot">
                        <i class="bi bi-speedometer2" aria-hidden="true"></i>{{ messages.t('landing.openDashboard') }}
                    </RouterLink>
                    <component :is="['packing', 'event'].includes(quickCreate) ? RouterLink : 'a'"
                        class="btn btn-outline-light btn-lg d-inline-flex align-items-center gap-2"
                        :to="quickTarget.url" :href="quickTarget.url">
                        <i class="bi" :class="quickTarget.icon" aria-hidden="true"></i>{{ messages.t(`landing.quickCreate.${quickCreate}`) }}
                    </component>
                </div>
            </template>
            <template v-else>
                <div class="d-flex flex-wrap justify-content-center gap-2 mb-3">
                    <RouterLink class="btn btn-primary btn-lg d-inline-flex align-items-center gap-2" :to="registerUrl">
                        <i class="bi bi-person-plus" aria-hidden="true"></i>{{ messages.t('auth.createAccount') }}
                    </RouterLink>
                    <RouterLink class="btn btn-outline-light btn-lg d-inline-flex align-items-center gap-2" :to="loginUrl">
                        <i class="bi bi-box-arrow-in-right" aria-hidden="true"></i>{{ messages.t('auth.logIn') }}
                    </RouterLink>
                </div>
                <p class="text-center small text-white-50 mb-4">{{ messages.t('landing.guestHint') }}</p>
            </template>

            <div class="position-relative text-center my-4">
                <hr />
                <span class="position-absolute top-50 start-50 translate-middle px-3 bg-dark rounded-pill border border-secondary text-white-50 small">
                    {{ messages.t('landing.whatYouCanCreate') }}
                </span>
            </div>
            <!-- Translated text remains escaped data. Native card order and responsive
                 geometry are retained instead of introducing another card/control system. -->
            <div v-for="(row, index) in featureRows" :key="index" :class="row.classes">
                <div v-for="feature in row.features" :key="feature.type" class="col">
                    <div class="card h-100 text-bg-dark border-secondary">
                        <div class="card-body">
                            <h2 class="h5 mb-1">
                                <i class="bi me-2" :class="creationTargets[feature.type].icon" aria-hidden="true"></i>{{ messages.t(`landing.features.${feature.type}.title`) }}
                            </h2>
                            <p class="mb-2 text-white-50">{{ messages.t(`landing.features.${feature.type}.description`) }}</p>
                            <ul class="small mb-0">
                                <li v-for="point in feature.points" :key="point">{{ messages.t(point) }}</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            <div class="position-relative text-center my-4">
                <hr />
                <span class="position-absolute top-50 start-50 translate-middle px-3 bg-dark rounded-pill border border-secondary text-white-50 small">
                    {{ messages.t('landing.accessPermissions') }}
                </span>
            </div>
            <div class="row g-4">
                <div class="col-md-6">
                    <div class="card h-100 text-bg-dark border-secondary">
                        <div class="card-body">
                            <h2 class="h5 mb-2"><i class="bi bi-door-open me-2" aria-hidden="true"></i>{{ messages.t('landing.accessParticipation') }}</h2>
                            <p class="small mb-2">{{ messages.t('landing.accessBody') }}</p>
                            <p class="small mb-0 text-white-50">{{ messages.t('landing.accessDashboard') }}</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="card h-100 text-bg-dark border-secondary">
                        <div class="card-body">
                            <h2 class="h5 mb-2"><i class="bi bi-shield-check me-2" aria-hidden="true"></i>{{ messages.t('landing.permissionsTitle') }}</h2>
                            <p class="small mb-2">{{ messages.t('landing.permissionsBody') }}</p>
                            <p class="small mb-0 text-white-50">{{ messages.t('landing.permissionsDetail') }}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>
