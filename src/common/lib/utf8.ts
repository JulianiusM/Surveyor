/** Count UTF-8 bytes without changing the entered text, shared by runtime policy and generated validators. */
export function utf8ByteLength(value: string): number {
    // TextEncoder is available in both supported runtimes. No trimming, Unicode
    // normalization, hashing or character-category policy belongs to this measurement.
    return new TextEncoder().encode(value).byteLength;
}
