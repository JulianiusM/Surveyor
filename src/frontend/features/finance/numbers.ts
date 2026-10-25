/** Preserve invoice amounts and factors while a wheel gesture scrolls their
 * page/dialog. Passive capture runs before native number-input wheel stepping. */
export function protectFinanceNumberFromScroll(event: WheelEvent): void {
    const input = event.target;
    // Forms install this shared behavior directly; the event target identifies
    // the owning numeric control without a document-level registry.
    if (input instanceof HTMLInputElement && input.type === 'number' && document.activeElement === input) input.blur();
}

/** Normalize decimal transport spelling without rounding an edited amount.
 * Numeric inputs may contain exponents or leading zeroes; their visible draft
 * stays untouched while the command receives ordinary decimal notation. */
export function financeDecimal(value: string, fractionDigits?: number): string {
    const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/iu.exec(value);
    if (!match || !(match[2] || match[3]) || !Number.isFinite(Number(value))) return value;

    // Remove insignificant mantissa zeroes before bounding expansion. A large
    // exponent can balance an equally long mantissa and still denote ordinary
    // finite input; bounding the exponent alone would reject that value.
    const rawDigits = match[2] + (match[3] ?? '');
    if (!/[1-9]/u.test(rawDigits) || fractionDigits !== undefined && Number(value) === 0) {
        // Zero accepts any exponent. Factors also retain the native number
        // control's zero meaning after numeric underflow, without expanding an
        // arbitrarily distant decimal point into an unbounded temporary string.
        return fractionDigits === undefined ? '0' : `0.${'0'.repeat(fractionDigits)}`;
    }
    const exponent = Number(match[4] ?? 0);
    const leadingZeroes = rawDigits.length - rawDigits.replace(/^0+/u, '').length;
    const digits = rawDigits.slice(leadingZeroes).replace(/0+$/u, '');
    const point = match[2].length + exponent - leadingZeroes;

    // Bound only added zeroes around the retained significant digits. Every
    // nonzero finite native number fits this window; excessive underflow money
    // remains invalid instead of requiring unbounded exponent expansion.
    if (!Number.isSafeInteger(point) || point < -324 || point > 309) return value;
    const expanded = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
        : point >= digits.length ? digits + '0'.repeat(point - digits.length)
            : `${digits.slice(0, point)}.${digits.slice(point)}`;
    const [whole, fraction = ''] = expanded.split('.');
    const integer = whole.replace(/^0+(?=\d)/u, '');
    let decimal = fraction.replace(/0+$/u, '');

    // Factors have one canonical four-place representation. Excess meaningful
    // precision is deliberately retained so validation rejects rather than rounds.
    if (fractionDigits !== undefined && decimal.length <= fractionDigits) decimal = decimal.padEnd(fractionDigits, '0');
    const negative = match[1] === '-' && /[1-9]/u.test(integer + decimal);
    return `${negative ? '-' : ''}${integer}${decimal ? `.${decimal}` : ''}`;
}
