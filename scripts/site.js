// Shared chrome (header/footer), session state, and small DOM helpers for every page.
import { rankFor, nextRank, rankProgress, dailyBonus, dayOf } from '/scripts/milestones.js';

const LS_FLAG = 'isUserLoggedIn';
const LS_USER = 'username';
const LS_ADMIN = 'trusty:admin';
// The highest click rank the header clicker has shown on this device (its `at`), and whose it is.
const LS_RANK = 'trusty:rank';
const LS_RANK_OWNER = 'trusty:rank:owner';
// Device keys that remember by username whose data they hold (Trustle's games, the click rank shown), so a
// rename moves them along instead of looking like someone else logged in.
const LS_NAME_KEYS = ['trusty:trustle:owner', LS_RANK_OWNER];
const FACE = '/images/icons/mobile-icon-96.webp';
const ADMIN_PAGE = '/pages/admin.html';
const CLICK_LIMIT = 3; // header clicker: clicks per second
const NOTE_MS = 4500; // how long a rank up or daily bonus note stays under the clicker

function lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } }
function lsDel(key) { try { localStorage.removeItem(key); } catch { /* storage blocked */ } }

/* ---------- DOM helpers ---------- */

// Builds elements without ever parsing strings as HTML, so user data is always inert text.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const numberFormat = new Intl.NumberFormat();
export const fmt = (n) => numberFormat.format(Number(n) || 0);

let toastRegion;
export function toast(message, tone = 'info', ms = 2800) {
  if (!toastRegion) {
    toastRegion = h('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRegion);
  }
  const el = h('div', { class: 'toast', dataset: { tone } }, message);
  toastRegion.append(el);
  setTimeout(() => el.remove(), ms);
}

/* ---------- Session ---------- */

export const session = {
  get loggedIn() { return lsGet(LS_FLAG) === 'true'; },
  get username() { return lsGet(LS_USER) || ''; },
  // Only shows the Admin button: the server checks every admin request itself.
  get isAdmin() { return this.loggedIn && lsGet(LS_ADMIN) === 'true'; },
  save(username, admin = false) {
    lsSet(LS_FLAG, 'true');
    lsSet(LS_USER, username || '');
    if (admin) lsSet(LS_ADMIN, 'true'); else lsDel(LS_ADMIN);
  },
  clear() { lsDel(LS_FLAG); lsDel(LS_USER); lsDel(LS_ADMIN); },
};

function sessionState() { return { loggedIn: session.loggedIn, username: session.username, isAdmin: session.isAdmin }; }

function renameOnDevice(from, to) {
  if (!from || from === to) return;
  for (const key of LS_NAME_KEYS) if (lsGet(key) === from) lsSet(key, to);
}

function publishSession() {
  document.documentElement.dataset.auth = session.loggedIn ? 'in' : 'out';
  document.dispatchEvent(new CustomEvent('trusty:session', { detail: sessionState() }));
}

// Only ask the server when we think we're logged in, so logged-out visitors never trigger a 401.
export const sessionReady = (async () => {
  if (!session.loggedIn) return sessionState();
  try {
    const res = await fetch('/api/auth/login', { credentials: 'same-origin' });
    if (res.status === 401) {
      session.clear();
      publishSession();
    } else if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && typeof data.username === 'string' && data.username) {
        const admin = data.isAdmin === true;
        if (data.username !== session.username || admin !== session.isAdmin) {
          // Same login, different name: the account was renamed on another device.
          renameOnDevice(session.username, data.username);
          session.save(data.username, admin);
          publishSession();
        }
      }
    }
  } catch { /* offline: trust the local flag, as the old site did */ }
  return sessionState();
})();

export function onSession(callback) {
  callback(sessionState());
  document.addEventListener('trusty:session', (e) => callback(e.detail));
}

// For when a protected API answers 401: the login cookie expired, so show the page logged out.
export function sessionExpired() {
  session.clear();
  publishSession();
}

// For after changing your username (pages/profile.html): the API has set a login cookie with the new name, so
// the header and this device's saved data switch to it too.
export function sessionRenamed(username) {
  renameOnDevice(session.username, username);
  session.save(username, session.isAdmin);
  publishSession();
}

// Pages that hand out clicks (Trusty TV, Trustle) report the new total so the header clicker keeps up.
export function announceClicks(clicks, added) {
  document.dispatchEvent(new CustomEvent('trusty:clicks', { detail: { clicks, added } }));
}

// The click bank's word on your clicks after a bet (it can go down, unlike a click total), with what you won.
export function announceBalance(clicks, won = 0) {
  document.dispatchEvent(new CustomEvent('trusty:clicks', { detail: { clicks, added: won, exact: true } }));
}

export async function logout() {
  session.clear();
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* cookie expires anyway */ }
  location.href = '/';
}

export const profileHref = (username) => `/pages/profile.html?u=${encodeURIComponent(username)}`;

export function loginHref() {
  if (location.pathname.startsWith('/pages/auth/')) return '/pages/auth/login.html';
  const next = location.pathname + location.search + location.hash;
  return `/pages/auth/login.html?next=${encodeURIComponent(next)}`;
}

/* ---------- Header ---------- */

const NAV = [
  { href: '/pages/comics.html', label: 'Comics', section: '/pages/comics' },
  { href: '/pages/games.html', label: 'Games', section: '/pages/games', items: [
    { href: '/pages/games/trustle.html', label: 'Trustle' },
    { href: '/pages/games/flappy.html', label: 'Flappy Trusty' },
    { href: '/pages/games/trustis.html', label: 'Trustis' },
    { href: '/pages/games/draw.html', label: 'Draw Trusty' },
    { href: '/pages/leaderboard.html', label: 'Leaderboards' },
  ] },
  { href: '/pages/media.html', label: 'Trusty Media', items: [
    { href: '/pages/tv.html', label: 'Trusty TV' },
    { href: '/pages/radio.html', label: 'Trusty Radio' },
  ] },
  { href: '/pages/tools.html', label: 'Trusty Tools', items: [
    { href: '/pages/trustyGPT.html', label: 'TrustyGPT' },
    { href: '/pages/viewer.html', label: '3D Trusty' },
    { href: '/pages/weather.html', label: 'Trusty Weather' },
  ] },
  { href: '/pages/about.html', label: 'About' },
];

const normPath = (p) => (p.replace(/\.html$/, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1')) || '/';

function currentState(item) {
  const here = normPath(location.pathname);
  if (here === normPath(item.href)) return 'page';
  if (item.section && here.startsWith(item.section + '/')) return 'true';
  if (item.items && item.items.some(currentState)) return 'true';
  return null;
}

const navLink = (item) => h('a', { href: item.href, 'aria-current': currentState(item) }, item.label);

// The header nav shows a group as its page link plus a caret that drops down its items;
// the mobile menu lists the items indented under the group's link.
function navList({ dropdowns = false } = {}) {
  return h('ul', null, NAV.map((item) => {
    if (!item.items) return h('li', null, navLink(item));
    const items = item.items.map((child) => h('li', null, navLink(child)));
    if (!dropdowns) return h('li', null, navLink(item), h('ul', { class: 'mobile-sub' }, items));
    const id = `nav-${item.label.toLowerCase().replace(/\W+/g, '-')}`;
    const toggle = h('button', { type: 'button', class: 'nav-drop-toggle', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': `${item.label} menu` });
    toggle.innerHTML = ICON_CARET;
    return h('li', { class: 'nav-drop' }, navLink(item), toggle, h('ul', { class: 'nav-drop-menu', id }, items));
  }));
}

const ICON_CARET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.4c2.1 1.9 4 3.7 6.1 5.4 1.9-1.9 3.8-3.6 5.9-5.6"/></svg>';

const ICON_MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path class="icon-open" d="M4 7c5-.6 11 .4 16-.2M4 12.2c6 .4 10-.5 16 0M4 17.4c4-.4 10 .3 16-.3"/><path class="icon-close" d="M6.2 6c4 4 7.8 8.2 11.8 12.2M18 5.8C14 10 10 14 6 18.2"/></svg>';

// Admins also get an Admin button: under their name in the header, so the row is no wider than anyone
// else's, and next to Log out in the menu.
function accountContent({ menu = false } = {}) {
  if (session.loggedIn) {
    const name = session.username
      ? h('a', { class: 'account-name', href: profileHref(session.username), title: 'Your profile' }, `Hi, ${session.username}`)
      : h('span', { class: 'account-name' }, 'Hi, friend');
    const logOut = h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: logout }, 'Log out');
    if (!session.isAdmin) return [name, logOut];
    const current = normPath(location.pathname) === normPath(ADMIN_PAGE) ? 'page' : null;
    return menu
      ? [name, h('a', { class: 'btn btn-highlight btn-sm', href: ADMIN_PAGE, 'aria-current': current }, 'Admin panel'), logOut]
      : [h('div', { class: 'account-who' }, name, h('a', { class: 'admin-link', href: ADMIN_PAGE, 'aria-current': current }, 'Admin')), logOut];
  }
  return [
    h('a', { class: 'btn btn-ghost btn-sm', href: loginHref() }, 'Log in'),
    h('a', { class: 'btn btn-sm', href: '/pages/auth/register.html' }, 'Sign up'),
  ];
}

class TrustyHeader extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';

    const clicker = h('button', { type: 'button', class: 'clicker', hidden: true, title: 'Click Trusty! Every click counts on the leaderboard.' },
      h('span', { class: 'clicker-face' }, h('img', { class: 'ink', src: FACE, alt: 'Click Trusty', width: 26, height: 26 })),
      h('span', { class: 'clicker-count' }, '0'),
      h('span', { class: 'clicker-label' }, 'clicks'));
    // Says rank ups and the daily bonus out loud: the notes that show them under the clicker are only decoration.
    const clickerNews = h('span', { class: 'sr-only', role: 'status' });

    const toggle = h('button', { type: 'button', class: 'menu-toggle', 'aria-expanded': 'false', 'aria-controls': 'mobile-menu', 'aria-label': 'Open menu' });
    toggle.innerHTML = ICON_MENU;

    const desktopAccount = h('div', { class: 'account' });
    const mobileAccount = h('div', { class: 'mobile-account' });
    const menu = h('div', { class: 'mobile-menu', id: 'mobile-menu', hidden: true },
      h('div', { class: 'sheet' }, h('nav', { 'aria-label': 'Main' }, navList())),
      mobileAccount);

    this.replaceChildren(
      h('a', { class: 'skip-link', href: '#main' }, 'Skip to content'),
      h('header', { class: 'site-header' },
        h('div', { class: 'container header-inner' },
          h('a', { class: 'brand', href: '/', 'aria-label': 'Trusty da Horse — home' },
            h('img', { class: 'brand-mark ink', src: FACE, alt: '', width: 40, height: 40 }),
            h('span', { class: 'brand-name' }, 'Trusty ', h('small', null, 'da'), ' Horse')),
          h('nav', { class: 'site-nav', 'aria-label': 'Main' }, navList({ dropdowns: true })),
          h('div', { class: 'header-actions' }, clicker, clickerNews, desktopAccount, toggle)),
        menu));

    const renderAccount = () => {
      desktopAccount.replaceChildren(...accountContent());
      mobileAccount.replaceChildren(...accountContent({ menu: true }));
      clicker.hidden = !session.loggedIn;
    };
    renderAccount();
    document.addEventListener('trusty:session', renderAccount);

    setupMenu(toggle, menu);
    this.querySelectorAll('.nav-drop').forEach(setupDropdown);
    setupClicker(clicker, clickerNews);
  }
}

// Mouse users get the dropdown on hover (in CSS); the caret opens it for touch and keyboard.
function setupDropdown(group) {
  const toggle = group.querySelector('.nav-drop-toggle');
  const setOpen = (open) => toggle.setAttribute('aria-expanded', String(open));
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  toggle.addEventListener('click', () => setOpen(!isOpen()));
  // Pointing at a group closes any other one opened with its caret, so two menus never overlap.
  group.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    document.querySelectorAll('.nav-drop-toggle[aria-expanded="true"]').forEach((other) => {
      if (other !== toggle) other.setAttribute('aria-expanded', 'false');
    });
  });
  group.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { setOpen(false); toggle.focus(); }
  });
  group.addEventListener('focusout', (e) => { if (!group.contains(e.relatedTarget)) setOpen(false); });
  document.addEventListener('click', (e) => { if (isOpen() && !group.contains(e.target)) setOpen(false); });
}

function setupMenu(toggle, menu) {
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.hidden = !open;
    document.documentElement.classList.toggle('menu-open', open);
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { setOpen(false); toggle.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
  // Close the menu once the window is wide enough for the full nav.
  window.addEventListener('resize', () => { if (!menu.hidden && getComputedStyle(toggle).display === 'none') setOpen(false); });
}

const clicksWord = (n) => `${fmt(n)} ${n === 1 ? 'click' : 'clicks'}`;

// The clicker's tooltip: the player's click rank, how far the next one is, and the daily bonus while it waits.
function clickerTitle(count, daily) {
  const rank = rankFor(count);
  const next = nextRank(count);
  return [
    'Click Trusty!',
    rank ? `Rank: ${rank.name}.` : null,
    next ? `${clicksWord(next.at - count)} to ${next.name}.` : 'That’s the top rank!',
    daily && daily.ready ? `Today’s first click earns a +${fmt(daily.next)} bonus.` : null,
  ].filter(Boolean).join(' ');
}

// The highest click rank (its `at`) this device has shown the logged-in player, or null if it never has. Kept
// in memory too, for when storage is blocked.
let rankShown = null;
function shownRank() {
  if (lsGet(LS_RANK_OWNER) === session.username) {
    const at = Number(lsGet(LS_RANK));
    if (Number.isFinite(at)) return at;
  }
  return rankShown && rankShown.name === session.username ? rankShown.at : null;
}
function rememberRank(at) {
  rankShown = { name: session.username, at };
  lsSet(LS_RANK_OWNER, session.username);
  lsSet(LS_RANK, String(at));
}

function setupClicker(button, news) {
  const countEl = button.querySelector('.clicker-count');
  const face = button.querySelector('.clicker-face');
  const dailyBadge = h('span', { class: 'clicker-daily', 'aria-hidden': 'true', hidden: true });
  button.append(dailyBadge);
  // Shown count = highest total the server has reported + clicks whose POST hasn't answered yet.
  let serverCount = 0;
  let inFlight = 0;
  let loaded = false;
  // The daily bonus as GET /api/clicks last told it ({ ready, streak, next }), and the day that was.
  let daily = null;
  let dailyDay = null;
  const render = () => {
    const count = serverCount + inFlight;
    countEl.textContent = fmt(count);
    // The ring around Trusty fills up toward the next click rank (scripts/milestones.js).
    face.style.setProperty('--progress', rankProgress(count).toFixed(3));
    button.title = clickerTitle(count, daily);
    const ready = Boolean(daily && daily.ready);
    dailyBadge.hidden = !ready;
    dailyBadge.textContent = ready ? `+${fmt(daily.next)}` : '';
  };
  // Click answers can arrive out of order, so a total only ever goes up; the bank's answers are exact.
  const accept = (data) => {
    const clicks = Number(data && data.clicks) || 0;
    serverCount = data && data.exact ? clicks : Math.max(serverCount, clicks);
  };

  // +1 for a click, +N for clicks earned another way, or "Slow down!", floating up off Trusty.
  const floatUp = (text, className = 'plus-one') => {
    const el = h('span', { class: className, 'aria-hidden': 'true' }, text);
    el.addEventListener('animationend', () => el.remove());
    button.append(el);
    return el;
  };

  // Rank ups and the daily bonus get a sticky note under the clicker for a few seconds, one at a time.
  const notes = [];
  let noting = false;
  const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
  const nextNote = () => {
    const next = notes.shift();
    noting = Boolean(next);
    if (!next) return;
    const [title, big, small] = next;
    news.textContent = next.map(sentence).join(' ');
    const note = h('span', { class: 'clicker-note', 'aria-hidden': 'true' },
      h('span', { class: 'clicker-note-title' }, title),
      h('span', { class: 'clicker-note-big' }, big),
      small);
    button.append(note);
    setTimeout(() => {
      note.classList.add('is-leaving');
      setTimeout(() => { note.remove(); nextNote(); }, 300);
    }, NOTE_MS);
  };
  const showNote = (title, big, small) => {
    notes.push([title, big, small]);
    if (!noting) nextNote();
  };

  // Reaching a new click rank gets a note and a spin, once per rank: winning back clicks lost on a bet doesn't
  // count again. The first time this device sees a player, the note just says which rank they're at.
  let spinTimer;
  const checkRank = () => {
    if (!session.loggedIn) return;
    const rank = rankFor(serverCount);
    const at = rank ? rank.at : 0;
    const before = shownRank();
    if (before !== null && at <= before) return;
    rememberRank(at);
    if (!rank) return;
    const next = nextRank(serverCount);
    if (before === null) {
      showNote('Your click rank', rank.name, next ? `${clicksWord(next.at - serverCount)} to ${next.name}` : 'That’s the top rank!');
      return;
    }
    showNote('Rank up!', rank.name, next ? `Next: ${next.name} at ${fmt(next.at)} clicks` : 'That’s the top rank!');
    button.classList.add('is-ranking-up');
    clearTimeout(spinTimer);
    spinTimer = setTimeout(() => button.classList.remove('is-ranking-up'), 1200);
  };

  // The day's first click came back with the daily bonus (api/clicks.js pays it).
  const gotDaily = (bonus) => {
    const added = Number(bonus.added) || 0;
    const streak = Number(bonus.streak) || 1;
    if (added <= 0) return;
    daily = { ready: false, streak, next: dailyBonus(streak + 1) };
    floatUp(`+${fmt(added)}`);
    showNote('Daily bonus!', `+${clicksWord(added)}`,
      streak > 1 ? `${fmt(streak)} days in a row. Tomorrow: +${fmt(dailyBonus(streak + 1))}` : `Come back tomorrow for +${fmt(dailyBonus(2))}`);
  };

  const refresh = async () => {
    try {
      const res = await fetch('/api/clicks');
      if (res.ok) {
        const data = await res.json();
        accept(data);
        const d = data && data.daily;
        daily = d && typeof d.ready === 'boolean' ? { ready: d.ready, streak: Number(d.streak) || 0, next: Number(d.next) || 0 } : null;
        dailyDay = dayOf();
        checkRank();
      }
    } catch { /* leave the counter at its last value */ }
    render();
  };

  const load = async () => {
    if (!session.loggedIn || loaded) return;
    loaded = true;
    const { loggedIn } = await sessionReady;
    if (!loggedIn) { loaded = false; return; }
    await refresh();
  };

  // At most CLICK_LIMIT clicks per second (api/clicks.js enforces the same limit).
  const recent = [];
  let slowNote = null;
  const tooFast = () => {
    const now = performance.now();
    while (recent.length && now - recent[0] >= 1000) recent.shift();
    if (recent.length >= CLICK_LIMIT) return true;
    recent.push(now);
    return false;
  };

  button.addEventListener('click', async () => {
    if (tooFast()) {
      if (!slowNote) {
        slowNote = floatUp('Slow down!', 'plus-one slow-down');
        slowNote.addEventListener('animationend', () => { slowNote = null; });
      }
      return;
    }
    inFlight += 1;
    render();
    floatUp('+1');
    try {
      const res = await fetch('/api/clicks', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (res.status === 401) {
        sessionExpired();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        accept(data);
        // Only the day's first click pays the bonus, so any other click means it's been paid (in another tab, say).
        if (data && data.daily) gotDaily(data.daily);
        else if (daily && daily.ready) daily = { ...daily, ready: false };
        checkRank();
      }
    } catch { /* the click didn't land; drop it from the optimistic count */ }
    finally {
      inFlight -= 1;
      render();
    }
  });

  // Clicks earned elsewhere on the page (watching Trusty TV, finishing a Trustle) float up as +N like a click does.
  document.addEventListener('trusty:clicks', (e) => {
    accept(e.detail);
    checkRank();
    render();
    if (button.hidden || !(e.detail.added > 0)) return;
    floatUp(`+${e.detail.added}`);
  });

  // A page left open past midnight Eastern looks for the new day's bonus when it's looked at again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && loaded && session.loggedIn && dailyDay && dailyDay !== dayOf()) refresh();
  });

  load();
  document.addEventListener('trusty:session', (e) => { if (e.detail.loggedIn) load(); });
}

/* ---------- Footer ---------- */

class TrustyFooter extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    const col = (title, links) => h('div', { class: 'footer-col' },
      h('h2', null, title),
      h('ul', null, links.map(([label, href]) => h('li', null, h('a', { href }, label)))));

    this.replaceChildren(h('footer', { class: 'site-footer' },
      h('div', { class: 'container footer-inner' },
        h('div', { class: 'footer-brand' },
          h('a', { class: 'brand', href: '/' },
            h('img', { class: 'brand-mark ink', src: FACE, alt: '', width: 40, height: 40 }),
            h('span', { class: 'brand-name' }, 'Trusty ', h('small', null, 'da'), ' Horse')),
          h('p', null, 'Comics, games, and a state of the art AI horse. Drawn in the margins since 8th grade math.')),
        col('Explore', [['Comics', '/pages/comics.html'], ['Games', '/pages/games.html'], ['Trusty Media', '/pages/media.html'], ['Trusty TV', '/pages/tv.html'], ['Trusty Radio', '/pages/radio.html'], ['Trusty Tools', '/pages/tools.html'], ['TrustyGPT', '/pages/trustyGPT.html'], ['3D Trusty', '/pages/viewer.html'], ['Trusty Weather', '/pages/weather.html']]),
        col('More', [['Leaderboards', '/pages/leaderboard.html'], ['About Trusty', '/pages/about.html'], ['Credits', '/pages/credits.html']])),
      h('div', { class: 'container footer-bottom' },
        h('p', null, `© ${new Date().getFullYear()} Trusty Comics`),
        h('img', { class: 'footer-trusty ink', src: '/images/trusty/trusty-v2-176.webp', alt: '', width: 88, height: 67, loading: 'lazy' }))));
  }
}

customElements.define('trusty-header', TrustyHeader);
customElements.define('trusty-footer', TrustyFooter);
document.documentElement.dataset.auth = session.loggedIn ? 'in' : 'out';
