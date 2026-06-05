/**
 * Tests for activity-participants module
 */

import {initParticipantsTab} from '../../../src/public/js/modules/activity/activity-participants';
import {participantsFilterData, participantsInitData} from '../data/activityParticipantsData';
import { setupTest } from '../helpers/testSetup';

describe('activity-participants module', () => {
    setupTest();

    describe('initParticipantsTab', () => {
        test.each(participantsInitData())('$description', (testCase) => {
            if (testCase.hasTab) {
                const html = `
                    <div id="tab-participants">
                        <input type="text" id="participant-search" />
                        <button data-participant-filter="all">All</button>
                        <button data-participant-filter="assigned">Assigned</button>
                        <button data-participant-filter="unassigned">Unassigned</button>
                        <table>
                            <tbody>
                                ${testCase.participants.map(p => `
                                    <tr data-participant-row data-participant-name="${p.name}" data-participant-assigned="${p.assigned ? '1' : '0'}">
                                        <td>${p.name}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
                document.body.innerHTML = html;
            }

            initParticipantsTab();

            if (testCase.expected.initialized) {
                const searchInput = document.getElementById('participant-search');
                expect(searchInput).toBeInTheDocument();
            } else {
                // Function should return early without crashing
                expect(true).toBe(true);
            }
        });

        test.each(participantsFilterData())('$description', (testCase) => {
            const html = `
                <div id="tab-participants">
                    <input type="text" id="participant-search" value="${testCase.search}" />
                    <button data-participant-filter="all" class="${testCase.filter === 'all' ? 'active' : ''}">All</button>
                    <button data-participant-filter="assigned" class="${testCase.filter === 'assigned' ? 'active' : ''}">Assigned</button>
                    <button data-participant-filter="unassigned" class="${testCase.filter === 'unassigned' ? 'active' : ''}">Unassigned</button>
                    <table>
                        <tbody>
                            ${testCase.participants.map(p => `
                                <tr data-participant-row data-participant-name="${p.name}" data-participant-assigned="${p.assigned ? '1' : '0'}">
                                    <td>${p.name}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            document.body.innerHTML = html;

            initParticipantsTab();

            // Trigger the search
            const searchInput = document.querySelector<HTMLInputElement>('#participant-search');
            if (searchInput) {
                searchInput.value = testCase.search;
                searchInput.dispatchEvent(new Event('input'));
            }

            // Trigger the filter
            const filterBtn = document.querySelector<HTMLButtonElement>(`[data-participant-filter="${testCase.filter}"]`);
            if (filterBtn) {
                filterBtn.click();
            }

            // Verify visible participants
            testCase.expected.visible.forEach(name => {
                const row = Array.from(document.querySelectorAll<HTMLTableRowElement>('[data-participant-row]'))
                    .find(r => r.dataset.participantName === name);
                expect(row).toBeDefined();
                expect(row?.classList.contains('d-none')).toBe(false);
            });

            // Verify hidden participants
            testCase.expected.hidden.forEach(name => {
                const row = Array.from(document.querySelectorAll<HTMLTableRowElement>('[data-participant-row]'))
                    .find(r => r.dataset.participantName === name);
                expect(row).toBeDefined();
                expect(row?.classList.contains('d-none')).toBe(true);
            });
        });

        test('handles missing filter buttons gracefully', () => {
            document.body.innerHTML = `
                <div id="tab-participants">
                    <input type="text" id="participant-search" />
                    <table>
                        <tbody>
                            <tr data-participant-row data-participant-name="Test" data-participant-assigned="1">
                                <td>Test</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;

            initParticipantsTab();

            const searchInput = document.querySelector<HTMLInputElement>('#participant-search');
            expect(searchInput).toBeInTheDocument();
        });

        test('handles missing search input gracefully', () => {
            document.body.innerHTML = `
                <div id="tab-participants">
                    <button data-participant-filter="all">All</button>
                    <table>
                        <tbody>
                            <tr data-participant-row data-participant-name="Test" data-participant-assigned="1">
                                <td>Test</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;

            initParticipantsTab();

            const filterBtn = document.querySelector<HTMLButtonElement>('[data-participant-filter="all"]');
            expect(filterBtn).toBeInTheDocument();
        });
    });
});
