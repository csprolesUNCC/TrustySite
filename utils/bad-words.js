// Words that get a username flagged on the admin page (pages/admin.html, via utils/moderation.js). A flag
// only puts the name at the top of the list for an admin to look at; it never changes an account.
//
// Names are checked after undoing the usual disguises: accents, look-alike letters from other alphabets,
// numbers and symbols for letters (5h1t, a$$), separators (f.u.c.k) and stretched letters (fuuuck).

// Flagged wherever they show up in a name, even run together with other words ("xXfuckXx").
const ANYWHERE = [
    'fuck', 'fuk', 'fck', 'fvck', 'phuck', 'shit', 'cunt', 'bitch', 'biatch', 'whore', 'slut', 'skank',
    'bastard', 'twat', 'wank', 'damn', 'piss', 'asshole', 'arsehole', 'asshat', 'dumbass', 'jackass',
    'dickhead', 'cocksucker', 'butthole', 'buttplug', 'pussy', 'penis', 'vagina', 'clit', 'dildo', 'porn',
    'hentai', 'jizz', 'boob', 'tits', 'titty', 'titties', 'nipple', 'testicle', 'scrotum', 'ballsack',
    'nutsack', 'blowjob', 'handjob', 'rimjob', 'cumshot', 'gangbang', 'deepthroat', 'orgasm', 'milf', 'nude',
    'bollock', 'bellend', 'molest', 'pedophile', 'paedophile', 'retard', 'nigger', 'nigga', 'faggot',
    'tranny', 'dyke', 'kike', 'chink', 'gook', 'wetback', 'beaner', 'nazi', 'hitler', 'swastika', 'kkk',
    'killyourself',
];

// Short words that hide inside ordinary ones (class, hello, cocktail, therapist), so they're only flagged
// as a word of their own in the name: "Big_Ass", "BigAss" or "ass69", but not "Glass".
const ON_THEIR_OWN = [
    'ass', 'arse', 'anal', 'anus', 'cock', 'dick', 'cum', 'sex', 'tit', 'hell', 'crap', 'rape', 'rapist',
    'pedo', 'paedo', 'fag', 'homo', 'coon', 'negro', 'heil', 'kys', 'thot', 'hoe', 'prick', 'horny', 'orgy',
    'boner', 'semen', 'sperm',
];
// Endings a word of its own can still have ("asses", "sexy").
const ENDINGS = '(?:s|es|y|ie|ies|ing|z)?';

// Numbers and symbols used as letters. 1 and | can be an i or an l, so names are checked both ways.
const LEET = { 0: 'o', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '+': 't' };
// Cyrillic and Greek letters that look like Latin ones.
const LOOKALIKES = {
    а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i',
    ј: 'j', ѕ: 's', ԁ: 'd', ɡ: 'g', α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p',
    τ: 't', υ: 'u', χ: 'x',
};

// "ass" becomes a+s{2,}: any letter can be stretched, but a doubled letter has to stay doubled.
const stretchy = (word) => word.replace(/(.)\1*/g, (run, letter) => (run.length > 1 ? `${letter}{${run.length},}` : `${letter}+`));

const anywhere = ANYWHERE.map((word) => [word, new RegExp(stretchy(word))]);
const onTheirOwn = ON_THEIR_OWN.map((word) => [word, new RegExp(`^${stretchy(word)}${ENDINGS}$`)]);

// Lowercase a-z only, with the disguises undone ("Sh1t!" → "shiti"). `one` is the letter 1 and | stand for.
function squash(text, one) {
    let out = '';
    for (const ch of text.normalize('NFKD').toLowerCase()) {
        const letter = ch === '1' || ch === '|' ? one : LEET[ch] || LOOKALIKES[ch] || ch;
        if (letter >= 'a' && letter <= 'z') out += letter;
    }
    return out;
}

// The words a name is made of: split at spaces, punctuation and capitals ("BigTruck", "big_truck"), and
// again with numbers as breaks too ("truck2000"), since numbers can also be letters ("a55").
function wordsIn(name) {
    const spaced = name.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
    return [...spaced.split(/[^\p{L}\p{N}@$!|+]+/u), ...spaced.split(/[^\p{L}]+/u)];
}

/**
 * @param {string} name - A username.
 * @returns {string[]} The words from the lists above found in it (empty if none).
 */
export function badWordsIn(name) {
    if (typeof name !== 'string' || !name) return [];
    const found = new Set();
    for (const one of ['i', 'l']) {
        const whole = squash(name, one);
        for (const [word, pattern] of anywhere) {
            if (pattern.test(whole)) found.add(word);
        }
        const words = [whole, ...wordsIn(name).map((w) => squash(w, one))];
        for (const [word, pattern] of onTheirOwn) {
            if (words.some((w) => pattern.test(w))) found.add(word);
        }
    }
    return [...found];
}
