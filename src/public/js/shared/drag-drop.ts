/**
 * Shared drag-and-drop functionality
 * Provides reusable drag-and-drop reordering for tables and lists
 */

import { post } from '../core/http';
import { showInlineAlert } from './alerts';

/**
 * Configuration for table row reordering
 */
export interface TableReorderConfig {
    /** Table body selector */
    tbodySelector: string;
    /** API endpoint for saving order */
    apiUrl: string;
    /** Function to extract item ID from row */
    getItemId: (row: HTMLTableRowElement) => string;
    /** Optional: called before reorder starts */
    onDragStart?: () => void;
    /** Optional: called after reorder completes */
    onDragEnd?: () => void;
}

/**
 * Initialize drag-and-drop reordering for table rows
 * @param config Configuration object
 */
export function initTableReorder(config: TableReorderConfig): void {
    const tbody = document.querySelector(config.tbodySelector);
    if (!tbody) return;
    
    let dragSrc: HTMLTableRowElement | null = null;

    tbody.addEventListener('dragstart', (e: Event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'
        if (e.target.closest('button') || e.target.closest('input')) return;

        // @ts-expect-error TS(2531): Object is possibly 'null'
        dragSrc = e.target.closest('tr');
        if (!dragSrc) return;

        // @ts-expect-error TS(2339): Property 'dataTransfer' does not exist on type 'Event'
        e.dataTransfer.effectAllowed = 'move';
        
        if (config.onDragStart) config.onDragStart();
    });

    tbody.addEventListener('dragover', (e: Event) => {
        if (!dragSrc) return;
        e.preventDefault();

        // @ts-expect-error TS(2531): Object is possibly 'null'
        const tr = e.target.closest('tr');
        if (!tr || tr === dragSrc) return;
        
        const rect = tr.getBoundingClientRect();
        tr.parentNode!.insertBefore(
            dragSrc,
            // @ts-expect-error TS(2339): Property 'clientY' does not exist on type 'Event'
            (e.clientY - rect.top) > rect.height / 2 ? tr.nextSibling : tr
        );
    });

    tbody.addEventListener('dragend', async () => {
        if (!dragSrc) return;

        const orders = Array.from(tbody.children).map((tr, i) => ({
            // @ts-expect-error TS(2345): Argument of type 'Element' is not assignable
            itemId: config.getItemId(tr),
            position: i,
        }));
        
        try {
            await post(config.apiUrl, { orders });
            showInlineAlert('success', 'Order saved');
        } catch (e) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', e.message);
            // Reload to restore original order
            setTimeout(() => location.reload(), 1000);
        } finally {
            dragSrc = null;
            if (config.onDragEnd) config.onDragEnd();
        }
    });

    // Make all rows draggable
    tbody.querySelectorAll('tr').forEach(tr => (tr as HTMLTableRowElement).draggable = true);
}

/**
 * Configuration for card/slot reordering (like activity slots)
 */
export interface CardReorderConfig {
    /** Parent container selector */
    containerClass: string;
    /** Card element selector */
    cardClass: string;
    /** API endpoint for saving order */
    apiUrl: string;
    /** Function to get order data from container */
    getOrderData: (container: HTMLElement) => any[];
}

/**
 * Initialize drag-and-drop reordering for cards/slots
 * @param config Configuration object
 */
export function initCardReorder(config: CardReorderConfig): void {
    let dragCard: HTMLElement | null = null;
    let dragParent: HTMLElement | null = null;

    /* start */
    document.addEventListener('dragstart', (e: Event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'
        if (e.target.closest('button') || e.target.closest('input')) return;

        // @ts-expect-error TS(2531): Object is possibly 'null'
        const card = e.target.closest(`.${config.cardClass}`);
        if (!card) return;

        dragCard = card as HTMLElement;
        dragParent = card.parentElement;

        // @ts-expect-error TS(2531): Object is possibly 'null'
        e.dataTransfer.setData('text/plain', '');
        // @ts-expect-error TS(2531): Object is possibly 'null'
        e.dataTransfer.effectAllowed = 'move';
    });

    /* over – only same container */
    document.addEventListener('dragover', (e: Event) => {
        if (!dragCard) return;

        // @ts-expect-error TS(2531): Object is possibly 'null'
        const overCard = e.target.closest(`.${config.cardClass}`);
        if (!overCard || overCard === dragCard) return;
        if (overCard.parentElement !== dragParent) return;  // stay in column

        e.preventDefault();  // allow drop

        const rect = overCard.getBoundingClientRect();
        dragParent!.insertBefore(
            dragCard,
            // @ts-expect-error TS(2339): Property 'clientY' does not exist on type 'Event'
            (e.clientY - rect.top) > rect.height / 2 ? overCard.nextSibling : overCard
        );
    });

    /* end – send new order */
    document.addEventListener('dragend', async () => {
        if (!dragCard || !dragParent) return;

        const order = config.getOrderData(dragParent);

        try {
            await post(config.apiUrl, { order });
            showInlineAlert('success', 'Reordered');
        } catch (err) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', err.message);
        }
        
        dragCard = dragParent = null;
    });
}
