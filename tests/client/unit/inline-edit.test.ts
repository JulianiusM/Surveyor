/**
 * Tests for inline-edit.ts
 * Data-driven tests for inline editing functionality
 */

import { enableDnD, disableDnD } from '../../../src/public/js/shared/inline-edit';
import { enableDnDData, disableDnDData } from '../data/inlineEditData';
import { getPerms } from '../../../src/public/js/core/permissions';

// Mock permissions
jest.mock('../../../src/public/js/core/permissions');
const mockGetPerms = getPerms as jest.MockedFunction<typeof getPerms>;

describe('inline-edit', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    describe('enableDnD - Data Driven', () => {
        test.each(enableDnDData)('$description', ({ hasPermission, draggableCount, expectedDraggable }) => {
            // Setup DOM
            for (let i = 0; i < draggableCount; i++) {
                const elem = document.createElement('div');
                elem.className = 'draggable';
                document.body.appendChild(elem);
            }

            // Mock permissions
            mockGetPerms.mockReturnValue(
                hasPermission
                    ? { entity: { has: () => true }, item: { has: () => true } }
                    : { entity: { has: () => false }, item: { has: () => false } }
            );

            // Execute
            enableDnD();

            // Verify
            const draggables = document.getElementsByClassName('draggable');
            if (draggableCount === 0) {
                expect(draggables.length).toBe(0);
            } else {
                for (const elem of Array.from(draggables)) {
                    expect((elem as HTMLElement).draggable).toBe(expectedDraggable);
                }
            }
        });
    });

    describe('disableDnD - Data Driven', () => {
        test.each(disableDnDData)('$description', ({ draggableCount }) => {
            // Setup DOM
            for (let i = 0; i < draggableCount; i++) {
                const elem = document.createElement('div');
                elem.className = 'draggable';
                (elem as HTMLElement).draggable = true;
                document.body.appendChild(elem);
            }

            // Execute
            disableDnD();

            // Verify
            const draggables = document.getElementsByClassName('draggable');
            for (const elem of Array.from(draggables)) {
                expect((elem as HTMLElement).draggable).toBe(false);
            }
        });
    });
});
