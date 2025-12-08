/**
 * Test data for clipboard utilities
 * Data-driven test cases for clipboard operations
 */

/**
 * Test cases for copyToClipboard function
 */
export const copyToClipboardData = [
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
