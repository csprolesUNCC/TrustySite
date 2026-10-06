// Picks out usernames for the admin panel to look at (utils/admin.js, pages/admin.html). A flag only puts a
// name in front of an admin and never blocks anything, so this would rather flag a harmless name than miss
// a bad one.

// Matched anywhere in a name, after `spellings` below has cleaned it up. Their letters can also be written
// more than once (fuuuck, shiit), except for the words in EXACT.
const WORDS = [
    // swearing
    'fuck', 'fuk', 'fck', 'shit', 'bitch', 'biatch', 'cunt', 'bastard', 'asshole', 'arsehole', 'asshat',
    'asswipe', 'dumbass', 'jackass', 'fatass', 'smartass', 'dick', 'cock', 'pussy', 'twat', 'wank',
    'douche', 'whore', 'slut',
    // sexual
    'sex', 'porn', 'penis', 'vagina', 'dildo', 'boner', 'horny', 'tits', 'titty', 'tittie', 'jizz', 'milf',
    'hentai', 'nude', 'rape', 'rapist', 'molest', 'pedo', 'incest',
    // slurs and hate
    'nigg', 'negro', 'fag', 'retard', 'tranny', 'shemale', 'dyke', 'lesbo', 'chink', 'gook', 'kike', 'paki',
    'beaner', 'wetback', 'towelhead', 'raghead', 'nazi', 'hitler', 'heil', 'kkk',
    // other
    'killyourself',
];

// Only matched as written: with a letter doubled they spell harmless words (rapper, trapped, speedo, Bonner).
const EXACT = new Set(['rape', 'pedo', 'boner']);

// Harmless words with one of those inside, taken out of a name before it's checked.
const INNOCENT = [
    'therapist', 'grape', 'drape', 'scrape', 'trapez', 'parapet', 'torpedo', 'pedometer', 'sussex', 'essex',
    'middlesex', 'unisex', 'sextant', 'sextet', 'sexton', 'scunthorpe', 'shitake', 'shiitake', 'fukuoka',
    'fukushima', 'fukuda', 'fukui', 'dickens', 'dickinson', 'dickson', 'peacock', 'hancock', 'hitchcock',
    'woodcock', 'gamecock', 'shuttlecock', 'cockatoo', 'cockatiel', 'cocker', 'cockpit', 'cocktail', 'cockroach',
    'swank', 'thorny', 'milford', 'retardant', 'montenegro', 'negroni', 'pakistan', 'vandyke', 'fagan', 'fagin',
    'sheila', 'nazir', 'nazia', 'nazim',
];

// Characters people swap in for letters, including Cyrillic and Greek letters that look like Latin ones.
const LOOKALIKES = {
    0: 'o', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'l', '+': 't',
    а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i',
    ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ɡ: 'g',
    α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
};
// These could be either of two letters (a capital I passes for an l), so a name is spelled out twice: once
// with every first letter here, once with every second.
const EITHER = { 1: ['i', 'l'], 6: ['g', 'b'], I: ['i', 'l'] };

// The two ways a name might spell something: lowercase with accents and look-alikes undone (sh1t, $lut,
// Cyrillic letters) and everything that isn't a letter dropped (f_u.c-k), minus the innocent words.
function spellings(name) {
    const chars = [...name.normalize('NFKD').replace(/\p{M}/gu, '')];
    return [0, 1].map((pick) => {
        let text = '';
        for (const ch of chars) {
            const lower = ch.toLowerCase();
            text += EITHER[ch] ? EITHER[ch][pick] : LOOKALIKES[lower] || lower;
        }
        text = text.replace(/[^a-z]/g, '');
        return INNOCENT.reduce((rest, word) => rest.replaceAll(word, ''), text);
    });
}

// A word as a pattern that also matches its letters written more than once: "nigg" matches "niiggg".
const stretched = (word) => new RegExp(word.replace(/(.)\1*/g, (run, ch) => `${ch}{${run.length},}`));
const PATTERNS = WORDS.map((word) => [word, EXACT.has(word) ? new RegExp(word) : stretched(word)]);

/**
 * The bad words in a username.
 * @param {string} name
 * @returns {string[]} The words from WORDS it contains (empty when it's clean), plus 'text-direction trick'
 *   when it has characters that make it show in a different order than it's spelled (and checked).
 */
export function badWordsIn(name) {
    if (typeof name !== 'string') return [];
    const texts = spellings(name);
    const found = PATTERNS.filter(([, pattern]) => texts.some((text) => pattern.test(text))).map(([word]) => word);
    if (/\p{Bidi_Control}/u.test(name)) found.push('text-direction trick');
    return found;
}
