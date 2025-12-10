import {post} from "../core/http";
import {showInlineAlert} from "../shared/alerts";
import {reloadAfterDelay} from "../shared/ui-helpers";
import {requireEntityPerm} from "../core/permissions";
import type {BootstrapGlobal, BootstrapModal} from "./activity-types";

interface ModalParts {
    modal: BootstrapModal;
    form: HTMLFormElement;
    title: HTMLInputElement;
    text: HTMLTextAreaElement;
    idInput: HTMLInputElement;
}

function getBootstrap(): BootstrapGlobal | undefined {
    return (window as any).bootstrap as BootstrapGlobal;
}

function getModal(): ModalParts | null {
    const bootstrap = getBootstrap();
    const modalEl = document.getElementById('textFieldModal');
    const form = document.getElementById('textFieldForm') as HTMLFormElement | null;
    const title = document.getElementById('textFieldTitle') as HTMLInputElement | null;
    const text = document.getElementById('textFieldText') as HTMLTextAreaElement | null;
    const idInput = document.getElementById('textFieldId') as HTMLInputElement | null;
    if (!bootstrap?.Modal || !modalEl || !form || !title || !text || !idInput) return null;
    return {modal: new bootstrap.Modal(modalEl), form, title, text, idInput};
}

function openModal(parts: ModalParts, mode: 'create' | 'edit', data?: {id?: string; title?: string; text?: string}): void {
    const heading = document.getElementById('textFieldModalTitle');
    if (heading) heading.textContent = mode === 'create' ? 'Add text field' : 'Edit text field';
    parts.title.value = data?.title ?? '';
    parts.text.value = data?.text ?? '';
    parts.idInput.value = data?.id ?? '';
    parts.modal.show();
}

async function save(parts: ModalParts, planId: string): Promise<void> {
    const id = parts.idInput.value;
    const url = id ? `/api/activity/${planId}/text-field/${id}` : `/api/activity/${planId}/text-field`;
    try {
        await post(url, {title: parts.title.value.trim(), text: parts.text.value});
        showInlineAlert('success', 'Saved');
        parts.modal.hide();
        reloadAfterDelay(150);
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to save text field';
        showInlineAlert('error', msg);
    }
}

export function initTextFields(planId: string): void {
    const parts = getModal();
    if (!parts) return;

    const addBtn = document.getElementById('addTextFieldBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => openModal(parts, 'create'));
    }

    document.querySelectorAll<HTMLElement>('.text-field-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            openModal(parts, 'edit', {
                id: btn.dataset.textFieldId,
                title: btn.dataset.title,
                text: btn.dataset.content,
            });
        });
    });

    document.querySelectorAll<HTMLElement>('.text-field-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.textFieldId;
            if (!id) return;
            if (!confirm('Delete this text field?')) return;

            try {
                requireEntityPerm('MANAGE_PERMISSIONS', 'delete shared text fields');
                await post(`/api/activity/${planId}/text-field/${id}/delete`, {});
                showInlineAlert('success', 'Text field deleted');
                reloadAfterDelay(150);
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Failed to delete text field';
                showInlineAlert('error', msg);
            }
        });
    });

    parts.form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        void save(parts, planId);
    });
}
