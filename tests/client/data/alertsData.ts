/**
 * Test data for alerts utilities
 * Data-driven test cases for alert/notification system
 */

/**
 * Test cases for showInlineAlert function
 */
export const showInlineAlertData = [
    {
        description: 'creates success alert',
        input: {
            status: 'success' as const,
            message: 'Operation successful!',
        },
        expectedClass: 'alert-success',
        expectedMessage: 'Operation successful!',
    },
    {
        description: 'creates info alert',
        input: {
            status: 'info' as const,
            message: 'Information message',
        },
        expectedClass: 'alert-info',
        expectedMessage: 'Information message',
    },
    {
        description: 'creates error alert',
        input: {
            status: 'error' as const,
            message: 'Error occurred',
        },
        expectedClass: 'alert-danger',
        expectedMessage: 'Error occurred',
    },
];
