// The Daily Quests panel (rules in scripts/quests.js, the API in utils/quests.js), on the home page and Daily
// Games. Today's quests come from the date, so they show at once for everyone; logged in, the API says how far
// along each one is, and the Collect button pays the ones that are done.
import { h, fmt, session, sessionReady, sessionExpired, loginHref, announceClicks, onSession } from '/scripts/site.js';
import { dayOf } from '/scripts/milestones.js';
import { questsFor, amountText, QUEST_REWARD, ALL_BONUS } from '/scripts/quests.js';

const API = '/api/leaderboard?action=quests';
const REFRESH_MS = 2500; // after a click on the header clicker, when the clicker quest might have moved

export function mountQuests(root) {
  if (!root) return;
  let state = null; // the API's last answer
  let day = dayOf();
  let busy = false;
  let refreshTimer = null;
  const status = h('p', { class: 'form-status quests-status', role: 'status' });

  const local = () => ({
    day,
    quests: questsFor(day).map((q) => ({ ...q, count: 0, complete: false, paid: false })),
    reward: QUEST_REWARD,
    bonus: ALL_BONUS,
    bonusPaid: false,
    times: 1,
  });

  function questItem(q, loggedIn, reward) {
    const where = q.href ? h('a', { href: q.href }, q.text) : h('span', null, q.text);
    const look = q.paid ? 'paid' : q.complete ? 'done' : 'open';
    return h('li', { class: 'quest', dataset: { state: look } },
      h('span', { class: 'quest-check', 'aria-hidden': 'true' }, q.paid || q.complete ? '✓' : ''),
      h('span', { class: 'quest-body' },
        h('span', { class: 'quest-text' }, where),
        loggedIn ? h('span', { class: 'quest-count' },
          q.paid ? 'Collected' : q.complete ? 'Done! Ready to collect' : amountText(q, q.count)) : null,
        loggedIn ? h('span', { class: 'quest-bar', 'aria-hidden': 'true' },
          h('span', { style: `--p: ${(Math.min(q.count, q.at) / q.at).toFixed(3)}` })) : null),
      h('span', { class: 'quest-reward' }, `+${fmt(reward)}`));
  }

  function render() {
    const loggedIn = session.loggedIn;
    const s = loggedIn && state ? state : local();
    const owed = s.quests.filter((q) => q.complete && !q.paid).length;
    const allDone = s.quests.every((q) => q.complete);
    const owedBonus = allDone && !s.bonusPaid;
    const owedClicks = owed * s.reward + (owedBonus ? s.bonus : 0);

    const items = h('ol', { class: 'quest-list' }, s.quests.map((q) => questItem(q, loggedIn, s.reward)));
    const bonus = h('p', { class: 'quest-bonus', dataset: { state: s.bonusPaid ? 'paid' : allDone ? 'done' : 'open' } },
      s.bonusPaid ? `All three done today: +${fmt(s.bonus)} bonus collected. New quests at midnight Eastern.`
        : `Do all three for +${fmt(s.bonus)} more.`);
    const boost = s.times > 1
      ? h('p', { class: 'quest-boost' }, h('span', { class: 'tag tag-gold' }, `${s.times}x today`), ` An event is multiplying quest rewards by ${s.times}.`)
      : null;

    let actions;
    if (!loggedIn) {
      actions = h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-sm', href: loginHref() }, 'Log in to do quests'));
    } else {
      const claim = h('button', { type: 'button', class: 'btn btn-sm', disabled: busy || !owedClicks, onclick: collect },
        owedClicks ? `Collect ${fmt(owedClicks)} clicks` : 'Nothing to collect yet');
      actions = h('div', { class: 'btn-row' }, claim);
    }
    root.replaceChildren(...[boost, items, bonus, actions, status].filter(Boolean));
  }

  async function load() {
    if (!session.loggedIn) { state = null; render(); return; }
    try {
      const res = await fetch(API, { credentials: 'same-origin' });
      if (res.status === 401) { sessionExpired(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state = await res.json();
      day = state.day || day;
    } catch {
      if (!state) status.textContent = 'Couldn’t check your quests just now.';
    }
    render();
  }

  async function collect() {
    if (busy) return;
    busy = true;
    render();
    status.textContent = '';
    try {
      const res = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ do: 'claim' }),
      });
      if (res.status === 401) { sessionExpired(); return; }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data && data.error);
      state = data;
      if (data.added > 0) {
        status.textContent = `+${fmt(data.added)} clicks!`;
        if (Number.isFinite(data.clicks)) announceClicks(data.clicks, data.added);
      } else {
        status.textContent = 'Nothing new to collect yet.';
      }
    } catch (error) {
      status.textContent = (error && error.message) || 'Couldn’t collect just now. Try again?';
    } finally {
      busy = false;
      render();
    }
  }

  render();
  sessionReady.then(load);
  onSession(() => { render(); });
  document.addEventListener('trusty:session', (e) => { if (e.detail.loggedIn) load(); });

  // Clicking Trusty up top can finish the clicker quest: look again a moment after the clicking stops.
  document.addEventListener('click', (e) => {
    if (!session.loggedIn || !e.target.closest || !e.target.closest('.clicker')) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(load, REFRESH_MS);
  });
  // Clicks earned on this page (a Daily Games post) can finish a quest too.
  document.addEventListener('trusty:clicks', () => {
    if (busy) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(load, REFRESH_MS);
  });
  // Coming back to the tab (after a game in another one, or past midnight).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (dayOf() !== day) { day = dayOf(); state = null; }
    load();
  });
}
