import type {MessageKey} from './LocalizationTypes';
import type {components} from './api/v1';

/** Finite wire metadata is authored once in the generated API contract. */
export type FieldDiagnostic = components['schemas']['FieldDiagnostic'];

/** Display identities only: values, parser prose and schemas stay with their
 * validation owner. Feature callers may retain a visible row/day identity. */
export interface InputFieldIdentity {
    label: MessageKey;
    row?: {label: MessageKey; number: number; day?: string};
}

/** Shared presentation accepts generated rule metadata without duplicating a
 * validation constraint or changing how a submitted value is normalized. */
export interface InputDiagnostic {
    field: InputFieldIdentity;
    rule: string;
    limit?: number;
    type?: string;
}

/** Scalar transport syntax is shared by browser admission and server decoding. */
export type ScalarParameterResult = {valid: true; value: string | number | boolean} | {valid: false};
