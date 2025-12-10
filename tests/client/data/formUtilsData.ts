/**
 * Test data for form utilities
 * Data-driven test cases for form manipulation
 */

import {deepCopy} from "../helpers/util";

/**
 * Test cases for getSelectValues function
 */
const _getSelectValuesData = [
    {
        description: 'gets single selected value',
        options: [
            { value: 'opt1', text: 'Option 1', selected: true },
            { value: 'opt2', text: 'Option 2', selected: false },
        ],
        expected: ['opt1'],
    },
    {
        description: 'gets multiple selected values',
        options: [
            { value: 'opt1', text: 'Option 1', selected: true },
            { value: 'opt2', text: 'Option 2', selected: true },
            { value: 'opt3', text: 'Option 3', selected: false },
        ],
        expected: ['opt1', 'opt2'],
    },
    {
        description: 'returns empty array when nothing selected',
        options: [
            { value: 'opt1', text: 'Option 1', selected: false },
            { value: 'opt2', text: 'Option 2', selected: false },
        ],
        expected: [],
    },
    {
        description: 'uses text when value is empty',
        options: [
            { value: '', text: 'Option 1', selected: true },
        ],
        expected: ['Option 1'],
    },
];

export const getSelectValuesData = () => deepCopy(_getSelectValuesData) as typeof _getSelectValuesData;

/**
 * Test cases for objectToArray function
 */
const _objectToArrayData = [
    {
        description: 'converts simple object',
        input: { a: 1, b: 2, c: 3 },
        expectedKeys: ['a', 'b', 'c'],
        expectedValues: [1, 2, 3],
    },
    {
        description: 'sorts keys alphabetically',
        input: { z: 26, a: 1, m: 13 },
        expectedKeys: ['a', 'm', 'z'],
        expectedValues: [1, 13, 26],
    },
    {
        description: 'handles empty object',
        input: {},
        expectedKeys: [],
        expectedValues: [],
    },
    {
        description: 'handles mixed value types',
        input: { num: 42, str: 'text', bool: true },
        expectedKeys: ['bool', 'num', 'str'],
        expectedValues: [true, 42, 'text'],
    },
];

export const objectToArrayData = () => deepCopy(_objectToArrayData) as typeof _objectToArrayData;

/**
 * Test cases for serializeForm function
 */
const _serializeFormData = [
    {
        description: 'serializes simple form',
        fields: [
            { name: 'username', value: 'john' },
            { name: 'email', value: 'john@example.com' },
        ],
        expected: {
            username: 'john',
            email: 'john@example.com',
        },
    },
    {
        description: 'serializes empty form',
        fields: [],
        expected: {},
    },
    {
        description: 'handles multiple input types',
        fields: [
            { name: 'text', value: 'sample', type: 'text' },
            { name: 'number', value: '42', type: 'number' },
        ],
        expected: {
            text: 'sample',
            number: '42',
        },
    },
];

export const serializeFormData = () => deepCopy(_serializeFormData) as typeof _serializeFormData;
