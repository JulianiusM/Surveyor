import {computed, shallowRef} from 'vue';
import {usePilot} from '../app/context';
import {ApiFailure} from '../app/transport';
import type {LocalizationContext, MessageKey} from '../../types/LocalizationTypes';
import type {components} from '../../types/api/v1';
import {validateProblem} from '../../../.generated/api/v1/browser/validateProblem.mjs';

/** Known contract Problems retain message identity across language changes. A safe detail
 * from a future server remains authoritative text; never guess its key or parameters. */
export function problemMessage(messages: LocalizationContext,
    problem: components['schemas']['Problem'] | components['schemas']['SafeProblemDetails']): string {
    return validateProblem(problem) ? messages.t(problem.messageKey, problem.params) : problem.detail;
}

/** Keep message identity, rather than translated text, so a mounted form's validation follows
 * language changes. Only validated known Problems drive typed behavior; safe future details remain text. */
export function useFeedbackError() {
    const {messages} = usePilot();
    const descriptor = shallowRef<MessageKey | ApiFailure | null>(null);
    const error = computed(() => {
        const value = descriptor.value;
        if (value === null) return null;
        if (typeof value === 'string') return messages.value.t(value);
        return value.problem ? problemMessage(messages.value, value.problem) : value.message;
    });
    function setError(value: MessageKey | ApiFailure | null): void { descriptor.value = value; }
    return {error, setError};
}
