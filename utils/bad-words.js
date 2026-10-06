// Spots usernames that are worth an admin's look (the Usernames tab of pages/admin.html). Nothing happens to an
// account because of it: a flag only puts the name at the top of that list, so this errs on the side of flagging.
//
// A name is read three ways: as typed, and with look-alikes as letters ("sh1t", "@ss", "b!tch"), taking 1 and |
// as i or as l. Accents are dropped, and so is everything that isn't a letter ("f.u.c.k"). A word also matches
// with its letters stretched out ("fuuuck").
//   ANYWHERE words count even inside other words ("xXfuckXx").
//   ALONE words are short or hide inside harmless ones ("class", "cocktail", "grape"), so they only count as the
//   whole name or a piece of it, split at spaces, punctuation, digits and capitals ("big_ass", "BigAss", "ass69").

const ANYWHERE = [
    // swearing
    'fuck', 'fck', 'fvck', 'phuck', 'fukk', 'motherf', 'shit', 'shyt', 'cunt', 'kunt', 'bitch', 'biatch', 'bastard',
    'asshole', 'arsehole', 'asswipe', 'jackass', 'dumbass', 'dickhead', 'cocksuck', 'wank', 'twat', 'bollock',
    'piss', 'douche', 'skank', 'whore', 'slut',
    // sex
    'penis', 'vagina', 'dildo', 'porn', 'pussy', 'boobs', 'boobies', 'titties', 'titty', 'jizz', 'cumshot', 'cumslut',
    'blowjob', 'handjob', 'rimjob', 'deepthroat', 'gangbang', 'bukkake', 'threesome', 'orgasm', 'erotic', 'hentai',
    'milf', 'dilf', 'nsfw', 'fetish', 'bondage', 'bdsm', 'masturbat', 'ejaculat', 'erection', 'testicle', 'scrotum',
    'nutsack', 'ballsack', 'clit', 'labia', 'queef', 'felch', 'fellatio', 'cunnilingus', 'butthole', 'buttplug',
    'rectum', 'jerkoff', 'sperm', 'shemale', 'yiff', 'onlyfans',
    // abuse
    'rapist', 'molest', 'pedophil', 'paedo', 'incest', 'bestiality', 'beastiality', 'zoophil', 'necrophil',
    // slurs
    'nigger', 'nigga', 'nigg', 'niglet', 'nignog', 'faggot', 'fagg', 'tranny', 'retard', 'kyke', 'wetback', 'beaner',
    'raghead', 'towelhead', 'porchmonkey', 'jigaboo', 'zipperhead', 'chinaman', 'golliwog', 'darkie', 'redskin',
    // hate
    'nazi', 'hitler', 'swastika', 'siegheil', 'whitepower', 'whitepride', 'kkk', 'terrorist', 'alqaeda',
];

const ALONE = [
    'ass', 'asses', 'arse', 'cock', 'cocks', 'dick', 'dicks', 'prick', 'tits', 'boob', 'cum', 'spunk', 'semen', 'sex',
    'sexy', 'anal', 'anus', 'nude', 'nudes', 'naked', 'horny', 'kinky', 'lewd', 'smut', 'orgy', 'pron', 'hoe', 'hoes',
    'thot', 'pimp', 'hooker', 'stripper', 'shag', 'fap', 'cuck', 'boner', 'peen', 'vag', 'crap', 'fuk', 'fuq', 'fag',
    'fags', 'dyke', 'homo', 'spic', 'chink', 'gook', 'coon', 'jap', 'paki', 'wog', 'kaffir', 'kafir', 'squaw', 'honky',
    'spaz', 'midget', 'hymie', 'negro', 'nig', 'niga', 'kike', 'rape', 'raped', 'raping', 'rapey', 'pedo', 'loli',
    'shota', 'nonce', 'heil', 'creampie', 'ecchi',
];

// Harmless words with an ANYWHERE word inside, taken out before looking.
const HARMLESS = ['therapist', 'scunthorpe', 'penistone', 'shitake', 'swank', 'snigger', 'niggl'];

const LOOK_ALIKES = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };

const stretchy = (word) => word.replace(/./g, '$&+'); // "fuck" becomes f+u+c+k+
const INSIDE = ANYWHERE.map((word) => [word, new RegExp(stretchy(word))]);
const WHOLE = ALONE.map((word) => [word, new RegExp(`^${stretchy(word)}$`)]);

const noAccents = (text) => text.normalize('NFKD').replace(/\p{M}/gu, '');
const lettersOnly = (text) => text.replace(/[^a-z]/g, '');

// Lowercase text read as typed, with look-alikes as letters, and the same with 1 and | as l.
function readings(text) {
    const asI = text.replace(/[0-9@$!|+]/g, (c) => LOOK_ALIKES[c] ?? '');
    const asL = text.replace(/[1|]/g, 'l').replace(/[0-9@$!+]/g, (c) => LOOK_ALIKES[c] ?? '');
    return new Set([text, asI, asL].map(lettersOnly));
}

/**
 * The bad words in a username, or [] for a clean one.
 * @param {string} name
 * @returns {string[]}
 */
export function flagWords(name) {
    if (typeof name !== 'string') return [];
    const text = noAccents(name).toLowerCase();
    const found = new Set();
    if (text.includes('1488')) found.add('1488');

    const whole = readings(text);
    for (let reading of whole) {
        for (const ok of HARMLESS) reading = reading.replaceAll(ok, '');
        for (const [word, pattern] of INSIDE) if (pattern.test(reading)) found.add(word);
    }

    const pieces = new Set(whole);
    const parts = noAccents(name).replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').toLowerCase().split(/[^a-z0-9@$!|+]+/);
    for (const part of parts) {
        for (const bit of part.split(/[0-9]+/)) pieces.add(lettersOnly(bit));
        for (const reading of readings(part)) pieces.add(reading);
    }
    for (const piece of pieces) {
        for (const [word, pattern] of WHOLE) if (pattern.test(piece)) found.add(word);
    }
    return [...found];
}
