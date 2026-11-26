// HayPay: sending site clicks to another player, from their profile (pages/profile.html). Pure rules,
// shared by the page, the API (utils/transfer.js) and the pretend API (tools/dev-server.mjs).
//   minAgeDays: an account has to be this many days old before it can send (so nobody can make accounts to farm
//     the daily bonus, quests and Golden Trusties and pass it all to one player). Anyone can receive.
//   min/max: one payment, in whole clicks. perDay: what one account can send in a day (midnight Eastern).
//   review: payments of at least this many show in the admin panel's Payments tab.
//   noteMax: the optional note's length.
// Trusty's account (the house, utils/house.js) can't send or receive.

export const TRANSFER = { minAgeDays: 7, min: 1, max: 10000, perDay: 25000, review: 250, noteMax: 100 };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {Date|string|number} joined - When the account was made.
 * @returns {Date} When it can start sending clicks.
 */
export function sendableAt(joined) {
  const start = new Date(joined).getTime();
  return new Date((Number.isFinite(start) ? start : Date.now()) + TRANSFER.minAgeDays * DAY_MS);
}

/** Whether an account made at `joined` can send clicks at `now`. */
export const canSend = (joined, now = new Date()) => sendableAt(joined) <= now;

/** What's wrong with sending this many clicks, or '' if nothing is. */
export function amountProblem(amount) {
  if (!Number.isSafeInteger(amount) || amount < TRANSFER.min) return 'Send a whole number of clicks.';
  if (amount > TRANSFER.max) return `You can send at most ${TRANSFER.max.toLocaleString('en-US')} clicks at a time.`;
  return '';
}

// Letters, numbers and everyday punctuation stay; control and invisible characters go, and runs of spaces become one.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏ -‮⁠-⁯﻿]/g;
export const cleanNote = (note) => (typeof note === 'string' ? note.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim() : '');

/**
 * A payment as sent to the API, checked: { to, amount, note }, or null if it isn't one.
 * @param {unknown} body
 */
export function cleanTransfer(body) {
  if (!body || typeof body !== 'object') return null;
  const { to, amount, note } = body;
  if (typeof to !== 'string' || !to.trim() || to.length > 100) return null;
  if (amountProblem(amount)) return null;
  if (note != null && (typeof note !== 'string' || note.length > TRANSFER.noteMax * 4)) return null;
  const clean = cleanNote(note);
  if (clean.length > TRANSFER.noteMax) return null;
  return { to: to.trim(), amount, note: clean };
}

/** What's left of today's sending (`transfer` from the account's click_game document). */
export function sendLeft(transfer, today) {
  const sent = transfer && transfer.day === today && Number.isSafeInteger(transfer.sent) ? transfer.sent : 0;
  return Math.max(0, TRANSFER.perDay - sent);
}

/**
 * What today's payments did to the account's clicks, to take back out when the click bank works out its betting
 * limit (limitBasis() in utils/bank-rules.js): sending clicks shouldn't lower it mid-day, nor receiving them raise it.
 */
export function transferBasis(transfer, today) {
  if (!transfer || transfer.day !== today) return 0;
  return (Number(transfer.sent) || 0) - (Number(transfer.received) || 0);
}
