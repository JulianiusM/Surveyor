/**
 * Test data for perm-matrix module
 */

export const permMatrixTestData = {
    selectAll: [
        {
            description: 'selects all checkboxes for audience',
            html: `
                <div class="perm-matrix">
                    <div class="accordion-body">
                        <div class="row" data-aud="public">
                            <input class="perm-box" type="checkbox" value="VIEW" data-bit="1">
                            <input class="perm-box" type="checkbox" value="EDIT" data-bit="2">
                        </div>
                    </div>
                    <button class="perm-select-all" data-aud="public">Select All</button>
                </div>
            `,
            buttonSelector: '.perm-select-all',
            audience: 'public',
            expectedChecked: true
        },
        {
            description: 'clears all checkboxes for audience',
            html: `
                <div class="perm-matrix">
                    <div class="accordion-body">
                        <div class="row" data-aud="participants">
                            <input class="perm-box" type="checkbox" value="VIEW" data-bit="1" checked>
                            <input class="perm-box" type="checkbox" value="EDIT" data-bit="2" checked>
                        </div>
                    </div>
                    <button class="perm-clear" data-aud="participants">Clear</button>
                </div>
            `,
            buttonSelector: '.perm-clear',
            audience: 'participants',
            expectedChecked: false
        }
    ],
    
    presets: [
        {
            description: 'applies preset mask to checkboxes',
            html: `
                <div class="perm-matrix">
                    <div class="accordion-body">
                        <div class="row" data-aud="admins">
                            <input class="perm-box" type="checkbox" value="VIEW" data-bit="1">
                            <input class="perm-box" type="checkbox" value="EDIT" data-bit="2">
                            <input class="perm-box" type="checkbox" value="DELETE" data-bit="4">
                        </div>
                    </div>
                    <button class="perm-preset" data-aud="admins" data-mask="3">View+Edit</button>
                </div>
            `,
            buttonSelector: '.perm-preset',
            audience: 'admins',
            expectedStates: [
                {bit: '1', checked: true},  // 1 & 3 = 1
                {bit: '2', checked: true},  // 2 & 3 = 2
                {bit: '4', checked: false}  // 4 & 3 = 0
            ]
        }
    ],
    
    updates: [
        {
            description: 'collects and posts permission updates',
            html: `
                <div class="perm-matrix" data-field-base="entityPerms">
                    <div class="accordion-body">
                        <div class="row" data-aud="public">
                            <input class="perm-box" type="checkbox" value="VIEW" data-bit="1" checked>
                        </div>
                        <div class="row" data-aud="participants">
                            <input class="perm-box" type="checkbox" value="VIEW" data-bit="1" checked>
                            <input class="perm-box" type="checkbox" value="EDIT" data-bit="2" checked>
                        </div>
                    </div>
                    <button class="btn-perm-update" data-api="/api/entity/123/perms">Update</button>
                </div>
            `,
            buttonSelector: '.btn-perm-update',
            expectedApiUrl: '/api/entity/123/perms',
            expectedPayload: {
                entityPerms: {
                    public: ['VIEW'],
                    participants: ['VIEW', 'EDIT']
                }
            }
        }
    ]
};
