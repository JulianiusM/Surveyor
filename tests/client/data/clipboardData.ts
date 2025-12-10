/**
 * Test data for clipboard utilities
 * Data-driven test cases for clipboard operations
 */

import {deepCopy} from "../helpers/util";

/**
 * Test cases for copyToClipboard function
 */
const _copyToClipboardData = [
    {
        description: 'copies simple text',
        input: { text: 'Hello, World!' },
        expected: 'Hello, World!',
    },
    {
        description: 'copies multiline text',
        input: { text: 'Line 1\nLine 2\nLine 3' },
        expected: 'Line 1\nLine 2\nLine 3',
    },
    {
        description: 'copies empty string',
        input: { text: '' },
        expected: '',
    },
    {
        description: 'copies text with special characters',
        input: { text: 'Special: !@#$%^&*()' },
        expected: 'Special: !@#$%^&*()',
    },
    {
        description: 'copies URL',
        input: { text: 'https://example.com/path?query=value' },
        expected: 'https://example.com/path?query=value',
    },
];

export const copyToClipboardData = () => deepCopy(_copyToClipboardData) as typeof _copyToClipboardData;
