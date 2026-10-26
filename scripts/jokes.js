// Trusty's joke of the day, for the speech bubble on the home page. A new joke starts every day at midnight
// Eastern time (the same moment as Trustle's new word), so everybody gets the same one. The list plays in
// order from FIRST_DAY, then starts over.
//
// Add new jokes at the end: putting one earlier changes the joke for every day after it, today's included.

const ZONE = 'America/New_York';
const FIRST_DAY = '2026-10-26';
const DAY = 24 * 60 * 60 * 1000;

// { setup, punchline } — punchline is '' for a one-liner. Keep setup + punchline to 90 characters or the
// bubble spills onto his back on small phones.
export const JOKES = [
  { setup: "What do you call a pony with a sore throat?", punchline: "A little hoarse." },
  { setup: "Why did the scarecrow win an award?", punchline: "He was outstanding in his field." },
  { setup: "What do you call cheese that isn't yours?", punchline: "Nacho cheese." },
  { setup: "Why don't horses ever eat soup?", punchline: "Because of the stairs." },
  { setup: "Why can't a bicycle stand up on its own?", punchline: "It's two tired." },
  { setup: "What did the horse say when it fell down?", punchline: "\"I've fallen and I can't giddyup!\"" },
  { setup: "What do you call a fake noodle?", punchline: "An impasta." },
  { setup: "Why don't eggs tell jokes?", punchline: "They'd crack each other up." },
  { setup: "What did the paper say to the pencil?", punchline: "Write on!" },
  { setup: "Why did the math book look so sad?", punchline: "It had too many problems." },
  { setup: "What did the left shoe say to the clock?", punchline: "Nothing. It's a door." },
  { setup: "What's a horse's favorite sport?", punchline: "Stable tennis." },
  { setup: "What did the ocean say to the beach?", punchline: "Nothing. It just waved." },
  { setup: "Why don't skeletons fight each other?", punchline: "They don't have the guts." },
  { setup: "What's brown and sticky?", punchline: "A stick." },
  { setup: "How do you make a horse laugh?", punchline: "Fold it twice." },
  { setup: "What did the zero say to the eight?", punchline: "Nice belt!" },
  { setup: "What kind of horses go out after dark?", punchline: "Nightmares." },
  { setup: "What do you call a bear with no teeth?", punchline: "A gummy bear." },
  { setup: "Why did the cookie go to the doctor?", punchline: "It was feeling crummy." },
  { setup: "Why did the picture go to jail?", punchline: "It was framed." },
  { setup: "What's orange and sounds like a parrot?", punchline: "A carrot." },
  { setup: "How do you organize a space party?", punchline: "You planet." },
  { setup: "What's the difference between a duck?", punchline: "One of its legs is both the same." },
  { setup: "What did the mother horse say to her foal?", punchline: "It's pasture bedtime." },
  { setup: "Why are fish so smart?", punchline: "They live in schools." },
  { setup: "I was going to tell a joke about a broken pencil.", punchline: "But it's pointless." },
  { setup: "Why did the mailman get fired?", punchline: "He kept spelling fence with a K." },
  { setup: "What do you call a dinosaur that's sleeping?", punchline: "A dino-snore." },
  { setup: "Why did the tomato turn red?", punchline: "It saw the salad dressing." },
  { setup: "What do you call a horse that lives next door?", punchline: "Your neigh-bor." },
  { setup: "Why don't scientists trust atoms?", punchline: "They make up everything." },
  { setup: "What did one wall say to the other wall?", punchline: "\"Meet you at the corner.\"" },
  { setup: "What do you call a horse with three legs?", punchline: "A Tuesday." },
  { setup: "Why did the banana go to the doctor?", punchline: "It wasn't peeling well." },
  { setup: "What do you call a dog that does magic tricks?", punchline: "A labracadabrador." },
  { setup: "Why did the horse chew with its mouth open?", punchline: "Bad stable manners." },
  { setup: "Why was six afraid of seven?", punchline: "Because seven eight nine." },
  { setup: "What do you call a belt made of watches?", punchline: "A waist of time." },
  { setup: "Why did the student bring a ladder to school?", punchline: "She wanted to go to high school." },
  { setup: "What do you call a deer with no eyes?", punchline: "No idea." },
  { setup: "Why did the cow cross the road?", punchline: "To get to the udder side." },
  { setup: "What's red and smells like blue paint?", punchline: "Red paint." },
  { setup: "Why can't you trust stairs?", punchline: "They're always up to something." },
  { setup: "What do you call a snowman in July?", punchline: "A puddle." },
  { setup: "Why can't horses dance?", punchline: "They have two left feet." },
  { setup: "What do you call a can opener that doesn't work?", punchline: "A can't opener." },
  { setup: "Why did the cow go to space?", punchline: "To return the ladder." },
  { setup: "Why was the computer cold?", punchline: "It left its Windows open." },
  { setup: "What kind of tree fits in your hand?", punchline: "A palm tree." },
  { setup: "Why don't oysters share their pearls?", punchline: "They're shellfish." },
  { setup: "What do you call a horse that loves arts and crafts?", punchline: "A hobby horse." },
  { setup: "What do you call an alligator in a vest?", punchline: "An investigator." },
  { setup: "Why did the coffee call the police?", punchline: "It got mugged." },
  { setup: "What has two legs and wears a tie?", punchline: "Exactly." },
  { setup: "What did the triangle say to the circle?", punchline: "\"You're pointless.\"" },
  { setup: "What do you call a pig that does karate?", punchline: "A pork chop." },
  { setup: "How does the moon get a haircut?", punchline: "Eclipse it." },
  { setup: "How many horses does it take to change a light bulb?", punchline: "Purple." },
  { setup: "Why did the student eat his homework?", punchline: "The teacher said it was a piece of cake." },
  { setup: "What do you call a boomerang that won't come back?", punchline: "A stick." },
  { setup: "Why did the teddy bear skip dessert?", punchline: "It was already stuffed." },
  { setup: "Why do cows wear bells?", punchline: "Their horns don't work." },
  { setup: "How do you make a lemon drop?", punchline: "Just let it fall." },
  { setup: "What kind of shoes do ninjas wear?", punchline: "Sneakers." },
  { setup: "What did the buffalo say when his son left for school?", punchline: "Bison." },
  { setup: "What do you get when you cross a carrot with a staircase?", punchline: "A trombone." },
  { setup: "Where do pencils go on vacation?", punchline: "Pencil-vania." },
  { setup: "What do you call a lazy kangaroo?", punchline: "A pouch potato." },
  { setup: "Why did the man put his money in the freezer?", punchline: "He wanted cold hard cash." },
  { setup: "What do you get when you cross a snowman and a vampire?", punchline: "Frostbite." },
  { setup: "What did one plate say to the other?", punchline: "\"Dinner's on me.\"" },
  { setup: "Why is a horse like a sandwich?", punchline: "Neither of them can whistle." },
  { setup: "How do you catch a squirrel?", punchline: "Climb a tree and act like a nut." },
  { setup: "Why did the music teacher need a ladder?", punchline: "To reach the high notes." },
  { setup: "What state do horses love most?", punchline: "Neigh-braska." },
  { setup: "What did the janitor yell when he jumped out of the closet?", punchline: "\"Supplies!\"" },
  { setup: "Why did the banana cross the road?", punchline: "Because it was Thursday." },
  { setup: "Why did the stadium get so hot after the game?", punchline: "All the fans left." },
  { setup: "What has four wheels and flies?", punchline: "A garbage truck." },
  { setup: "How do you fix a cracked pumpkin?", punchline: "With a pumpkin patch." },
  { setup: "What do lawyers wear to court?", punchline: "Lawsuits." },
  { setup: "What do you call a cow with no legs?", punchline: "Ground beef." },
  { setup: "What's the difference between a pencil?", punchline: "About four inches." },
];

// The date on a clock in ZONE ('YYYY-MM-DD', which en-CA writes dates as), read back as a UTC midnight.
const zoneDate = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export function jokeOfTheDay(ms = Date.now()) {
  const day = Math.round((Date.parse(zoneDate.format(ms)) - Date.parse(FIRST_DAY)) / DAY);
  return JOKES[((day % JOKES.length) + JOKES.length) % JOKES.length];
}
