import fs from 'node:fs';
import path from 'node:path';
import type {ValidateFunction} from 'ajv';
import type {ApiOperationId} from '../../types/ApiTypes';

interface OperationContract {
    operationId: ApiOperationId;
    method: string;
    path: string;
    parameters: Array<{in: string; name: string; required?: boolean; schema: unknown}>;
    parametersValidator: string;
    requestSchema: string | null;
    requestMediaType: 'application/json' | 'multipart/form-data' | null;
    responseSchemas: Record<string, string>;
    responseMediaTypes: Record<string, string>;
}

interface ProblemContract {
    code: string;
    status: number;
    messageKey: string;
    paramsSchema: unknown;
}

interface ContractManifest {
    sourceHash: string;
    operations: OperationContract[];
    problems: ProblemContract[];
}

// Source execution uses the normal generated artifacts; a release uses its packaged copy.
// Neither environment compiles schemas at startup or downloads a contract from the network.
const packagedDirectory = path.resolve(__dirname, '../../api-contracts');
const contractDirectory = fs.existsSync(path.join(packagedDirectory, 'server.cjs'))
    ? packagedDirectory : path.resolve(__dirname, '../../../.generated/api/v1');
export const apiContract: ContractManifest = JSON.parse(fs.readFileSync(path.join(contractDirectory, 'operations.json'), 'utf8'));
const validators = require(path.join(contractDirectory, 'server.cjs')) as Record<string, ValidateFunction>;

export function operationContract(operationId: ApiOperationId): OperationContract {
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

export function problemContract(code: string): ProblemContract {
    const problem = apiContract.problems.find(candidate => candidate.code === code);
    if (!problem) throw new Error(`Undeclared API problem: ${code}`);
    return problem;
}
