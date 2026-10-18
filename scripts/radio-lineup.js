// Trusty Radio's stations. They work like Trusty TV's channels (scripts/tv-lineup.js): songs play back to back,
// forever, reshuffled each time round, and everyone listening hears the same moment. For each song give its
// YouTube link and its exact length as shown on YouTube ("3:21", or "1:02:03" for long ones). The length matters:
// the schedule is built from it. Videos must allow embedding (it's on by default, but some music videos turn it off).
// The video plays in the radio's window: YouTube's rules don't allow hiding it to play just the sound.

import { LINEUP } from './tv-lineup.js';

// Trusty FM's songs: every Lil Peels song (all five albums, from youtube.com/channel/UCVj1MgGG6hWhMD_pyfaO_pA),
// then a couple by other artists. Add one as { title: 'Song name', link: 'https://youtu.be/…', length: '3:21' }.
// With no songs the station is off the air.
export const FM_LINEUP = [
  // Monkey State of Mind (2020)
  { title: 'Monkey Sheriff', link: 'https://youtu.be/IxqA_Hb8EHE', length: '0:51' },
  { title: 'Big Monkey', link: 'https://youtu.be/0uLAH7HRNoY', length: '1:37' },
  { title: 'Horse Monkey', link: 'https://youtu.be/qavr6_zwGfY', length: '1:19' },
  { title: 'Vibe', link: 'https://youtu.be/I1q7NXplzS0', length: '0:59' },
  { title: 'Cheese Monkey', link: 'https://youtu.be/WuwcDQUBN-Q', length: '1:38' },
  { title: 'Monkey Whip', link: 'https://youtu.be/Yrs0VIxq3TU', length: '1:10' },
  { title: 'Cow Monkey', link: 'https://youtu.be/61Gb-j2wioo', length: '1:24' },
  { title: 'Monkey Duck', link: 'https://youtu.be/lsvScfVqLiQ', length: '1:15' },
  { title: '24 Carrot Monkey', link: 'https://youtu.be/e8pcu9hWILc', length: '1:09' },
  { title: 'Monkey State of Mind', link: 'https://youtu.be/BT34Z0sbcNU', length: '1:45' },
  // DANG. (2020)
  { title: 'Dang Monkey', link: 'https://youtu.be/aPWdiAYXE5o', length: '1:39' },
  { title: 'Corona Monkey', link: 'https://youtu.be/utvnRY8YCHs', length: '1:01' },
  { title: 'BAG', link: 'https://youtu.be/kQyEQUayBeY', length: '1:19' },
  { title: 'Cheese, Beans, and Beer', link: 'https://youtu.be/gJXk8_7Z5Xg', length: '1:01' },
  { title: 'Lil Peels visits the Circus', link: 'https://youtu.be/wIm_R6FUwr4', length: '1:55' },
  { title: 'Meatballs', link: 'https://youtu.be/c4v6p9hpePk', length: '0:51' },
  { title: 'Bush Wants Drugs', link: 'https://youtu.be/-2vmEHZ2rT8', length: '0:52' },
  { title: 'Sexman', link: 'https://youtu.be/jmrHwgTCVUU', length: '1:42' },
  { title: 'Depressed Monkey', link: 'https://youtu.be/IDGVZ6EoqMM', length: '1:25' },
  // Shipwrecked (2023)
  { title: 'Outlaw', link: 'https://youtu.be/r_V7yMVb8Po', length: '2:15' },
  { title: 'Parrot', link: 'https://youtu.be/uwIkpfpkjAU', length: '1:49' },
  { title: 'Cream Cheese Bagel', link: 'https://youtu.be/imHzfhl6q5k', length: '1:35' },
  { title: 'DUI', link: 'https://youtu.be/yD1dbrVwMz4', length: '1:19' },
  { title: 'Rocks', link: 'https://youtu.be/tFz57sNtOnQ', length: '1:27' },
  { title: 'Ice Monkey', link: 'https://youtu.be/nRFPRgMrDy8', length: '2:06' },
  { title: 'The Pirate', link: 'https://youtu.be/4Fgy8Qjo6SQ', length: '3:24' },
  { title: 'Treasure', link: 'https://youtu.be/_2N_NBLzRQA', length: '1:45' },
  { title: 'Freedom', link: 'https://youtu.be/P03QNm4YohE', length: '2:03' },
  // A Very Monkey Christmas (2023)
  { title: 'Christmas Traditions', link: 'https://youtu.be/RhIAL0nKCCU', length: '1:32' },
  { title: 'This Is A Song I Wrote About A Time I Became Santa', link: 'https://youtu.be/KtSRxPIP3yA', length: '1:54' },
  { title: 'That Christmas Magic', link: 'https://youtu.be/geAyyPHhmYI', length: '1:27' },
  { title: 'Christmas Morning, 1897', link: 'https://youtu.be/LywJi7cwYvc', length: '1:51' },
  { title: 'A Peter Griffin and Lil Peels Classic', link: 'https://youtu.be/rkJE-rtWZsE', length: '2:17' },
  { title: 'Epic Rap Battle Lil Peels vs Santa', link: 'https://youtu.be/nLQOxHa4YSs', length: '3:05' },
  { title: 'Lil Peels Presents A Very Monkey Christmas', link: 'https://youtu.be/lFRho-xe6cc', length: '1:24' },
  // Borderline (2024)
  { title: 'Ye Hearty Crew', link: 'https://youtu.be/T2jn6Oczd0g', length: '4:01' },
  { title: 'Unexpected Turns', link: 'https://youtu.be/dLO5Z4uMFSY', length: '3:26' },
  { title: 'CH!PS', link: 'https://youtu.be/xlNT-Cp0gYM', length: '2:59' },
  { title: 'Battle At The Border', link: 'https://youtu.be/jV-cA9DFZPs', length: '4:18' },
  { title: 'Prison Dining', link: 'https://youtu.be/Zohp7utsYws', length: '2:56' },
  { title: 'Secret Tunnel', link: 'https://youtu.be/pwOzy3644qc', length: '3:20' },
  { title: 'The Great Escape', link: 'https://youtu.be/2hr-mMW9gYk', length: '5:45' },
  // Other artists
  { title: 'Lumpy Dog (Dog Eat Dog)', link: 'https://youtu.be/TCjzMdmGudw?si=ceUsRtY9Sgy7_qC5', length: '5:03' },
  // The band's own lyric video of the album track: its auto-generated "Topic" uploads won't play on other sites.
  { title: 'Sunshine Cat (Cherie Pops)', link: 'https://youtu.be/fVfZiBE9kyw', length: '4:32' },
];

// The presets and the dial, low to high. `key` is the page's #hash for that station (e.g. /pages/radio#fm).
// Trusty Talk is Trusty TV's channel 21 on the radio: same lineup, same schedule, so it's always airing the same show.
export const STATIONS = [
  { key: 'talk', frequency: 88.5, name: 'Trusty Talk', lineup: LINEUP },
  { key: 'fm', frequency: 102.1, name: 'Trusty FM', lineup: FM_LINEUP },
];

// The dial's ends (MHz).
export const BAND = { low: 88, high: 108 };
