/**
 * Test data for DOM utilities
 * Data-driven test cases for DOM query and manipulation
 */

import {deepCopy} from "../helpers/util";

/**
 * Test cases for querySelector operations
 */
const _querySelectorData = [
    {
        description: 'finds element by ID',
        html: '<div id="test-id">Content</div>',
        selector: '#test-id',
        expectedContent: 'Content',
    },
    {
        description: 'finds element by class',
        html: '<div class="test-class">Content</div>',
        selector: '.test-class',
        expectedContent: 'Content',
    },
    {
        description: 'finds nested element',
        html: '<div><span class="nested">Nested</span></div>',
        selector: '.nested',
        expectedContent: 'Nested',
    },
    {
        description: 'returns null for non-existent selector',
        html: '<div>Content</div>',
        selector: '.non-existent',
        expectedContent: null,
    },
];

export const querySelectorData = () => deepCopy(_querySelectorData) as typeof _querySelectorData;

/**
 * Test cases for querySelectorAll operations
 */
const _querySelectorAllData = [
    {
        description: 'finds multiple elements',
        html: '<div class="item">1</div><div class="item">2</div><div class="item">3</div>',
        selector: '.item',
        expectedCount: 3,
    },
    {
        description: 'returns empty array for no matches',
        html: '<div>Content</div>',
        selector: '.non-existent',
        expectedCount: 0,
    },
    {
        description: 'finds all list items',
        html: '<ul><li>A</li><li>B</li><li>C</li></ul>',
        selector: 'li',
        expectedCount: 3,
    },
];

export const querySelectorAllData = () => deepCopy(_querySelectorAllData) as typeof _querySelectorAllData;

/**
 * Test cases for closest operations
 */
const _closestData = [
    {
        description: 'finds closest parent',
        html: '<div class="parent"><div class="child"><span id="target">Text</span></div></div>',
        startSelector: '#target',
        closestSelector: '.parent',
        expectedClass: 'parent',
    },
    {
        description: 'finds immediate parent',
        html: '<div class="parent"><span id="target">Text</span></div>',
        startSelector: '#target',
        closestSelector: '.parent',
        expectedClass: 'parent',
    },
    {
        description: 'returns null when no match',
        html: '<div class="parent"><span id="target">Text</span></div>',
        startSelector: '#target',
        closestSelector: '.non-existent',
        expectedClass: null,
    },
];

export const closestData = () => deepCopy(_closestData) as typeof _closestData;
