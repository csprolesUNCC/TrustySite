// Picks out usernames for the admin panel to look at (utils/admin.js, pages/admin.html). A flag only puts a
// name in front of an admin and never blocks anything, so this would rather flag a harmless name than miss
// a bad one.

// Matched anywhere in a name, after `spellings` below has cleaned it up.
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

// Harmless words with one of those inside, taken out of a name before it's checked.
const INNOCENT = [
    'therapist', 'grape', 'drape', 'scrape', 'trapez', 'parapet', 'torpedo', 'pedometer', 'sussex', 'essex',
    'middlesex', 'unisex', 'sextant', 'sextet', 'sexton', 'scunthorpe', 'shitake', 'fuku', 'dickens',
    'dickinson', 'dickson', 'peacock', 'hancock', 'woodcock', 'gamecock', 'shuttlecock', 'cockatoo',
    'cockatiel', 'cockpit', 'cocktail', 'cockroach', 'swank', 'milford', 'retardant', 'montenegro', 'negroni',
    'pakistan', 'vandyke', 'fagan', 'fagin', 'sheila', 'nazir', 'nazia', 'nazim',
];

// Characters people swap in for letters. A 1 could be an i or an l, so names are checked both ways.
const LOOKALIKES = { 0: 'o', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l', '+': 't' };

// The ways a name might spell something: lowercase with accents and look-alikes undone (sh1t, $lut) and
// everything that isn't a letter dropped (f_u.c-k), minus the innocent words.
function spellings(name) {
    const plain = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    return ['i', 'l'].map((one) => {
        let text = '';
        for (const ch of plain) text += ch === '1' ? one : LOOKALIKES[ch] || ch;
        text = text.replace(/[^a-z]/g, '');
        for (const word of INNOCENT) text = text.replaceAll(word, '');
        return text;
    });
}

// Stretched letters (fuuuck) are squeezed back to one each.
const squeeze = (text) => text.replace(/(.)\1+/g, '$1');

/**
 * The bad words in a username.
 * @param {string} name
 * @returns {string[]} The words from WORDS it contains (empty when it's clean).
 */
export function badWordsIn(name) {
    if (typeof name !== 'string') return [];
    const texts = spellings(name).flatMap((text) => [text, squeeze(text)]);
    return WORDS.filter((word) => texts.some((text) => text.includes(word)));
}
