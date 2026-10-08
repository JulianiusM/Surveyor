import fs from 'node:fs';
import path from 'node:path';
import type {ValidateFunction} from 'ajv';
import type {ApiOperationId, ApiOperationContract, ApiProblemContract, ApiContractManifest} from '../../types/ApiTransportTypes';

// Source execution uses the normal generated artifacts; a release uses its packaged copy.
// Neither environment compiles schemas at startup or downloads a contract from the network.
const packagedDirectory = path.resolve(__dirname, '../../api-contracts');
const contractDirectory = fs.existsSync(path.join(packagedDirectory, 'server.cjs'))
    ? packagedDirectory : path.resolve(__dirname, '../../../.generated/api/v1');
export const apiContract: ApiContractManifest = JSON.parse(fs.readFileSync(path.join(contractDirectory, 'operations.json'), 'utf8'));
const validators = require(path.join(contractDirectory, 'server.cjs')) as Record<string, ValidateFunction>;

/** Only traversal metadata stays here; generated validators remain the sole validation implementation. */
interface ContractSchema {
    $ref?: string;
    properties?: Record<string, ContractSchema>;
    items?: ContractSchema;
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
