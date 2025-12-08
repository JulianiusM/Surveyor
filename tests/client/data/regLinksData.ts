/**
 * Test data for reg-links module
 */

export const regLinksTestData = {
    initialization: [
        {
            description: 'renders empty state when no links exist',
            html: `
                <div class="reg-links" data-event-id="123" data-api-list="/api/event/123/reg-links">
                    <div class="js-count">0</div>
                    <table><tbody class="js-rows"></tbody></table>
                </div>
            `,
            apiData: [],
            apiUrl: '/api/event/123/reg-links',
            expectApiCall: true,
            expectedCount: 0,
            expectedEmptyMessage: true,
            expectedRowCount: 0
        },
        {
            description: 'renders link rows when links exist',
            html: `
                <div class="reg-links" data-event-id="123" data-api-list="/api/event/123/reg-links">
                    <div class="js-count">0</div>
                    <table><tbody class="js-rows"></tbody></table>
                </div>
            `,
            apiData: [
                {
                    id: '1',
                    token: 'abc123',
                    createdAt: '2024-01-01T10:00:00Z',
                    expiresAt: '2024-12-31T23:59:59Z',
                    status: 'active'
                },
                {
                    id: '2',
                    token: 'def456',
                    createdAt: '2024-01-02T10:00:00Z',
                    expiresAt: '2024-12-31T23:59:59Z',
                    status: 'active'
                }
            ],
            apiUrl: '/api/event/123/reg-links',
            expectApiCall: true,
            expectedCount: 2,
            expectedEmptyMessage: false,
            expectedRowCount: 2
        },
        {
            description: 'renders revoked link with disabled buttons',
            html: `
                <div class="reg-links" data-event-id="123" data-api-list="/api/event/123/reg-links">
                    <div class="js-count">0</div>
                    <table><tbody class="js-rows"></tbody></table>
                </div>
            `,
            apiData: [
                {
                    id: '1',
                    token: 'abc123',
                    createdAt: '2024-01-01T10:00:00Z',
                    expiresAt: '2024-12-31T23:59:59Z',
                    status: 'revoked'
                }
            ],
            apiUrl: '/api/event/123/reg-links',
            expectApiCall: true,
            expectedCount: 1,
            expectedRowCount: 1
        }
    ],
    
    creation: [
        {
            description: 'creates new registration link with valid input',
            html: `
                <div class="reg-links" data-event-id="123" data-api-create="/api/event/123/reg-links" data-api-list="/api/event/123/reg-links">
                    <div class="js-count">0</div>
                    <table><tbody class="js-rows"></tbody></table>
                    <div id="createModal">
                        <input type="number" value="5">
                        <input type="datetime-local" value="2024-12-31T23:59">
                        <button class="btn-create-submit" data-modal="#createModal">Create</button>
                    </div>
                </div>
            `,
            buttonSelector: '.btn-create-submit',
            createApiUrl: '/api/event/123/reg-links',
            expectedPayload: {maxUses: 5},
            createResponse: {id: '1', token: 'new-token-123'},
            refreshResponse: [{id: '1', token: 'new-token-123', status: 'active'}],
            expectCreateCall: true,
            expectCopyCall: true,
            expectRefresh: true
        },
        {
            description: 'creates link without expiration date',
            html: `
                <div class="reg-links" data-event-id="123" data-api-create="/api/event/123/reg-links" data-api-list="/api/event/123/reg-links">
                    <div class="js-count">0</div>
                    <table><tbody class="js-rows"></tbody></table>
                    <div id="createModal">
                        <input type="number" value="10">
                        <input type="datetime-local" value="">
                        <button class="btn-create-submit" data-modal="#createModal">Create</button>
                    </div>
                </div>
            `,
            buttonSelector: '.btn-create-submit',
            createApiUrl: '/api/event/123/reg-links',
            expectedPayload: {maxUses: 10},
            createResponse: {id: '2', token: 'another-token'},
            refreshResponse: [],
            expectCreateCall: true,
            expectCopyCall: true,
            expectRefresh: true
        }
    ],
    
    copying: [
        {
            description: 'copies active link URL to clipboard',
            html: `
                <div class="reg-links" data-event-id="123">
                    <table>
                        <tbody class="js-rows">
                            <tr data-id="1">
                                <td><button class="btn-copy" data-url="http://localhost:3000/event/123?regToken=abc123">Copy</button></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `,
            buttonSelector: '.btn-copy',
            expectedUrl: 'http://localhost:3000/event/123?regToken=abc123'
        },
        {
            description: 'copies link with encoded event ID',
            html: `
                <div class="reg-links" data-event-id="test event">
                    <table>
                        <tbody class="js-rows">
                            <tr data-id="1">
                                <td><button class="btn-copy" data-url="http://localhost:3000/event/test%20event?regToken=token">Copy</button></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `,
            buttonSelector: '.btn-copy',
            expectedUrl: 'http://localhost:3000/event/test%20event?regToken=token'
        }
    ],
    
    revocation: [
        {
            description: 'revokes link when user confirms',
            html: `
                <div class="reg-links" data-event-id="123" data-api-revoke="/api/event/123/reg-links" data-api-list="/api/event/123/reg-links">
                    <table>
                        <tbody class="js-rows">
                            <tr data-id="1">
                                <td><button class="btn-revoke">Revoke</button></td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="js-count">1</div>
                </div>
            `,
            buttonSelector: '.btn-revoke',
            confirmResult: true,
            expectedDeleteUrl: '/api/event/123/reg-links/1',
            refreshResponse: [],
            expectSuccessAlert: true
        },
        {
            description: 'does not revoke link when user cancels',
            html: `
                <div class="reg-links" data-event-id="123" data-api-revoke="/api/event/123/reg-links" data-api-list="/api/event/123/reg-links">
                    <table>
                        <tbody class="js-rows">
                            <tr data-id="1">
                                <td><button class="btn-revoke">Revoke</button></td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="js-count">1</div>
                </div>
            `,
            buttonSelector: '.btn-revoke',
            confirmResult: false,
            expectedDeleteUrl: '/api/event/123/reg-links/1',
            refreshResponse: []
        }
    ],
    
    errorHandling: [
        {
            description: 'handles API error on initial load',
            html: `
                <div class="reg-links" data-event-id="123" data-api-list="/api/event/123/reg-links">
                    <table><tbody class="js-rows"></tbody></table>
                    <div class="js-count">0</div>
                </div>
            `,
            errorOn: 'get',
            errorMessage: 'Failed to fetch links'
        },
        {
            description: 'handles API error on link creation',
            html: `
                <div class="reg-links" data-event-id="123" data-api-create="/api/event/123/reg-links" data-api-list="/api/event/123/reg-links">
                    <table><tbody class="js-rows"></tbody></table>
                    <div class="js-count">0</div>
                    <div id="createModal">
                        <input type="number" value="5">
                        <input type="datetime-local" value="">
                        <button class="btn-create-submit" data-modal="#createModal">Create</button>
                    </div>
                </div>
            `,
            errorOn: 'post',
            errorMessage: 'Creation failed',
            triggerAction: true,
            triggerSelector: '.btn-create-submit'
        },
        {
            description: 'handles API error on link revocation',
            html: `
                <div class="reg-links" data-event-id="123" data-api-revoke="/api/event/123/reg-links" data-api-list="/api/event/123/reg-links">
                    <table>
                        <tbody class="js-rows">
                            <tr data-id="1">
                                <td><button class="btn-revoke">Revoke</button></td>
                            </tr>
                        </tbody>
                    </table>
                    <div class="js-count">1</div>
                </div>
            `,
            errorOn: 'delete',
            errorMessage: 'Revoke failed',
            triggerAction: true,
            triggerSelector: '.btn-revoke'
        }
    ]
};
