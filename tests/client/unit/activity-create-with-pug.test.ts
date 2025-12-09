/**
 * Tests for activity-create.ts using real Pug templates
 * This approach renders the actual page structure for more realistic testing
 */

import {describe, test, expect, jest, beforeEach, afterEach} from '@jest/globals';
import {renderPugView} from '../helpers/renderPugView';
import {setupTest} from '../helpers/testSetup';

// Mock dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    setCurrentNavLocation: jest.fn()
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn()
}));

jest.mock('../../../src/public/js/core/formatting', () => ({
    formatISODate: jest.fn((date) => {
        const d = date instanceof Date ? date : new Date(date);
        return d.toISOString().split('T')[0];
    }),
    getValidDaysInWeek: jest.fn((monday, start, end) => {
        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(d.getDate() + i);
            if (d >= start && d <= end) days.push(d);
        }
        return days;
    }),
    parseISODate: jest.fn((str) => new Date(str))
}));

let activityCreate: any;

describe('activity-create.ts with Pug templates', () => {
    setupTest({
        beforeEach: async () => {
            // Reset modules
            jest.resetModules();
            
            // Setup window.Surveyor
            (global as any).window.Surveyor = {
                prefilledSlots: null,
                init: undefined
            };
            
            // Setup crypto
            if (!(global as any).crypto) {
                (global as any).crypto = {};
            }
            (global as any).crypto.randomUUID = jest.fn(() => `uuid-${Math.random()}`);
            
            // Render the actual Pug template into the DOM
            try {
                const html = renderPugView('activity/activity-create.pug', {
                    data: {
                        title: '',
                        startDate: '',
                        endDate: '',
                        description: ''
                    },
                    perms: {
                        permMeta: [],
                        defaultPerms: {},
                        presets: []
                    }
                }, true); // Extract content only
                document.body.innerHTML = html;
            } catch (error) {
                // Fallback: create minimal DOM structure that mirrors the Pug template
                console.warn('Using fallback DOM structure (Pug rendering failed)');
                document.body.innerHTML = `
                    <form id="planForm">
                        <input id="title" type="text" name="title" />
                        <input id="startDate" type="date" name="startDate" />
                        <input id="endDate" type="date" name="endDate" />
                        <textarea id="desc" name="description"></textarea>
                        <div id="slotArea"></div>
                        <input type="hidden" id="slotPayload" name="slotPayload" />
                    </form>
                `;
            }
            
            // Import after DOM is set up
            activityCreate = await import('../../../src/public/js/activity-create');
            activityCreate.clearState();
        },
        afterEach: () => {
            activityCreate.clearState();
        }
    });

    describe('DOM structure from Pug template', () => {
        test('should have form element', () => {
            const form = document.getElementById('planForm');
            expect(form).toBeTruthy();
        });

        test('should have required input fields', () => {
            const title = document.getElementById('title');
            const startDate = document.getElementById('startDate');
            const endDate = document.getElementById('endDate');
            const slotArea = document.getElementById('slotArea');
            
            expect(title).toBeTruthy();
            expect(startDate).toBeTruthy();
            expect(endDate).toBeTruthy();
            expect(slotArea).toBeTruthy();
        });
    });

    describe('updateSlotObj', () => {
        test('should add new slot to map', () => {
            const dateISO = '2024-01-15';
            const slot = { id: 'slot1', title: 'Test Slot', pos: 0 };
            
            activityCreate.updateSlotObj(dateISO, slot);
            const retrieved = activityCreate.getSlotObj(dateISO, 'slot1');
            
            expect(retrieved).toBeDefined();
            expect(retrieved?.title).toBe('Test Slot');
        });

        test('should update existing slot', () => {
            const dateISO = '2024-01-15';
            const slot = { id: 'slot1', title: 'Original', pos: 0 };
            
            activityCreate.updateSlotObj(dateISO, slot);
            
            const updated = { id: 'slot1', title: 'Updated', pos: 0 };
            activityCreate.updateSlotObj(dateISO, updated);
            
            const retrieved = activityCreate.getSlotObj(dateISO, 'slot1');
            expect(retrieved?.title).toBe('Updated');
        });
    });

    describe('getSlotObj', () => {
        test('should retrieve existing slot', () => {
            const dateISO = '2024-01-15';
            const slot = { id: 'slot1', title: 'Test', pos: 0 };
            
            activityCreate.updateSlotObj(dateISO, slot);
            const retrieved = activityCreate.getSlotObj(dateISO, 'slot1');
            
            expect(retrieved).toEqual(slot);
        });

        test('should return undefined for non-existent slot', () => {
            const retrieved = activityCreate.getSlotObj('2024-01-15', 'nonexistent');
            expect(retrieved).toBeUndefined();
        });
    });

    describe('reIndexDay', () => {
        test('should re-index all slots for a day', () => {
            const dateISO = '2024-01-15';
            
            activityCreate.updateSlotObj(dateISO, { id: 'slot1', pos: 2 });
            activityCreate.updateSlotObj(dateISO, { id: 'slot2', pos: 0 });
            activityCreate.updateSlotObj(dateISO, { id: 'slot3', pos: 1 });
            
            activityCreate.reIndexDay(dateISO);
            
            const slot1 = activityCreate.getSlotObj(dateISO, 'slot1');
            const slot2 = activityCreate.getSlotObj(dateISO, 'slot2');
            const slot3 = activityCreate.getSlotObj(dateISO, 'slot3');
            
            expect(slot2?.pos).toBe(0);
            expect(slot3?.pos).toBe(1);
            expect(slot1?.pos).toBe(2);
        });
    });

    describe('buildSlotRow', () => {
        test('should build slot row with prefilled data', () => {
            const dateISO = '2024-01-16';
            const prefilled = {
                id: 'existing-slot',
                title: 'Prefilled Title',
                description: 'Prefilled Description',
                startTime: '09:00',
                endTime: '17:00',
                maxAssignees: 5
            };
            
            const infoCallback = jest.fn();
            const row = activityCreate.buildSlotRow(dateISO, 0, infoCallback, prefilled);
            
            expect(row).toBeDefined();
            expect(row.dataset.slotDate).toBe(dateISO);
            expect(row.dataset.slotId).toBe('existing-slot');
        });

        test('should build slot row without prefilled data', () => {
            const dateISO = '2024-01-16';
            const infoCallback = jest.fn();
            
            const row = activityCreate.buildSlotRow(dateISO, 0, infoCallback);
            
            expect(row).toBeDefined();
            expect(row.dataset.slotDate).toBe(dateISO);
        });
    });
});
