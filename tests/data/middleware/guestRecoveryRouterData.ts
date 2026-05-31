/**
 * Test data for guestRecoveryRouter middleware tests
 */

export const guestRecoveryData = [
    {
        description: 'GET /:id/guest/recover renders recovery form',
        method: 'get',
        path: '/abc/guest/recover?email=recover%40x',
        expected: {
            status: 200,
            tpl: 'users/recover-guest-links',
            data: {
                entityType: 'activity',
                entityId: 'abc',
                title: 'Plan abc',
                email: 'recover@x',
            },
        },
    },
    {
        description: 'POST /:id/guest/recover sends recovery links and redirects',
        method: 'post',
        path: '/abc/guest/recover',
        body: {email: 'recover@x'},
        expected: {
            status: 302,
            location: '/activity/abc/guest',
            recoveryLinks: [
                'http://app.local/activity/abc/edit/existing-token',
            ],
        },
    },
    {
        description: 'POST /:id/guest/recover validates missing email',
        method: 'post',
        path: '/abc/guest/recover',
        body: {email: ''},
        expected: {
            status: 400,
            kind: 'validation',
            template: 'users/recover-guest-links',
        },
    },
];
