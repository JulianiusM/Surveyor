/**
 * Shared inline editing functionality
 * Provides reusable inline editing for various entity attributes
 */

import { post } from '../core/http';
import { showInlineAlert } from './alerts';
import { reloadAfterDelay } from './ui-helpers';

/**
 * Enable drag-and-drop for elements
 */
export function enableDnD(): void {
    // @ts-expect-error TS(2339): Property 'IS_MANAGE' does not exist on type 'Window'
    if (!window.IS_MANAGE) return;
    const draggables = document.getElementsByClassName('draggable');
    for (let elem of draggables) {
        // @ts-ignore
        elem.draggable = true;
    }
}

/**
 * Disable drag-and-drop for elements
 */
export function disableDnD(): void {
    const draggables = document.getElementsByClassName('draggable');
    for (let elem of draggables) {
        // @ts-ignore
        elem.draggable = false;
    }
}

/**
 * Start inline editing for a textarea field (e.g., description)
 * @param elem Element to edit
 * @param url API endpoint for saving
 */
export function startInlineEditArea(elem: HTMLElement, url: string): void {
    if (!elem || elem.querySelector('textarea')) return;

    const old = elem.innerText.trim();

    const ta = document.createElement('textarea');
    ta.className = 'form-control text-bg-dark';
    ta.style.minHeight = '6rem';
    ta.value = old === 'double-click to add description' ? '' : old;
    ta.maxLength = 1999;

    elem.innerHTML = '';
    elem.appendChild(ta);
    ta.focus();

    function restore(val: string): void {
        if (val === 'double-click to add description') val = '';
        elem.innerHTML = val
            ? val.replace(/\n/g, '<br>')
            : '<em class="text-secondary">double-click to add description</em>';
    }

    async function save(): Promise<void> {
        const val = ta.value.trim();
        try {
            await post(url, { description: val });
            restore(val);
            showInlineAlert('success', 'Description updated');
        } catch (err) {
            restore(old);
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', err.message);
        }
    }

    ta.addEventListener('blur', save);
    ta.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && ev.ctrlKey) {
            ev.preventDefault();
            save();
        }
        if (ev.key === 'Escape') {
            restore(old);
            ta.blur();
        }
    });
}

/**
 * Start inline editing for a single-line field
 * @param elem Element to edit
 * @param baseUrl Base API URL for saving
 */
export function startInlineEdit(elem: HTMLElement, baseUrl: string): void {
    if (!elem || elem.querySelector('input')) return;

    disableDnD();

    const field = elem.dataset.edit;           // title | description | maxAssignees
    const id = elem.dataset.id;                // entity ID
    const isTd = elem.nodeName === 'TD';

    let old: string | undefined, countTxt: string | undefined;
    if (isTd && field === 'maxAssignees') {
        // Special handling for maxAssignees in table cells
        const cntSpan = elem.querySelector('[data-count]')!;
        countTxt = cntSpan.textContent?.trim();
        old = elem.querySelector('[data-max]')?.textContent?.trim();
    } else {
        old = elem.textContent?.trim();
    }

    const inp = document.createElement('input');
    inp.className = 'form-control form-control-sm text-bg-dark draggable-false';
    inp.type = field === 'maxAssignees' ? 'number' : 'text';
    inp.value = old || '';
    elem.textContent = '';
    elem.appendChild(inp);
    inp.focus();

    async function save(): Promise<void> {
        const val = inp.value.trim();
        if (val === old) {
            await rollback(old);
            return;
        }
        const url = `${baseUrl}/${id}/${field === 'description' ? 'description' : 'attr'}`;

        try {
            await post(url,
                field === 'description' ? { description: val }
                    : { field, value: val });
            rollback(val);
            showInlineAlert('success', 'Updated');
            if (field === 'maxAssignees') {
                reloadAfterDelay(100);
            }
        } catch (err) {
            await rollback(old);
            // @ts-expect-error TS(2571): Object is of type 'unknown'
            showInlineAlert('error', err.message);
        }
    }

    async function rollback(val?: string): Promise<void> {
        if (isTd && field === 'maxAssignees') {
            const countSpan = elem.querySelector('[data-count]');
            const maxSpan = elem.querySelector('[data-max]');
            if (countSpan && maxSpan) {
                maxSpan.textContent = val || '';
            } else {
                elem.innerHTML = `<span data-count>${countTxt}</span> / <span data-max>${val}</span>`;
            }
        } else {
            elem.textContent = val || '';
        }
        enableDnD();
    }

    inp.addEventListener('blur', save);
    inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            save();
        }
        if (ev.key === 'Escape') rollback(old);
    });
}
