/**
 * Test data for guestFlowFactory middleware tests
 */

export const getCreateRouteData = {
    description: 'GET /create renders create template (no event)',
    method: 'get',
    path: '/create',
    expected: {
        status: 200,
        tpl: 'activity/create',
    },
};

export const postCreateData = [
    {
        description: 'POST /create happy path redirects to buildRedirect',
        method: 'post',
        path: '/create',
        body: {title: 'My Plan'},
        session: {user: {id: 5}},
        expected: {
            status: 302,
            location: '/activity/new-123',
        },
    },
    {
        description: 'POST /create validation error from preprocess',
        method: 'post',
        path: '/create',
        body: {},
        session: {user: {id: 1}},
        configOverrides: {
            preprocessCreate: () => ({error: {msg: 'Bad', data: {a: 1}}}),
        },
        expected: {
            status: 400,
            kind: 'validation',
            template: 'activity/create',
        },
    },
    {
        description: 'POST /create wraps createEntity errors as ValidationError',
        method: 'post',
        path: '/create',
        body: {title: 'x'},
        session: {user: {id: 1}},
        configOverrides: {
            createEntity: async () => {
                throw new Error('boom');
            },
        },
        expected: {
            status: 400,
            kind: 'validation',
            template: 'activity/create',
        },
    },
];

export const guestRegistrationData = [
    {
        description: 'GET /:id/guest renders guest registration unless session present',
        method: 'get',
        path: '/abc/guest',
        expected: {
            status: 200,
            tpl: 'users/register-guest',
            data: {entityType: 'activity', entityId: 'abc', title: 'Plan abc'},
        },
    },
    {
        description: 'POST /:id/guest registers, emails link, redirects to entity',
        method: 'post',
        path: '/abc/guest',
        body: {username: 'guest1', email: 'g@x'},
        expected: {
            status: 302,
            location: '/activity/abc',
            emailLink: 'http://app.local/activity/abc/edit/tok-xyz',
        },
    },
    {
        description: 'POST /:id/guest requires username',
        method: 'post',
        path: '/abc/guest',
        body: {username: '', email: 'g@x'},
        expected: {
            status: 400,
            kind: 'validation',
            template: 'users/register-guest',
        },
    },
];

export const editTokenData = [
    {
        description: 'GET /:id/edit/:token switches to guest on valid token',
        method: 'get',
        path: '/abc/edit/tok-xyz',
        expected: {
            status: 302,
            location: '/activity/abc',
        },
    },
    {
        description: 'GET /:id/edit/:token returns 401 on invalid token',
        method: 'get',
        path: '/abc/edit/bad-token',
        expected: {
            status: 401,
            kind: 'expected',
        },
    },
];

export const duplicateData = {
    description: 'GET /:id/duplicate renders duplicate form',
    method: 'get',
    path: '/abc/duplicate',
    session: {user: {id: 1}},
    expected: {
        status: 200,
        tpl: 'activity/create',
        data: {
            isDuplicate: true,
            title: 'Copy of Plan abc',
            entity: {id: 'abc', title: 'Plan abc'},
            data: {cloned: true},
        },
    },
};

export const deleteData = {
    description: 'POST /:id/delete deletes and redirects to dashboard',
    method: 'post',
    path: '/abc/delete',
    session: {user: {id: 1}},
    expected: {
        status: 302,
        location: '/users/dashboard',
        deleteCalled: true,
    },
};

export const safeZoneData = [
    {
        description: 'SAFE-ZONE: user session passes through and renders view',
        method: 'get',
        path: '/abc',
        session: {user: {id: 99}},
        expected: {
            status: 200,
            tpl: 'activity/view',
            data: {plan: {id: 'abc', title: 'Plan abc'}, x: 1},
        },
    },
    {
        description: 'SAFE-ZONE: guest session ensures link token (create if missing), emails, then renders view',
        method: 'get',
        path: '/abc',
        session: {guest: {id: 77, email: 'g@x'}},
        configOverrides: {
            db: {
                getGuestLinkToken: async () => null,
                createGuestLink: async () => 'new-token',
            },
        },
        expected: {
            status: 200,
            tpl: 'activity/view',
            emailLink: 'http://app.local/activity/abc/edit/new-token',
        },
    },
    {
        description: 'SAFE-ZONE: no session redirects to /:id/guest',
        method: 'get',
        path: '/abc',
        expected: {
            status: 302,
            location: '/activity/abc/guest',
        },
    },
];

export const validationData = {
    description: 'GET /:id returns 400 ValidationError when fetchForView falsy',
    method: 'get',
    path: '/abc',
    session: {user: {id: 1}},
    configOverrides: {
        fetchForView: async () => null,
    },
    expected: {
        status: 400,
        kind: 'validation',
        template: 'activity/view',
    },
};

export const addToEventData = {
    description: 'GET /create with addToEvent uses queryHandler (eventId in data)',
    method: 'get',
    path: '/create?eventId=E1',
    session: {user: {id: 1}},
    configOverrides: {
        addToEvent: true,
    },
    expected: {
        status: 200,
        tpl: 'activity/create',
        data: {eventId: 'E1'},
    },
};
