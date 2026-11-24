// A pretend hunt for tools/dev-server.mjs and tools/smoke.mjs, so the Hayloft, Trusty TV's intermissions and
// Trusty Radio's dead air can be looked at locally. Nothing here is the real hunt: that's only ever imported on
// the admin panel (see utils/hunt-rules.js), never committed, because this repo is public.
//   Door:   /h/sample-door
//   Radio:  95.5 on Trusty Radio (answer: SAMPLE RADIO)
//   Shares: answer SAMPLE SHARES
//   Map:    the key is every answer in order; the coordinates are COORDS.

export const SAMPLE_DOOR = 'sample-door';
export const COORDS = { lat: 35.22709, lng: -80.84313 };

export const SAMPLE_HUNT = {
  title: 'The Pretend Hayloft',
  rewards: { stage: 1000, first: 25000, finder: 5000 },
  signal: {
    ms: 450,
    every: 4,
    cards: [
      { channel: 'trusty', mark: 'I', text: 'SAMP' },
      { channel: 'snn', mark: 'II', text: 'LEDO' },
      { channel: 'spongebob', mark: 'III', text: 'OR' },
    ],
    hints: [{ day: 0, text: 'This is the pretend hunt from tools/sample-hunt.mjs.' }],
  },
  door: SAMPLE_DOOR,
  stages: [
    {
      id: 'radio', title: 'Dead Air', day: 0,
      body: [
        'This is where a real page of the notebook would go.',
        { h: 'A heading' },
        'Tune Trusty Radio to 95.5 to hear the pretend broadcast.',
      ],
      radio: { mhz: 95.5, lines: ['Pretend station calling.', 'One. Two. Three.', 'Repeat.'] },
      hints: [{ day: 0, text: 'A pretend hint.' }],
      answer: 'sample radio',
    },
    {
      id: 'shares', title: 'Share Text', day: 0,
      body: ['Something that has to keep its spacing:', { pre: 'Trustle #1 3/6\n\n⬛🟨⬛⬛⬛\n🟩⬛🟩⬛⬛\n🟩🟩🟩🟩🟩' }],
      answer: 'sample shares',
    },
  ],
  final: { title: 'The Map', day: 0, body: ['The pretend map.'], radius: 30, note: 'In real life, this says where the box is hidden.' },
  coords: COORDS,
};
