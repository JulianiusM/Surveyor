import type {FrontendPilotBootstrap} from '../../types/FrontendPilotTypes';

/** Keep bootstrap JSON inert inside an HTML script element, including translated or help text. */
export function serializeBootstrap(bootstrap: FrontendPilotBootstrap): string {
    return JSON.stringify(bootstrap).replace(/</gu, '\\u003c').replace(/>/gu, '\\u003e')
        .replace(/&/gu, '\\u0026').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
}
