/**
 * Test data for drag-drop.ts
 */

import {deepCopy} from "../helpers/util";

const _tableReorderData = [
    {
        description: 'initializes table reordering with valid config',
        tbodySelector: '.test-tbody',
        apiUrl: '/api/test/reorder',
        rows: [
            { id: '1', name: 'Item 1' },
            { id: '2', name: 'Item 2' },
            { id: '3', name: 'Item 3' },
        ],
    },
    {
        description: 'handles missing tbody element gracefully',
        tbodySelector: '.nonexistent',
        apiUrl: '/api/test/reorder',
        rows: [],
    },
];

export const tableReorderData = () => deepCopy(_tableReorderData) as typeof _tableReorderData;

const _cardReorderData = [
    {
        description: 'initializes card reordering',
        containerClass: 'test-container',
        cardClass: 'test-card',
        apiUrl: '/api/test/reorder-cards',
        cards: [
            { id: 'card-1', content: 'Card 1' },
            { id: 'card-2', content: 'Card 2' },
        ],
    },
];

export const cardReorderData = () => deepCopy(_cardReorderData) as typeof _cardReorderData;
