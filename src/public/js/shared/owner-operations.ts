/**
 * Shared owner operations
 * Provides reusable functionality for owner-specific operations
 */

import { post } from '../core/http';
import { showInlineAlert } from './alerts';

/**
 * Configuration for owner remove functionality
 */
export interface OwnerRemoveConfig {
    /** Base API URL */
    baseUrl: string;
    /** Optional: reload delay in ms (default: 100) */
    reloadDelay?: number;
}

/**
 * Initialize owner remove assignee functionality
 * @param config Configuration object
 */
export function initOwnerRemove(config: OwnerRemoveConfig): void {
    const reloadDelay = config.reloadDelay ?? 100;

    document.addEventListener('click', async (e: Event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'
        const btn = e.target.closest('button[data-owner-remove]');
        if (!btn) return;
        
        const assignId = btn.dataset.assignid;
        try {
            await post(`${config.baseUrl}/assignment/${assignId}/delete`, {});
            showInlineAlert('success', 'Removed');
            setTimeout(() => location.reload(), reloadDelay);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', err.message);
        }
    });
}

/**
 * Configuration for owner flags functionality
 */
export interface OwnerFlagsConfig {
    /** Base API URL */
    baseUrl: string;
    /** Optional: reload delay in ms (default: 100) */
    reloadDelay?: number;
}

/**
 * Initialize owner flags toggle functionality
 * @param config Configuration object
 */
export function initOwnerFlags(config: OwnerFlagsConfig): void {
    const form = document.getElementById('flagForm');
    if (!form) return;

    const reloadDelay = config.reloadDelay ?? 100;

    form.addEventListener('change', async () => {
        const payload = {
            // @ts-expect-error TS(2531): Object is possibly 'null'
            allowAdd: document.getElementById('allowAddSwitch').checked,
            // @ts-expect-error TS(2531): Object is possibly 'null'
            guestManage: document.getElementById('guestManageSwitch').checked,
        };
        try {
            await post(`${config.baseUrl}/settings`, payload);
            showInlineAlert('success', 'Settings updated');
            setTimeout(() => location.reload(), reloadDelay);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', err.message);
            /* Reload to force consistent switches */
            setTimeout(() => location.reload(), 800);
        }
    });
}

/**
 * Configuration for owner delete item functionality
 */
export interface OwnerDeleteItemConfig {
    /** Base API URL */
    baseUrl: string;
    /** Confirmation message */
    confirmMessage: string;
    /** Success message */
    successMessage: string;
    /** Optional: reload delay in ms (default: 100) */
    reloadDelay?: number;
}

/**
 * Initialize owner delete item functionality
 * @param config Configuration object
 */
export function initOwnerDeleteItem(config: OwnerDeleteItemConfig): void {
    const reloadDelay = config.reloadDelay ?? 100;

    document.addEventListener('click', async (e: Event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'
        const btn = e.target.closest('[data-delete-item]');
        if (!btn) return;

        if (!confirm(config.confirmMessage)) return;

        const itemId = btn.dataset.itemid;
        try {
            await post(`${config.baseUrl}/item/${itemId}/delete`, {});
            showInlineAlert('success', config.successMessage);
            setTimeout(() => location.reload(), reloadDelay);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', err.message);
        }
    });
}

/**
 * Configuration for quick add form
 */
export interface QuickAddConfig {
    /** Base API URL */
    baseUrl: string;
    /** Form ID */
    formId: string;
    /** Optional: reload delay in ms (default: 100) */
    reloadDelay?: number;
}

/**
 * Initialize quick add form functionality
 * @param config Configuration object
 */
export function initQuickAdd(config: QuickAddConfig): void {
    const quickForm = document.getElementById(config.formId);
    if (!quickForm) return;

    const reloadDelay = config.reloadDelay ?? 100;

    quickForm.addEventListener('submit', async (e: Event) => {
        e.preventDefault();
        // @ts-expect-error TS(2550): Property 'fromEntries' does not exist on type 'ObjectConstructor'
        const data = Object.fromEntries(new FormData(quickForm as HTMLFormElement).entries());

        try {
            await post(`${config.baseUrl}/items`, data);
            showInlineAlert('success', 'Added');
            setTimeout(() => location.reload(), reloadDelay);
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', err.message);
        }
    });
}
