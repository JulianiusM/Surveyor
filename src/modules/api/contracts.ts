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

/** Resolve only a declared operation from the locally generated contract manifest.
 * Routes use its media, parameter and response metadata at the common transport
 * boundary; an unknown ID is an implementation/configuration error, never a way
 * for submitted input to select an undeclared operation or compile a new schema. */
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
