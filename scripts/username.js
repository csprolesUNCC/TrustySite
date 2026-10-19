// The rules for picking a username, with no DOM, so the sign-up form (scripts/auth.js), the profile page's
// Change username form (pages/profile.html) and the server (api/auth/register.js, utils/rename.js) all go by
// the same ones. Names from before these rules keep working; the rules only apply when a name is picked.
// pages/auth/register.html and pages/profile.html write these numbers into their forms, so change them there too.

export const USERNAME_MAX = 32;
// After changing your username, how long until you can change it again.
export const RENAME_DAYS = 90;

// Spaces of every kind, plus the invisible characters that can pass for one or for nothing at all
// (zero-width spaces, text-direction marks, Hangul fillers, the blank Braille pattern).
const BLANK = /[\s\p{Cc}\p{Cf}ᅟᅠ⠀ㅤﾠ]/u;

// What's wrong with `name` as a new username, or null if it's fine. The length is counted the way an
// input's maxlength counts it.
export function usernameProblem(name) {
  if (typeof name !== 'string' || !name) return 'Pick a username.';
  if (BLANK.test(name)) return 'Usernames can’t have spaces.';
  // The login form takes an email or a username, and goes by the @ to tell which.
  if (name.includes('@')) return 'Usernames can’t have an @ in them.';
  if (name.length > USERNAME_MAX) return `Usernames can be at most ${USERNAME_MAX} characters.`;
  return null;
}
