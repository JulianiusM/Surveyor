import fs from 'node:fs';
import path from 'node:path';
import type {ErrorObject, ValidateFunction} from 'ajv';
import type {ApiOperationId, ApiOperationContract, ApiProblemContract, ApiContractManifest} from '../../types/ApiTransportTypes';

// Source execution uses the normal generated artifacts; a release uses its packaged copy.
// Neither environment compiles schemas at startup or downloads a contract from the network.
const packagedDirectory = path.resolve(__dirname, '../../api-contracts');
const contractDirectory = fs.existsSync(path.join(packagedDirectory, 'server.cjs'))
    ? packagedDirectory : path.resolve(__dirname, '../../../.generated/api/v1');
export const apiContract: ApiContractManifest = JSON.parse(fs.readFileSync(path.join(contractDirectory, 'operations.json'), 'utf8'));
const validators = require(path.join(contractDirectory, 'server.cjs')) as Record<string, ValidateFunction>;

/** Authored constraint/traversal metadata stays private; generated validators own structural validation. */
interface ContractSchema {
    $ref?: string;
    properties?: Record<string, ContractSchema>;
    items?: ContractSchema;
    maxLength?: number;
}

const document = JSON.parse(fs.readFileSync(path.join(contractDirectory, 'openapi.json'), 'utf8')) as {
    components: {schemas: Record<string, ContractSchema>};
};

/** Resolve an authored component reference without exposing mutable schema objects to callers. */
function resolveSchema(schema: ContractSchema): ContractSchema {
    if (!schema.$ref) return schema;
    const name = schema.$ref.replace(/^#\/components\/schemas\//, '');
    const target = document.components.schemas[name];
    if (!target) throw new Error(`Missing generated API schema: ${schema.$ref}`);
    return resolveSchema(target);
}

/**
 * Return a path's authored field/row order for native validation-message presentation.
 * Required-property checks and transport coercion can produce errors before AJV walks
 * properties. Ordering by schema metadata restores the native form's original sequence
 * without defining a second validation shape or copying field lists into an adapter.
 */
export function contractPathOrder(schemaName: string, pointer: string): number[] {
    let schema = document.components.schemas[schemaName];
    if (!schema) throw new Error(`Missing generated API schema: ${schemaName}`);
    const order: number[] = [];
    for (const part of pointer.split('/').slice(1)) {
        schema = resolveSchema(schema);
        if (schema.items && /^\d+$/.test(part)) {
            order.push(Number(part));
            schema = schema.items;
        } else {
            const fields = Object.keys(schema.properties ?? {});
            const index = fields.indexOf(part);
            order.push(index < 0 ? Number.MAX_SAFE_INTEGER : index);
            schema = schema.properties?.[part] ?? {};
        }
    }
    return order;
}

/**
 * Preserve native Joi/HTML UTF-16 maximum-length interpretation using authored limits.
 * Generated JSON Schema validation retains its standard code-point meaning for v1.
 * Native adapters combine these diagnostics with generated structural errors, without
 * copying fields, limits or schemas. Only declared properties/items/references are visited;
 * type and unknown-field failures still belong to the generated validator.
 */
export function contractNativeStringLengthErrors(schemaName: string, input: unknown): ErrorObject[] {
    const schema = document.components.schemas[schemaName];
    if (!schema) throw new Error(`Missing generated API schema: ${schemaName}`);
    const errors: ErrorObject[] = [];
    collectNativeStringLengthErrors(schema, input, '', `#/components/schemas/${schemaName}`, errors);
    return errors;
}

/** Walk authored structure rather than exposing mutable constraint metadata to adapters. */
function collectNativeStringLengthErrors(schema: ContractSchema, input: unknown, pointer: string,
                                        schemaPath: string, errors: ErrorObject[]): void {
    const resolved = resolveSchema(schema);
    if (typeof input === 'string') {
        if (resolved.maxLength !== undefined && input.length > resolved.maxLength) {
            errors.push({keyword: 'maxLength', instancePath: pointer, schemaPath: `${schemaPath}/maxLength`,
                params: {limit: resolved.maxLength}});
        }
        return;
    }
    if (Array.isArray(input)) {
        if (!resolved.items) return;
        for (let index = 0; index < input.length; index++) {
            collectNativeStringLengthErrors(resolved.items, input[index], `${pointer}/${index}`, `${schemaPath}/items`, errors);
        }
        return;
    }
    if (!input || typeof input !== 'object') return;
    for (const [field, child] of Object.entries(resolved.properties ?? {})) {
        if (!Object.hasOwn(input, field)) continue;
        const escaped = field.replace(/~/g, '~0').replace(/\//g, '~1');
        collectNativeStringLengthErrors(child, (input as Record<string, unknown>)[field], `${pointer}/${escaped}`,
            `${schemaPath}/properties/${escaped}`, errors);
    }
}

export function operationContract(operationId: ApiOperationId): ApiOperationContract {
    const operation = apiContract.operations.find(candidate => candidate.operationId === operationId);
    if (!operation) throw new Error(`Undeclared API operation: ${operationId}`);
    return operation;
}

export function contractValidator(schemaName: string): ValidateFunction {
    const name = schemaName.startsWith('validate') ? schemaName : `validate${schemaName}`;
    const validator = validators[name];
    if (!validator) throw new Error(`Missing generated API validator: ${name}`);
    return validator;
}

export function problemContract(code: string): ApiProblemContract {
    const problem = apiContract.problems.find(candidate => candidate.code === code);
    if (!problem) throw new Error(`Undeclared API problem: ${code}`);
    return problem;
}
