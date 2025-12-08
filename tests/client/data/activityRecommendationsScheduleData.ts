/**
 * Test data for activity-recommendations-schedule.ts
 */

export const activityRecommendationsScheduleData = {
    initialization: {
        valid: {
            planId: 'plan123',
            panelId: 'recommendationPanel',
            scheduleViewId: 'recommendationScheduleView',
        },
        missing: {
            planId: '',
        },
    },

    recommendations: {
        empty: [],
        pending: [
            {
                id: 'rec1',
                slot: {id: 'slot1', title: 'Morning Shift'},
                user: {id: 1, username: 'john_doe'},
                guest: null,
                status: 'PENDING',
            },
        ],
        approved: [
            {
                id: 'rec2',
                slot: {id: 'slot2', title: 'Afternoon Shift'},
                user: {id: 2, username: 'jane_smith'},
                guest: null,
                status: 'APPROVED',
            },
        ],
        rejected: [
            {
                id: 'rec3',
                slot: {id: 'slot3', title: 'Evening Shift'},
                user: null,
                guest: {id: 1, username: 'guest_user'},
                status: 'REJECTED',
            },
        ],
        mixed: [
            {
                id: 'rec1',
                slot: {id: 'slot1', title: 'Morning Shift'},
                user: {id: 1, username: 'john_doe'},
                guest: null,
                status: 'PENDING',
            },
            {
                id: 'rec2',
                slot: {id: 'slot2', title: 'Afternoon Shift'},
                user: {id: 2, username: 'jane_smith'},
                guest: null,
                status: 'APPROVED',
            },
            {
                id: 'rec3',
                slot: {id: 'slot3', title: 'Evening Shift'},
                user: null,
                guest: {id: 1, username: 'guest_user'},
                status: 'REJECTED',
            },
        ],
    },

    participants: [
        {
            key: 'user:1',
            label: 'John Doe',
            userId: 1,
            guestId: null,
            arrivalDate: '2024-12-14',
            departureDate: '2024-12-17',
        },
        {
            key: 'user:2',
            label: 'Jane Smith',
            userId: 2,
            guestId: null,
            arrivalDate: '2024-12-15',
            departureDate: '2024-12-18',
        },
        {
            key: 'guest:1',
            label: 'Guest User',
            userId: null,
            guestId: 1,
            arrivalDate: null,
            departureDate: null,
        },
    },

    slots: [
        {
            id: 'slot1',
            title: 'Morning Shift',
            day: '2024-12-15',
            startTime: '08:00:00',
            endTime: '12:00:00',
        },
        {
            id: 'slot2',
            title: 'Afternoon Shift',
            day: '2024-12-15',
            startTime: '12:00:00',
            endTime: '16:00:00',
        },
        {
            id: 'slot3',
            title: 'Evening Shift',
            day: '2024-12-16',
            startTime: '16:00:00',
            endTime: '20:00:00',
        },
    },

    addModal: {
        slotId: 'slot1',
        participantValue: 'user:1',
        expectedDuplicate: false,
    },

    apiResponses: {
        loadSuccess: {
            status: 'success',
            data: {
                recommendations: [],
                warnings: [],
                slots: [],
                participantOptions: [],
            },
        },
        loadError: {
            status: 'error',
            message: 'Failed to load recommendations',
        },
        generateSuccess: {
            status: 'success',
            message: 'Recommendations generated',
        },
        applySuccess: {
            status: 'success',
            message: 'Recommendations saved successfully',
        },
        applyError: {
            status: 'error',
            message: 'Failed to save recommendations',
        },
    },

    summaryStats: {
        empty: {
            PENDING: 0,
            APPROVED: 0,
            REJECTED: 0,
        },
        mixed: {
            PENDING: 1,
            APPROVED: 1,
            REJECTED: 1,
        },
    },
};
