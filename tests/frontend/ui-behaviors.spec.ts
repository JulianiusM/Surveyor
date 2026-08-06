import {afterEach, describe, expect, it} from 'vitest';
import {
    createBadge,
    createChip,
    createDietaryChip,
    formatDuration,
    hideSpinner,
    parseJsonScript,
    showSpinner,
    updateToLocalString,
} from '../../src/public/js/shared/ui-helpers';
import {createBadgeCase, createDurationCase} from '../factories/uiHelperFactory';

const originalDocument = globalThis.document;

function installDocument(elements: Record<string, {textContent: string | null}>): void {
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            getElementById: (id: string) => elements[id] ?? null,
        },
    });
}

afterEach(() => {
    Object.defineProperty(globalThis, 'document', {configurable: true, value: originalDocument});
});

describe('frontend UI behavior suite', () => {
    describe('status and label markup', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('renders active statuses as success badges', () => {
            const badgeCase = createBadgeCase();
            expect(createBadge(badgeCase.status, badgeCase.colorMap)).toBe(badgeCase.expectedMarkup);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('renders dangerous statuses as danger badges', () => {
            expect(createBadge('danger')).toBe('<span class="badge text-bg-danger text-uppercase">danger</span>');
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('supports feature-specific badge color maps', () => {
            const badgeCase = createBadgeCase({
                status: 'draft',
                colorMap: {draft: 'info'},
                expectedMarkup: '<span class="badge text-bg-info text-uppercase">draft</span>',
            });
            expect(createBadge(badgeCase.status, badgeCase.colorMap)).toBe(badgeCase.expectedMarkup);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('renders generic chips with the requested Bootstrap variant', () => {
            expect(createChip('Driver', 'primary')).toBe('<span class="badge rounded-pill text-bg-primary me-1">Driver</span>');
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('highlights allergy dietary chips as danger', () => {
            expect(createDietaryChip('ALLERGIES')).toBe('<span class="badge rounded-pill text-bg-danger me-1">ALLERGIES</span>');
        });
    });

    describe('countdown and date presentation', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('formats multi-day durations for registration countdowns', () => {
            const durationCase = createDurationCase();
            expect(formatDuration(durationCase.milliseconds)).toBe(durationCase.expectedLabel);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('labels elapsed registration windows as closed', () => {
            const durationCase = createDurationCase({milliseconds: 0, expectedLabel: 'closed'});
            expect(formatDuration(durationCase.milliseconds)).toBe(durationCase.expectedLabel);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('rolls minutes into hours for compact countdowns', () => {
            expect(formatDuration(90 * 60 * 1000)).toBe('0d 1h 30m');
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('updates an element with localized date text', () => {
            const element = {textContent: ''} as HTMLElement;
            const date = new Date(Date.UTC(2026, 7, 5, 12, 30));

            updateToLocalString(element, date, {dateStyle: 'medium', timeZone: 'UTC'});

            expect(element.textContent).toBe(date.toLocaleString(undefined, {dateStyle: 'medium', timeZone: 'UTC'}));
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('parses date strings before rendering localized text', () => {
            const element = {textContent: ''} as HTMLElement;
            const date = '2026-08-05T12:30:00Z';

            updateToLocalString(element, date, {dateStyle: 'medium', timeZone: 'UTC'});

            expect(element.textContent).toBe(new Date(Date.parse(date)).toLocaleString(undefined, {dateStyle: 'medium', timeZone: 'UTC'}));
        });
    });

    describe('client-rendered JSON and loading feedback', () => {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('reads server-rendered JSON payloads from script tags', () => {
            installDocument({'payload': {textContent: '{"eventId":"event-1","title":"Summer Camp"}'}});

            expect(parseJsonScript<{eventId: string; title: string}>('payload')).toEqual({eventId: 'event-1', title: 'Summer Camp'});
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('returns null when a server-rendered JSON payload is missing', () => {
            installDocument({});

            expect(parseJsonScript('missing')).toBeNull();
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('returns null when a server-rendered JSON payload is invalid', () => {
            installDocument({'payload': {textContent: '{not-json}'}});

            expect(parseJsonScript('payload')).toBeNull();
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('shows button spinners while frontend actions are running', () => {
            const spinner = {classList: {remove: (className: string) => expect(className).toBe('d-none')}};
            const button = {disabled: false, querySelector: () => spinner} as unknown as HTMLButtonElement;

            showSpinner(button);

            expect(button.disabled).toBe(true);
        });

        // Canary: protects a high-value production behavior while avoiding private implementation details.
        it('hides button spinners after frontend actions finish', () => {
            const spinner = {classList: {add: (className: string) => expect(className).toBe('d-none')}};
            const button = {disabled: true, querySelector: () => spinner} as unknown as HTMLButtonElement;

            hideSpinner(button);

            expect(button.disabled).toBe(false);
        });
    });
});
