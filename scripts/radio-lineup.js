// Trusty Radio's stations. They work like Trusty TV's channels (scripts/tv-lineup.js): songs play back to back,
// forever, reshuffled each time round, and everyone listening hears the same moment. For each song give its
// YouTube link and its exact length as shown on YouTube ("3:21", or "1:02:03" for long ones). The length matters:
// the schedule is built from it. Videos must allow embedding (it's on by default, but some music videos turn it off).
// The video plays in the radio's window: YouTube's rules don't allow hiding it to play just the sound.

import { LINEUP } from './tv-lineup.js';

// Trusty FM's songs, e.g. { title: 'Song name', link: 'https://youtu.be/…', length: '3:21' }.
// While it's empty the station is off the air.
export const FM_LINEUP = [];

// The presets and the dial, low to high. `key` is the page's #hash for that station (e.g. /pages/radio#fm).
// Trusty Talk is Trusty TV's channel 21 on the radio: same lineup, same schedule, so it's always airing the same show.
export const STATIONS = [
  { key: 'talk', frequency: 88.5, name: 'Trusty Talk', lineup: LINEUP },
  { key: 'fm', frequency: 102.1, name: 'Trusty FM', lineup: FM_LINEUP },
];

// The dial's ends (MHz).
export const BAND = { low: 88, high: 108 };
