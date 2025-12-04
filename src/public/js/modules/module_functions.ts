/**
 * Legacy module_functions - Re-exports from refactored core modules
 * This file maintains backward compatibility while new code uses the modular structure
 * 
 * @deprecated Import directly from core modules instead
 */

// Re-export from core modules
export { setCurrentNavLocation, initEntityLists } from '../core/navigation';
export { loadPerms, jsonReviver } from '../core/permissions';
export { post } from '../core/http';
export { showInlineAlert } from '../shared/alerts';
export { startInlineEdit, startInlineEditArea, disableDnD, enableDnD } from '../shared/inline-edit';
export { 
    refreshState, 
    isPasswordValid, 
    isPasswordRepeatValid, 
    generateTooltip, 
    verifyPassword, 
    matchPassword, 
    removeTooltip, 
    validate 
} from '../core/password-validation';
export { getSelectValues, objectToArray } from '../core/form-utils';
export { padNumber, formatISOInTimeZone } from '../core/formatting';
