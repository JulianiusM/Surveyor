/**
 * Root property dialog. Server-rendered fields define the editable contract; this module never
 * invents permissions or submits fields belonging to omitted sections. Existing feature commands
 * retain their handlers and acquire this dialog's draft/feedback/pending host through ui-helpers.
 */
import type {EntityCommand, EntityCommandHost} from '../../../types/EntityPropertyTypes';
import {assertSuccessfulResponse, post} from '../core/http';
import {showInlineAlert} from '../shared/alerts';
import {hideSpinner, registerEntityCommandHost, reloadAfterDelay, showSpinner} from '../shared/ui-helpers';

type DraftControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const initialized = new WeakSet<HTMLElement>();

/** Filter drafts, not picker search UI: only the saved relationship is part of an event-link edit. */
function draftControls(section: HTMLElement): DraftControl[] {
    let selector = 'input, select, textarea';
    if (section.dataset.entitySection === 'event') selector = 'input[name="event_id"]';
    // Inline selectors mirror a named hidden field. That field is the single draft value;
    // including their dynamically hydrated presentation controls would create false edits.
    if (section.dataset.entitySection === 'properties') selector = 'input[name], select[name], textarea[name]';
    const controls: DraftControl[] = [];
    for (const control of section.querySelectorAll<DraftControl>(selector)) {
        // Audience navigation and picker search change presentation, not the saved permission mask.
        // Components mark those controls explicitly rather than making the host know their markup.
        if (!control.hasAttribute('data-entity-draft-ignore')) controls.push(control);
    }
    return controls;
}

/** A stable primitive representation makes checkbox and text drafts comparable without serializing DOM. */
function controlValue(control: DraftControl): string {
    if (control instanceof HTMLInputElement && control.type === 'checkbox') return String(control.checked);
    return control.value;
}

function snapshot(section: HTMLElement): string {
    return JSON.stringify(draftControls(section).map(controlValue));
}

/**
 * Native constraint validation must be able to focus the offending field. Property families may
 * be collapsed, so open its ancestor details before invoking the browser's standard error UI.
 * The form uses novalidate only to let this handler reveal those ancestors first.
 */
function reportPropertyValidity(form: HTMLFormElement): boolean {
    const invalid = form.querySelector<HTMLElement>(':invalid');
    let parent = invalid?.parentElement;
    while (parent && parent !== form) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
    }
    return form.reportValidity();
}

/** Reset also informs inline selectors, whose visible choice mirrors a hidden submission field. */
function resetSection(section: HTMLElement, originals: Map<DraftControl, string>): void {
    for (const control of draftControls(section)) {
        const original = originals.get(control);
        if (original === undefined) continue;
        if (control instanceof HTMLInputElement && control.type === 'checkbox') {
            control.checked = original === 'true';
        } else {
            // Hidden inputs reflect .value into their defaultValue attribute. Keep the initial
            // saved value separately so picker edits can still be discarded on close.
            control.value = control instanceof HTMLInputElement && control.type === 'file' ? '' : original;
        }
        control.dispatchEvent(new Event('change', {bubbles: true}));
    }
}

class EntityPropertyDialog implements EntityCommandHost {
    private readonly sections: HTMLElement[];
    private readonly originals = new Map<HTMLElement, string>();
    private readonly originalControlValues = new Map<DraftControl, string>();
    private readonly propertyValues = new Map<string, string>();
    private readonly disabledControls = new Map<HTMLButtonElement | DraftControl, boolean>();
    private pending = false;
    private leaving = false;

    constructor(private readonly modal: HTMLElement) {
        // Capture authoritative saved values once, including hidden selector fields. Switching tabs
        // never recaptures them: each section's unsaved state must survive navigation independently.
        this.sections = Array.from(modal.querySelectorAll<HTMLElement>('[data-entity-section]'));
        for (const section of this.sections) {
            this.originals.set(section, snapshot(section));
            for (const control of draftControls(section)) this.originalControlValues.set(control, controlValue(control));
        }
        const form = modal.querySelector<HTMLFormElement>('[data-property-form]');
        if (form) {
            for (const control of form.querySelectorAll<DraftControl>('[name]')) {
                this.propertyValues.set(control.name, controlValue(control));
            }
        }
        registerEntityCommandHost(modal, this);
        modal.addEventListener('submit', this.handleSubmit);
        modal.addEventListener('click', this.handleNavigation);
        modal.addEventListener('hide.bs.modal', this.handleClose);
        modal.addEventListener('hidden.bs.modal', this.resetDrafts);
        window.addEventListener('beforeunload', this.handleUnload);
    }

    private isDirty(section: HTMLElement): boolean {
        return snapshot(section) !== this.originals.get(section);
    }

    private feedback(control: Element): HTMLElement | undefined {
        // Shared commands do not know which panel hosts them. Resolve the nearest draft section so
        // a denied image/admin/archive operation reports beside the control that initiated it.
        return control.closest('[data-entity-section]')?.querySelector<HTMLElement>('[data-command-feedback]')
            ?? this.modal.querySelector<HTMLElement>('[data-dialog-feedback]') ?? undefined;
    }

    reportError(control: Element, error: unknown): void {
        showInlineAlert('error', error instanceof Error ? error.message : 'Could not save the change.', this.feedback(control));
    }

    /** A refresh affects every section. Explicitly resolve other drafts before sending any write. */
    private discardOtherDrafts(current?: HTMLElement | null): boolean {
        const dirty: HTMLElement[] = [];
        for (const section of this.sections) {
            if (section !== current && this.isDirty(section)) dirty.push(section);
        }
        if (!dirty.length) return true;
        if (!window.confirm('Other sections have unsaved changes. Discard those changes and continue?')) return false;
        for (const section of dirty) resetSection(section, this.originalControlValues);
        return true;
    }

    begin(control: HTMLButtonElement): EntityCommand | null {
        if (this.pending || control.disabled) return null;
        const section = control.closest<HTMLElement>('[data-entity-section]');
        if (!this.discardOtherDrafts(section)) return null;
        this.pending = true;
        this.modal.setAttribute('aria-busy', 'true');
        // Freeze the submitted draft until the response arrives: editing during the refresh window
        // would otherwise lose new input after a successful write. Preserve pre-existing disabled state.
        for (const input of this.modal.querySelectorAll<HTMLButtonElement | DraftControl>('button, input, select, textarea')) {
            this.disabledControls.set(input, input.disabled);
            input.disabled = true;
        }
        showSpinner(control);
        const host = this;
        return {
            success(message: string, redirectUrl?: string): void {
                showInlineAlert('success', message, host.feedback(control));
                host.leaving = true;
                // Re-render permissions, event admission, and inherited archival together. Updating
                // individual fields locally would leave other sections with stale authority or state.
                if (redirectUrl) window.location.assign(redirectUrl);
                else reloadAfterDelay(500);
            },
            error(error: unknown): void {
                host.reportError(control, error);
                hideSpinner(control);
                for (const [input, disabled] of host.disabledControls) input.disabled = disabled;
                host.disabledControls.clear();
                host.modal.removeAttribute('aria-busy');
                host.pending = false;
            },
        };
    }

    private readPropertyChanges(form: HTMLFormElement): Record<string, string> {
        // The initial named-field map was generated from server-authorized controls. Exclude omitted
        // fields entirely; sending unchanged defaults could overwrite a later edit or require a grant
        // that this narrowly delegated editor does not possess.
        const payload: Record<string, string> = {};
        for (const control of form.querySelectorAll<DraftControl>('[name]')) {
            if (control.disabled || !this.propertyValues.has(control.name)) continue;
            if (controlValue(control) === this.propertyValues.get(control.name)) continue;
            payload[control.name] = control instanceof HTMLInputElement && control.type === 'checkbox'
                ? (control.checked ? 'on' : 'off') : control.value;
        }
        // Changing a time zone applies to the displayed local deadline, while unrelated saves omit
        // both values and preserve the persisted instant. The server validates the zone and instant.
        if ('deadlineTz' in payload) {
            const deadline = form.elements.namedItem('bindingDeadline') as HTMLInputElement | null;
            if (deadline) payload.bindingDeadline = deadline.value;
        }
        return payload;
    }

    private handleSubmit = async (event: Event): Promise<void> => {
        const form = event.target as HTMLFormElement;
        if (!form.matches('[data-property-form], [data-event-link-form], [data-entity-delete-form]')) return;
        if (form.matches('[data-entity-delete-form]')) {
            if (this.pending || !window.confirm('Permanently delete this entity and its contents? This cannot be undone.') || !this.discardOtherDrafts()) {
                event.preventDefault();
            } else {
                this.leaving = true;
            }
            return;
        }
        event.preventDefault();
        const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
        if (!button || !reportPropertyValidity(form)) return;
        let payload: Record<string, unknown>;
        if (form.matches('[data-event-link-form]')) {
            const selected = form.querySelector<HTMLInputElement>('input[name="event_id"]')?.value || null;
            const expected = form.dataset.currentEventId || null;
            if (selected === expected) {
                showInlineAlert('info', 'The linked event is unchanged.', this.feedback(button));
                return;
            }
            if (!window.confirm('Change the linked event? Access and archival will follow the new context. Existing records and assignments are kept; generated pending assignment suggestions will be refreshed.')) return;
            payload = {eventId: selected, expectedEventId: expected};
        } else {
            payload = this.readPropertyChanges(form);
            if (!Object.keys(payload).length) {
                showInlineAlert('info', 'There are no property changes to save.', this.feedback(button));
                return;
            }
        }
        const command = this.begin(button);
        if (!command) return;
        try {
            const response = await post(form.dataset.api!, payload);
            assertSuccessfulResponse(response);
            command.success(response.message || 'Changes saved.', response.data?.redirectUrl);
        } catch (error) {
            command.error(error);
        }
    };

    private handleNavigation = (event: MouseEvent): void => {
        const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[data-entity-navigation]');
        if (!link) return;
        // Exports and modified clicks leave the draft's page open. Do not discard its edits or
        // suppress its later unload warning simply because a second tab was opened.
        if (link.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        if (this.pending || !this.discardOtherDrafts()) event.preventDefault();
        else this.leaving = true;
    };

    private handleClose = (event: Event): void => {
        if (this.pending) event.preventDefault();
    };

    private resetDrafts = (): void => {
        // Closing abandons edits in every panel, not only the currently visible tab. Dispatching
        // change from resetSection refreshes component labels while retaining the saved snapshots.
        for (const section of this.sections) resetSection(section, this.originalControlValues);
        for (const alert of this.modal.querySelectorAll<HTMLElement>('[data-command-feedback], [data-dialog-feedback]')) alert.replaceChildren();
    };

    private handleUnload = (event: BeforeUnloadEvent): void => {
        if (this.leaving) return;
        for (const section of this.sections) {
            if (this.isDirty(section)) {
                event.preventDefault();
                event.returnValue = '';
                return;
            }
        }
    };
}

/** Called from the existing page entries; pages without authorized controls need no initialization. */
export function initEntityProperties(): void {
    const modal = document.getElementById('entityPropertiesModal');
    if (!modal || initialized.has(modal)) return;
    initialized.add(modal);
    new EntityPropertyDialog(modal);
}
