<script setup lang="ts">
import {computed} from 'vue';
import {useRoute} from 'vue-router';
import type {FrontendCommonPage} from '../../../types/FrontendPilotTypes';
import {frontendDocumentUrl} from '../../../modules/lib/frontendIdentity';
import {isPlainMessageKey} from '../../../modules/localization/translator';
import {usePilot} from '../../app/context';
import {usePageTitle} from '../../composables/pageTitle';
import PageMessage from '../../components/PageMessage.vue';
import StatusNotice from '../../components/StatusNotice.vue';

const props = defineProps<{page?: FrontendCommonPage}>();
const context = usePilot();
const {messages} = context;
const route = useRoute();
// The translated projection and its source receipt have different lifetimes.
// A locale change updates text without renewing an expired message alert.
const presentation = computed(resolvePresentation);
const page = computed(() => presentation.value.page);
const localizedMessage = computed(() => page.value.messageKey && isPlainMessageKey(page.value.messageKey)
    ? messages.value.t(page.value.messageKey) : page.value.message);
const messageTitleKeys = {info: 'common.infoTitle', success: 'common.successTitle', warning: 'common.warningTitle', error: 'common.errorTitle'} as const;
// Message documents retain their native document branding. This scoped conversion
// does not silently repair that inherited title while the native UI is the comparator.
const title = computed(() => page.value.kind === 'message'
    ? `${messages.value.t(messageTitleKeys[page.value.severity])} | ControlPanel`
    : `${messages.value.t('common.errorTitle')} | ${messages.value.t('app.title')}`);
usePageTitle(title, true);

/** Select only an admitted document or a current destination-owned completion.
 * Warm visits cannot reconstruct success, error text or stack traces from URL data;
 * an unsupported route remains a safe localized not-found presentation. */
function resolvePresentation(): {page: FrontendCommonPage; renewal: unknown} {
    // Explicit App outcomes and eligible initial documents already crossed their
    // server/browser boundary. Retired bootstrap data cannot authorize a later visit.
    if (props.page) return {page: props.page, renewal: props.page};
    const initial = context.initialDocumentFor(route.fullPath)?.commonPage;
    if (initial) return {page: initial, renewal: initial};

    if (route.path === '/frontend-pilot/message') {
        // Completion receipts bind the current actor and exact canonical destination.
        // Context-owned notices also retire on identity changes; neither source is URL text.
        const completion = context.pageCompletion.value;
        if (completion && completion.context === context.session.value?.context
            && frontendDocumentUrl(completion.destination) === frontendDocumentUrl(route.fullPath)
            && isPlainMessageKey(completion.messageKey)) {
            return {page: {kind: 'message', severity: completion.kind, message: messages.value.t(completion.messageKey)},
                renewal: completion};
        }
        const notice = context.pageNotice.value;
        if (notice && isPlainMessageKey(notice.messageKey)) {
            return {page: {kind: 'message', severity: notice.kind, message: messages.value.t(notice.messageKey)},
                renewal: notice};
        }
    }
    return {page: {kind: 'error', status: 404, message: messages.value.t('api:errors.NOT_FOUND')}, renewal: null};
}
</script>

<template>
    <!-- The server supplies an admitted outcome, never query-string message text.
         Ordinary full messages reuse their existing expiry and Home presentation. -->
    <PageMessage v-if="page.kind === 'message'" :kind="page.severity" :message="localizedMessage"
        :display-message="page.severity !== 'warning'"
        :renewal="presentation.renewal" home-url="/frontend-pilot/home" />
    <section v-else class="card bg-dark text-white mb-3">
        <h1 class="card-header text-center bg-danger text-light">
            <i class="bi bi-exclamation-triangle-fill me-2" aria-hidden="true"></i>{{ messages.t('common.errorHeading') }}
        </h1>
        <div class="card-body">
            <StatusNotice kind="danger" :role="null" class="d-flex align-items-center">
                <i class="bi bi-x-circle-fill me-3 fs-3" aria-hidden="true"></i>
                <div>
                    <strong>{{ localizedMessage || messages.t('common.internalError') }}</strong>
                    <template v-if="page.status">{{ ' ' + messages.t('common.errorStatus', {code: page.status}) }}</template>
                </div>
            </StatusNotice>
            <!-- Development stack admission belongs to Express. Vue only escapes the
                 explicitly supplied text; no error object or production stack is inferred. -->
            <details v-if="page.stack" class="mb-0">
                <summary class="text-warning"><i class="bi bi-code-slash me-1" aria-hidden="true"></i>{{ messages.t('common.viewStackTrace') }}</summary>
                <pre class="bg-black text-light p-2 rounded"><code>{{ page.stack }}</code></pre>
            </details>
        </div>
    </section>
</template>
