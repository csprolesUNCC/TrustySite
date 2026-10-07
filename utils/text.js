// Plain text written on the site (profile bios, the home page's Latest Update): no control characters or
// text-direction tricks, Unix line breaks, no spaces at the ends of lines, and at most one blank line in a row.
export function cleanText(text) {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/(?!\n)[\p{Cc}\p{Bidi_Control}]/gu, '')
        .replace(/[^\S\n]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
