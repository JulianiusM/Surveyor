<script setup lang="ts">
import {ref, watch} from 'vue';
import {RouterLink, useRoute, useRouter} from 'vue-router';
import {usePilot} from '../../app/context';
import {usePageTitle} from '../../composables/pageTitle';
import OverviewRegion from './OverviewRegion.vue';
const context = usePilot();
const {messages} = context;
const route = useRoute();
const router = useRouter();
usePageTitle(() => messages.value.t('app.overview'));
const hidden = ref<Record<string, boolean>>({});
const open = ref<Record<string, boolean>>({participant: true, owner: true});
const counts = ref<Record<string, {total: number; hidden: number}>>(Object.fromEntries(
    (context.initialDocumentFor(route.fullPath)?.overview ?? [])
        .map(region => [region.collection, {total: region.totalEntities, hidden: region.hiddenEntities}])));
watch(
    () => route.query,
    (query) => {
        for (const collection of ['participant', 'owner']) {
            hidden.value[collection] =
                query[collection + '_hidden_open'] === '1' ||
                typeof query[collection + '_hidden_event'] === 'string';
        }
    },
    {immediate: true},
);
function updateCounts(collection: string, total: number, hiddenCount: number): void {
    counts.value[collection] = {total, hidden: hiddenCount};
}
async function toggleHidden(collection: string): Promise<void> {
    const query = {...route.query};
    const prefix = collection + '_hidden_';
    if (hidden.value[collection]) {
        delete query[prefix + 'open'];
        delete query[prefix + 'event'];
    } else query[prefix + 'open'] = '1';
    await router.push({query});
}
function hiddenHref(collection: string): string {
    const query = {...route.query};
    const prefix = collection + '_hidden_';
    if (hidden.value[collection]) { delete query[prefix + 'open']; delete query[prefix + 'event']; }
    else query[prefix + 'open'] = '1';
    return router.resolve({path: '/frontend-pilot', query}).href;
}
</script>
<template>
    <section class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center fst-italic">
            <i class="bi bi-house-door-fill me-2" aria-hidden="true"></i
            >{{ messages.t('overview.title', {name: context.session.value?.activeProfile?.name ?? ''}) }}
        </h1>
        <div class="card-body">
            <p v-if="!context.session.value?.activeProfile" class="text-center">
                <RouterLink class="btn btn-primary" to="/frontend-pilot/users/login">{{
                    messages.t('app.login')
                }}</RouterLink
                ><RouterLink class="btn btn-outline-light ms-2" to="/frontend-pilot/users/register">{{
                    messages.t('app.register')
                }}</RouterLink>
            </p>
            <template v-else>
                <section
                    v-for="collection in ['participant', 'owner'] as const"
                    :key="collection"
                    class="mb-4"
                >
                    <h2 class="text-center">
                        <i
                            class="bi me-2"
                            :class="collection === 'participant' ? 'bi-clipboard-check' : 'bi-shield-check'"
                            aria-hidden="true"
                        ></i
                        >{{
                            messages.t(
                                collection === 'participant' ? 'overview.participation' : 'overview.managed',
                            )
                        }}
                    </h2>
                    <p class="text-center">
                        {{
                            messages.t(
                                collection === 'participant'
                                    ? 'overview.participationHint'
                                    : 'overview.managedHint',
                            )
                        }}
                    </p>
                    <hr />
                    <div class="accordion accordion-dark">
                        <div class="accordion-item entity-overview overflow-visible">
                            <h2 class="accordion-header">
                                <button
                                    class="accordion-button"
                                    :class="{collapsed: !open[collection]}"
                                    type="button"
                                    :aria-expanded="open[collection]"
                                    :aria-controls="'overview-' + collection"
                                    @click="open[collection] = !open[collection]"
                                >
                                    <i
                                        class="bi me-2"
                                        :class="
                                            collection === 'participant'
                                                ? 'bi-clipboard-check'
                                                : 'bi-shield-check'
                                        "
                                        aria-hidden="true"
                                    ></i>
                                    {{
                                        messages.t(
                                            collection === 'participant'
                                                ? 'overview.participation'
                                                : 'overview.managed',
                                        )
                                    }}
                                    <span v-if="counts[collection]" class="badge bg-secondary ms-2">{{
                                        counts[collection].total
                                    }}</span>
                                    <!-- Unknown counts are not empty membership. The region announces
                                         loading; keep this inline placeholder free of another live status. -->
                                    <span v-else class="badge bg-secondary ms-2" aria-hidden="true">…</span>
                                </button>
                            </h2>
                            <div
                                v-show="open[collection]"
                                :id="'overview-' + collection"
                                class="accordion-collapse collapse show"
                            >
                                <div class="accordion-body">
                                    <OverviewRegion
                                        :collection="collection"
                                        region="main"
                                        :active="open[collection]"
                                        @counts="
                                            (total, hiddenCount) =>
                                                updateCounts(collection, total, hiddenCount)
                                        "
                                    />
                                    <!-- An explicitly opened hidden region may start before main-region
                                         counts arrive. Confirmed membership retains the native empty rule. -->
                                    <div v-if="counts[collection]?.total || (!counts[collection] && hidden[collection])" class="mt-4">
                                        <h3 class="h5">
                                            <a
                                                class="btn btn-outline-secondary"
                                                :aria-expanded="!!hidden[collection]"
                                                :aria-controls="'overview-' + collection + '-hidden'"
                                                :href="hiddenHref(collection)"
                                                @click.prevent="toggleHidden(collection)"
                                            >
                                                <i class="bi bi-archive me-2" aria-hidden="true"></i
                                                >{{ messages.t('overview.hidden') }}
                                                <span v-if="counts[collection]" class="badge bg-secondary ms-2">{{
                                                    counts[collection].hidden
                                                }}</span>
                                                <span v-else class="badge bg-secondary ms-2" aria-hidden="true">…</span>
                                            </a>
                                        </h3>
                                        <div
                                            v-if="hidden[collection]"
                                            :id="'overview-' + collection + '-hidden'"
                                        >
                                            <p class="small text-body-secondary">
                                                {{ messages.t('overview.hiddenHint') }}
                                            </p>
                                            <OverviewRegion
                                                :collection="collection"
                                                region="hidden"
                                                :active="open[collection]"
                                                @counts="
                                                    (total, hiddenCount) =>
                                                        updateCounts(collection, total, hiddenCount)
                                                "
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </template>
        </div>
    </section>
</template>
