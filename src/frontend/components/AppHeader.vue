<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {RouterLink, useRoute, useRouter} from 'vue-router';
import {usePilot} from '../app/context';
import {localeManifest} from '../../modules/localization/translator';
import type {Locale} from '../../types/LocalizationTypes';
import AppNavigationDropdown from './AppNavigationDropdown.vue';

const emit = defineEmits<{localeError: []}>();
const context = usePilot();
const {messages, session, locale, ready} = context;
const route = useRoute();
const router = useRouter();
const identityPending = ref(false);
const identityError = ref(false);
const expanded = ref(false);
const changingLocale = ref(false);
const listId = computed(() =>
    typeof route.params.listId === 'string'
        ? route.params.listId.toLowerCase()
        : typeof route.query.list === 'string'
          ? route.query.list.toLowerCase()
          : null,
);
const helpRoute = computed(() => ({
    path: '/frontend-pilot/help',
    query: {
        locale: locale.value,
        ...(listId.value ? {list: listId.value} : {}),
        ...(route.path.startsWith('/frontend-pilot/packing/') ? {doc: 'packing_lists'} : {}),
    },
}));
const next = computed(() => route.fullPath);
const profileLabel = computed(() =>
    session.value?.kind === 'guest'
        ? messages.value.t('app.guestLabel', {name: session.value.activeProfile?.name ?? ''})
        : (session.value?.activeProfile?.name ?? ''),
);
watch(
    () => route.fullPath,
    () => {
        expanded.value = false;
    },
);

async function selectLocale(event: Event): Promise<void> {
    changingLocale.value = true;
    try {
        await context.changeLocale((event.target as HTMLSelectElement).value as Locale);
        // Help supports native locale-bearing GET links. Keep the current URL consistent
        // with the confirmed preference so reload cannot restore its previous language.
        if (route.path === '/frontend-pilot/help' || route.path.startsWith('/frontend-pilot/help/')) {
            await router.replace({path: route.path, query: {...route.query, locale: locale.value}, hash: route.hash});
        }
    } catch {
        emit('localeError');
    } finally {
        changingLocale.value = false;
    }
}
async function logout(): Promise<void> {
    if (identityPending.value || !context.mayChangeIdentity()) return;
    identityPending.value = true;
    identityError.value = false;
    const scope = context.capture();
    try {
        const result = await context.api.logout(scope);
        await context.acceptIdentity(result);
        if (result.redirect && /^https?:\/\//u.test(result.redirect)) window.location.assign(result.redirect);
        else await router.push({path: '/frontend-pilot/users/login', query: {next: route.fullPath}});
    } catch {
        identityError.value = true;
    } finally {
        identityPending.value = false;
    }
}
async function switchProfile(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const selectedProfile = select.value;
    // A cancelled or rejected transition must not visually impersonate another profile.
    select.value = session.value?.activeProfile?.id ?? '';
    if (selectedProfile === session.value?.activeProfile?.id || identityPending.value || !context.mayChangeIdentity()
        || !window.confirm(messages.value.t('auth.confirmSwitch'))) return;
    identityPending.value = true;
    identityError.value = false;
    try {
        const result = await context.api.switchProfile(
            selectedProfile,
            context.capture(),
        );
        await context.acceptIdentity(result);
    } catch {
        identityError.value = true;
    } finally {
        identityPending.value = false;
        select.value = session.value?.activeProfile?.id ?? '';
    }
}
</script>

<template>
    <header>
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark shadow-sm">
            <div class="container">
                <RouterLink class="navbar-brand d-flex align-items-center" to="/frontend-pilot">
                    <img :src="'/img/logo.png'" :alt="messages.t('app.title')" height="30" class="me-2" />
                    <span class="fw-semibold">{{ messages.t('app.title') }}</span>
                </RouterLink>
                <button
                    class="navbar-toggler"
                    type="button"
                    aria-controls="pilot-navbar-main"
                    :aria-expanded="expanded"
                    :aria-label="messages.t('app.toggleNavigation')"
                    @click="expanded = !expanded"
                >
                    <span class="navbar-toggler-icon"></span>
                </button>
                <div id="pilot-navbar-main" class="collapse navbar-collapse" :class="{show: expanded}">
                    <ul class="navbar-nav me-auto mb-2 mb-lg-0">
                        <li class="nav-item">
                            <RouterLink class="nav-link" to="/frontend-pilot"
                                ><i class="bi bi-house-fill me-1" aria-hidden="true"></i
                                >{{ messages.t('app.home') }}</RouterLink
                            >
                        </li>
                        <AppNavigationDropdown :label="messages.t('app.new')" icon="bi-plus-circle">
                            <li>
                                <h6 class="dropdown-header">{{ messages.t('app.planDecide') }}</h6>
                            </li>
                            <li>
                                <a class="dropdown-item" href="/survey/create"
                                    ><i class="bi bi-bar-chart-steps me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.survey') }}</a
                                >
                            </li>
                            <li>
                                <a class="dropdown-item" href="/activity/create"
                                    ><i class="bi bi-calendar2-check me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.activity') }}</a
                                >
                            </li>
                            <li>
                                <a class="dropdown-item" href="/event/create"
                                    ><i class="bi bi-calendar2-event me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.event') }}</a
                                >
                            </li>
                            <li><hr class="dropdown-divider" /></li>
                            <li>
                                <h6 class="dropdown-header">{{ messages.t('app.organizeShare') }}</h6>
                            </li>
                            <li>
                                <RouterLink class="dropdown-item" to="/frontend-pilot/packing/create"
                                    ><i class="bi bi-bag-plus me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.packing') }}</RouterLink
                                >
                            </li>
                            <li>
                                <a class="dropdown-item" href="/drivers/create"
                                    ><i class="bi bi-car-front me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.drivers') }}</a
                                >
                            </li>
                        </AppNavigationDropdown>
                        <AppNavigationDropdown :label="messages.t('app.overview')" icon="bi-collection">
                            <li>
                                <RouterLink class="dropdown-item" to="/frontend-pilot"
                                    ><i class="bi bi-speedometer2 me-2" aria-hidden="true"></i
                                    >{{ messages.t('app.yourOverview') }}</RouterLink
                                >
                            </li>
                        </AppNavigationDropdown>
                        <li class="nav-item">
                            <RouterLink
                                class="nav-link"
                                :to="helpRoute"
                                :aria-label="messages.t('app.helpForPage')"
                                :title="messages.t('app.openHelpForPage')"
                            >
                                <i class="bi bi-question-circle me-1" aria-hidden="true"></i
                                >{{ messages.t('app.help') }}
                            </RouterLink>
                        </li>
                    </ul>
                    <ul class="navbar-nav ms-auto">
                        <AppNavigationDropdown
                            v-if="ready && session?.activeProfile"
                            :label="profileLabel"
                            icon="bi-person-circle"
                            align-end
                        >
                            <li>
                                <RouterLink class="dropdown-item" to="/frontend-pilot"
                                    ><i class="bi bi-speedometer2 me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.yourOverview') }}</RouterLink
                                >
                            </li>
                            <li>
                                <a class="dropdown-item" href="/users/profile"
                                    ><i class="bi bi-gear-fill me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.profileSettings') }}</a
                                >
                            </li>
                            <li v-if="session.kind === 'account'">
                                <a class="dropdown-item" href="/users/profile/manage"
                                    ><i class="bi bi-person-lines-fill me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.yourProfiles') }}</a
                                >
                                <div v-if="session.profiles.length > 1" class="px-3 py-2">
                                    <label class="visually-hidden" for="pilot-profile">{{ messages.t('auth.selectProfile') }}</label>
                                    <select id="pilot-profile" class="form-select form-select-sm"
                                            :value="session.activeProfile?.id" :disabled="identityPending" @change="switchProfile">
                                        <option v-for="profile in session.profiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
                                    </select>
                                </div>
                            </li>
                            <li><hr class="dropdown-divider" /></li>
                            <li>
                                <button
                                    class="dropdown-item text-danger"
                                    type="button"
                                    :disabled="identityPending"
                                    @click="logout"
                                >
                                    <i class="bi bi-box-arrow-right me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.logout') }}
                                </button>
                            </li>
                            <li>
                                <a class="dropdown-item text-danger" href="/users/account/delete"
                                    ><i class="bi bi-trash me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.deleteAccount') }}</a
                                >
                            </li>
                        </AppNavigationDropdown>
                        <template v-else>
                            <li class="nav-item me-1">
                                <RouterLink
                                    class="nav-link"
                                    :to="{path: '/frontend-pilot/users/login', query: {next}}"
                                    ><i class="bi bi-box-arrow-in-right me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.login') }}</RouterLink
                                >
                            </li>
                            <li class="nav-item">
                                <RouterLink
                                    class="nav-link"
                                    :to="{path: '/frontend-pilot/users/register', query: {next}}"
                                    ><i class="bi bi-person-plus me-1" aria-hidden="true"></i
                                    >{{ messages.t('app.register') }}</RouterLink
                                >
                            </li>
                        </template>
                        <li class="nav-item d-flex align-items-center ms-lg-2">
                            <label class="visually-hidden" for="pilot-locale">{{
                                messages.t('app.locale')
                            }}</label>
                            <select
                                id="pilot-locale"
                                class="form-select form-select-sm pilot-locale"
                                :value="locale"
                                :disabled="changingLocale || !ready"
                                @change="selectLocale"
                            >
                                <option
                                    v-for="available in localeManifest"
                                    :key="available.locale"
                                    :value="available.locale"
                                    :lang="available.locale"
                                    :selected="available.locale === locale"
                                >
                                    {{ available.nativeName }}
                                </option>
                            </select>
                        </li>
                    </ul>
                </div>
            </div>
            <p v-if="identityError" class="text-danger text-center mb-0" role="alert">
                {{ messages.t('common.error') }}
            </p>
        </nav>
    </header>
</template>
