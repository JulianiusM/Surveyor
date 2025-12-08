/**
 * Test data for navigation utilities
 * Data-driven test cases for navigation state and highlighting
 */

/**
 * Test cases for setCurrentNavLocation function
 */
export const setCurrentNavLocationData = [
    {
        description: 'sets survey nav link active',
        pathname: '/survey/list',
        expectedSelector: 'a.nav-link[href*="/survey"]',
    },
    {
        description: 'sets packing nav link active',
        pathname: '/packing/123',
        expectedSelector: 'a.nav-link[href*="/packing"]',
    },
    {
        description: 'sets activity nav link active',
        pathname: '/activity/456',
        expectedSelector: 'a.nav-link[href*="/activity"]',
    },
    {
        description: 'sets drivers nav link active',
        pathname: '/drivers/list',
        expectedSelector: 'a.nav-link[href*="/drivers"]',
    },
    {
        description: 'sets dashboard dropdown item active',
        pathname: '/users/dashboard',
        expectedSelector: 'a.dropdown-item[href="/users/dashboard"]',
    },
    {
        description: 'sets manage dashboard dropdown item active',
        pathname: '/users/manage-dashboard',
        expectedSelector: 'a.dropdown-item[href="/users/manage-dashboard"]',
    },
    {
        description: 'sets login nav link active',
        pathname: '/users/login',
        expectedSelector: 'a.nav-link[href="/users/login"]',
    },
    {
        description: 'sets register nav link active',
        pathname: '/users/register',
        expectedSelector: 'a.nav-link[href="/users/register"]',
    },
];

/**
 * Test cases for initEntityLists function
 */
export const initEntityListsData = [
    {
        description: 'filters list items by search query',
        items: [
            { text: 'Apple', dataSearch: 'apple' },
            { text: 'Banana', dataSearch: 'banana' },
            { text: 'Cherry', dataSearch: 'cherry' },
        ],
        searchQuery: 'ban',
        expectedVisible: 1,
    },
    {
        description: 'shows all items when search is empty',
        items: [
            { text: 'Item 1', dataSearch: 'item1' },
            { text: 'Item 2', dataSearch: 'item2' },
            { text: 'Item 3', dataSearch: 'item3' },
        ],
        searchQuery: '',
        expectedVisible: 3,
    },
    {
        description: 'hides items that do not match',
        items: [
            { text: 'Red', dataSearch: 'red' },
            { text: 'Blue', dataSearch: 'blue' },
            { text: 'Green', dataSearch: 'green' },
        ],
        searchQuery: 'yellow',
        expectedVisible: 0,
    },
    {
        description: 'is case insensitive',
        items: [
            { text: 'UPPERCASE', dataSearch: 'uppercase' },
            { text: 'lowercase', dataSearch: 'lowercase' },
        ],
        searchQuery: 'LOWERCASE',
        expectedVisible: 1,
    },
];
