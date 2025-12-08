/**
 * Test data for activity-participants module
 */

export const participantsFilterData = [
    {
        description: 'filters participants by name search',
        search: 'john',
        filter: 'all' as const,
        participants: [
            { name: 'John Doe', assigned: true },
            { name: 'Jane Smith', assigned: false },
            { name: 'Johnny Walker', assigned: true }
        ],
        expected: {
            visible: ['John Doe', 'Johnny Walker'],
            hidden: ['Jane Smith']
        }
    },
    {
        description: 'filters assigned participants only',
        search: '',
        filter: 'assigned' as const,
        participants: [
            { name: 'John Doe', assigned: true },
            { name: 'Jane Smith', assigned: false },
            { name: 'Bob Wilson', assigned: true }
        ],
        expected: {
            visible: ['John Doe', 'Bob Wilson'],
            hidden: ['Jane Smith']
        }
    },
    {
        description: 'filters unassigned participants only',
        search: '',
        filter: 'unassigned' as const,
        participants: [
            { name: 'John Doe', assigned: true },
            { name: 'Jane Smith', assigned: false },
            { name: 'Bob Wilson', assigned: false }
        ],
        expected: {
            visible: ['Jane Smith', 'Bob Wilson'],
            hidden: ['John Doe']
        }
    },
    {
        description: 'combines search and filter (assigned)',
        search: 'jane',
        filter: 'assigned' as const,
        participants: [
            { name: 'John Doe', assigned: true },
            { name: 'Jane Smith', assigned: true },
            { name: 'Janet Lee', assigned: false }
        ],
        expected: {
            visible: ['Jane Smith'],
            hidden: ['John Doe', 'Janet Lee']
        }
    },
    {
        description: 'handles case-insensitive search',
        search: 'JANE',
        filter: 'all' as const,
        participants: [
            { name: 'Jane Doe', assigned: true },
            { name: 'John Smith', assigned: false }
        ],
        expected: {
            visible: ['Jane Doe'],
            hidden: ['John Smith']
        }
    },
    {
        description: 'shows all when no search or filter applied',
        search: '',
        filter: 'all' as const,
        participants: [
            { name: 'Alice', assigned: true },
            { name: 'Bob', assigned: false },
            { name: 'Charlie', assigned: true }
        ],
        expected: {
            visible: ['Alice', 'Bob', 'Charlie'],
            hidden: []
        }
    },
    {
        description: 'handles empty search with whitespace',
        search: '   ',
        filter: 'all' as const,
        participants: [
            { name: 'Alice', assigned: true },
            { name: 'Bob', assigned: false }
        ],
        expected: {
            visible: ['Alice', 'Bob'],
            hidden: []
        }
    },
    {
        description: 'handles partial name matches',
        search: 'mit',
        filter: 'all' as const,
        participants: [
            { name: 'Smith John', assigned: true },
            { name: 'Smithson Jane', assigned: false },
            { name: 'Johnson Bob', assigned: true }
        ],
        expected: {
            visible: ['Smith John', 'Smithson Jane'],
            hidden: ['Johnson Bob']
        }
    }
];

export const participantsInitData = [
    {
        description: 'initializes with no participants',
        hasTab: true,
        participants: [],
        expected: { initialized: false }
    },
    {
        description: 'initializes without tab element',
        hasTab: false,
        participants: [{ name: 'John', assigned: true }],
        expected: { initialized: false }
    },
    {
        description: 'initializes successfully with participants',
        hasTab: true,
        participants: [
            { name: 'Alice', assigned: true },
            { name: 'Bob', assigned: false }
        ],
        expected: { initialized: true }
    }
];
