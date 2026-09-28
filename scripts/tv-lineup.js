// Trusty TV's channels and their lineups. Shows play back to back, forever, and everyone watching sees the
// same moment, like real TV. For each show give its YouTube link and its exact length as shown on YouTube
// ("10:35", or "1:02:03" for long ones). The length matters: the schedule is built from it.
// Videos must allow embedding (it's on by default, but some music videos turn it off).

export const LINEUP = [
  { title: 'Among Us and Giraffe', link: 'https://youtu.be/RVlvK8WCnJs?si=ufDyzMpTzW_O7A7y', length: '3:46' },
  { title: 'The Bounty Hunter', link: 'https://youtu.be/Wyemnk-20vw?si=8zWIlwBwHBcb0oaA', length: '4:44' },
  { title: 'The Last Bit of Whiskey', link: 'https://youtu.be/fyVfnF81CKA?si=f0gDN1URCjX9PbtC', length: '2:35' },
  { title: 'Battle of Pharsalus', link: 'https://youtu.be/ndPANVl3xQw?si=DMMPCtenCO1-0d3p', length: '10:30' },
  { title: 'Joe Mama Campaign Ad', link: 'https://youtu.be/AZkeNyEm8AU?si=YJPy_0ApPd9ZM6Pf', length: '1:30' },
  { title: 'P • A • L • S', link: 'https://youtu.be/VzLsAnyTN1A?si=VjaL88JU2tPldMnc', length: '11:53' },
  { title: 'Jason and the Golden Belt', link: 'https://youtu.be/XYCBW8dHmns?si=X3FbD8QgH_dQvvul', length: '2:30' },
  { title: 'iVial', link: 'https://youtu.be/rfA04CM2TPI?si=pDtDiuRjctR2GDET', length: '2:01' },
  { title: 'Romeo and Juliet', link: 'https://youtu.be/6Y1W_3-QEh4?si=9uLCY3h7u2J6WP43', length: '6:55' },
  { title: 'The F.O.I.L. Way', link: 'https://youtu.be/jpYaEyM5d4g?si=KS5gxg78y4W9nubi', length: '3:06' },
  { title: '30,000 Bits Trailer', link: 'https://youtu.be/MlrfqSZlcjA?si=xzNplaGi1q5T_ZK8', length: '1:07' },
];

// Stallion News Network: QGHS news and announcements from the Digital Media and Marketing class
// (youtube.com/@stallionnewsnetwork676).
export const SNN_LINEUP = [
  { title: 'SNN S1 Ep1', link: 'https://youtu.be/sr__Os-QZBI', length: '4:27' },
  { title: 'SNN S1 Ep2', link: 'https://youtu.be/N8T6g0z8hg8', length: '4:02' },
  { title: 'SNN S1 Ep3', link: 'https://youtu.be/ZCIF-koma34', length: '4:41' },
  { title: 'SNN S1 Ep4', link: 'https://youtu.be/3vvc0kIYSo8', length: '4:09' },
  { title: 'SNN S1 Ep5', link: 'https://youtu.be/oxwiAQ1y7aQ', length: '2:56' },
  { title: 'SNN S1 Ep6', link: 'https://youtu.be/YEK5QgOEnvg', length: '3:15' },
  { title: 'SNN S1 Ep7: Halloween Special', link: 'https://youtu.be/-pA6fR4WBbU', length: '5:51' },
  { title: 'SNN S2 Ep1', link: 'https://youtu.be/Fs1_WoJIWPs', length: '5:43' },
  { title: 'SNN S2 Ep2: Thanksgiving Special', link: 'https://youtu.be/13aNS7lGMFc', length: '7:23' },
  { title: 'SNN S2 Ep3: Christmas Special', link: 'https://youtu.be/XJW0RdRjCiY', length: '14:58' },
  { title: 'SNN S3 Ep1', link: 'https://youtu.be/ZiJOI5ihEgI', length: '5:49' },
  { title: 'SNN S3 Ep2', link: 'https://youtu.be/Q6Butuk7_nE', length: '2:46' },
  { title: 'SNN S3 Ep3', link: 'https://youtu.be/7dQsVk2fc6w', length: '3:05' },
  { title: 'SNN S3 Ep4', link: 'https://youtu.be/1SOjl9ZLTo0', length: '4:00' },
  { title: 'A Day in Digital Media Class', link: 'https://youtu.be/41UovMNTJ9M?si=zJHQR_LkS5GGqXBe', length: '17:53' },
];

// SpongeBob SquarePants Official's Season 2 marathon. One video, so it just loops.
export const SPONGEBOB_LINEUP = [
  { title: 'SpongeBob: Every Episode from Season 2', link: 'https://youtu.be/CdrhLFYV2xo', length: '3:29:41' },
];

// The channel knob flips through these in order. `key` is the page's #hash for that channel (e.g. /pages/tv#snn).
export const CHANNELS = [
  { key: 'trusty', number: 21, name: 'Trusty TV', lineup: LINEUP },
  { key: 'snn', number: 22, name: 'SNN', fullName: 'Stallion News Network', lineup: SNN_LINEUP },
  { key: 'spongebob', number: 23, name: 'SpongeBob', lineup: SPONGEBOB_LINEUP },
];
