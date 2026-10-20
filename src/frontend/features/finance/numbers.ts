/** Preserve invoice amounts and factors while a wheel gesture scrolls their
 * page/dialog. Passive capture runs before native number-input wheel stepping. */
export function protectFinanceNumberFromScroll(event: WheelEvent): void {
    const input = event.target;
    // Forms explicitly install this shared behavior; neither a portal nor the
    // native frontend is needed to discover the owning numeric control.
    if (input instanceof HTMLInputElement && input.type === 'number' && document.activeElement === input) input.blur();
}
