// Trusty's joke of the day, for the speech bubble on the home page. A new joke starts every day at midnight
// Eastern time (the same moment as Trustle's new word), so everybody gets the same one. The list plays in
// order from FIRST_DAY, then starts over.
//
// Add new jokes at the end: putting one earlier changes the joke for every day after it, today's included.

const ZONE = 'America/New_York';
const FIRST_DAY = '2026-10-22';
const DAY = 24 * 60 * 60 * 1000;

// { setup, punchline } — punchline is '' for a one-liner. Keep setup + punchline to 90 characters or the
// bubble spills onto his back on small phones.
export const JOKES = [
  { setup: "Someone called me a pony once.", punchline: "Once." },
  { setup: "Why did I cross the road?", punchline: "To take over the neigh-borhood." },
  { setup: "An eraser walks into a bar.", punchline: "Now there's no bar. Monsters, all of them." },
  { setup: "Do people want me as Overlord?", punchline: "I ran a gallop poll. 100% yes. I counted." },
  { setup: "Mrs. Cabasa told me to find x.", punchline: "Found it. It's in my lair now." },
  { setup: "Why don't I wear stirrups?", punchline: "I'd rather stir up trouble." },
  { setup: "I'm hiring henchmen. Pay is one sugar cube a week.", punchline: "Dental not included." },
  { setup: "People ask me, \"Why the long face?\"", punchline: "It's round. You're thinking of my back." },
  { setup: "Why do I only trust carrots?", punchline: "Ever seen a carrot with an eraser on the end?" },
  { setup: "Slope is rise over run.", punchline: "I rise to power. You run." },
  { setup: "What do you call a horse with no ears?", punchline: "Anything. I can't hear. Unless it's \"pony.\"" },
  { setup: "Step one: conquer the stable.", punchline: "Step two: conquer everything unstable." },
  { setup: "Why is the pencil sharpener my top henchman?", punchline: "Gets right to the point." },
  { setup: "I can't be bribed.", punchline: "Is that a sugar cube? Okay, you can go." },
  { setup: "Will I ever give up on world domination?", punchline: "Neigh." },
  { setup: "Season 2 of my comic went missing.", punchline: "My main suspect is pink and rectangular." },
  { setup: "Why don't I have a mane?", punchline: "I'm already the main character." },
  { setup: "I eat hay because it's free.", punchline: "World domination has a lot of up-front costs." },
  { setup: "Why do I love long division?", punchline: "Divide and conquer." },
  { setup: "Don't call me a pony.", punchline: "Ponies get ridden. I get even." },
  { setup: "Why aren't unicorns on my evil council?", punchline: "They keep poking holes in my plans." },
  { setup: "My doctor says I'm in stable condition.", punchline: "He hasn't seen my evil plans." },
  { setup: "Why did I skip my cousin's wedding?", punchline: "I heard there'd be a bridle party." },
  { setup: "That smudge on my back?", punchline: "Battle scar. You should see the eraser." },
  { setup: "I was drawn during algebra class.", punchline: "That's why I'm always plotting." },
  { setup: "What happens when my hay runs out?", punchline: "That's the last straw. For you." },
  { setup: "I'm not a villain, I'm a visionary.", punchline: "I see you doing all my chores." },
  { setup: "Why don't I have ears?", punchline: "I was drawn in math class. Nobody was listening." },
  { setup: "Sticks and stones may break your bones.", punchline: "I'm made of sticks. Do the math." },
  { setup: "Mrs. Cabasa took my notebook away.", punchline: "Now I'm in the teacher's desk. As planned." },
  { setup: "Who holds my reins?", punchline: "Nobody. I'm too busy planning my reign." },
  { setup: "Why do I hate erasers?", punchline: "They rub me the wrong way. Then they rub me out." },
  { setup: "My future title is Overlord.", punchline: "Current title: Doodle. Small steps." },
  { setup: "Ask me what 2 + 2 is.", punchline: "Clop clop clop clop. Sugar cube, please." },
  { setup: "A unicorn is just a horse with a point to prove.", punchline: "" },
  { setup: "How far will my empire reach?", punchline: "Neigh and far." },
  { setup: "My page got folded into a paper airplane.", punchline: "Every overlord needs an air force." },
  { setup: "I don't trust any vegetable but carrots.", punchline: "Broccoli knows what it did." },
  { setup: "Why did Mrs. Cabasa send me to the principal?", punchline: "Horseplay. Allegedly." },
  { setup: "My back is very long.", punchline: "So turning my back on you takes a while." },
  { setup: "Did I steal Season 2?", punchline: "Please. I'd have stolen all four." },
  { setup: "I don't run from my enemies.", punchline: "I trot. Menacingly." },
  { setup: "Why am I so ambitious?", punchline: "I was drawn with a #2 pencil. I want to be #1." },
  { setup: "Kids walk into math class and say \"hey.\"", punchline: "Every time, I get my hopes up." },
  { setup: "Why is my evil plan written in pen?", punchline: "So the eraser can't touch it." },
  { setup: "Critics call me a one-dimensional villain.", punchline: "Rude. I'm at least two." },
  { setup: "Which vegetable will I never trust?", punchline: "Horseradish. It stole my name." },
  { setup: "A kid said a horse ate his homework.", punchline: "Nobody believed him. I'm still hungry." },
  { setup: "Lined paper looks like jail bars.", punchline: "Stick figures slip right through." },
  { setup: "Mrs. Cabasa keeps a sugar cube on her desk.", punchline: "Smart teacher. She'll be spared." },
];

// The date on a clock in ZONE ('YYYY-MM-DD', which en-CA writes dates as), read back as a UTC midnight.
const zoneDate = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export function jokeOfTheDay(ms = Date.now()) {
  const day = Math.round((Date.parse(zoneDate.format(ms)) - Date.parse(FIRST_DAY)) / DAY);
  return JOKES[((day % JOKES.length) + JOKES.length) % JOKES.length];
}
