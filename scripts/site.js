// Shared chrome (header/footer), session state, and small DOM helpers for every page.

const LS_FLAG = 'isUserLoggedIn';
const LS_USER = 'username';
const FACE = '/images/mobile-icon.png';
const CLICK_LIMIT = 3; // header clicker: clicks per second

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
  save(username) { lsSet(LS_FLAG, 'true'); lsSet(LS_USER, username || ''); },
  clear() { lsDel(LS_FLAG); lsDel(LS_USER); },
};

function sessionState() { return { loggedIn: session.loggedIn, username: session.username }; }

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
      if (data && typeof data.username === 'string' && data.username && data.username !== session.username) {
        session.save(data.username);
        publishSession();
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

// Pages that hand out clicks (Trusty TV) report the new total so the header clicker keeps up.
export function announceClicks(clicks, added) {
  document.dispatchEvent(new CustomEvent('trusty:clicks', { detail: { clicks, added } }));
}

export async function logout() {
  session.clear();
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* cookie expires anyway */ }
  location.href = '/index.html';
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
  { href: '/pages/games.html', label: 'Games', section: '/pages/games' },
  { href: '/pages/tv.html', label: 'Trusty TV' },
  { href: '/pages/tools.html', label: 'Trusty Tools', items: [
    { href: '/pages/trustyGPT.html', label: 'TrustyGPT' },
    { href: '/pages/viewer.html', label: '3D Trusty' },
    { href: '/pages/weather.html', label: 'Trusty Weather' },
  ] },
  { href: '/pages/leaderboard.html', label: 'Leaderboards' },
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

function accountContent() {
  if (session.loggedIn) {
    return [
      session.username
        ? h('a', { class: 'account-name', href: profileHref(session.username), title: 'Your profile' }, `Hi, ${session.username}`)
        : h('span', { class: 'account-name' }, 'Hi, friend'),
      h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: logout }, 'Log out'),
    ];
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
      h('img', { class: 'ink', src: FACE, alt: 'Click Trusty', width: 30, height: 30 }),
      h('span', { class: 'clicker-count' }, '0'),
      h('span', { class: 'clicker-label' }, 'clicks'));

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
          h('a', { class: 'brand', href: '/index.html', 'aria-label': 'Trusty da Horse — home' },
            h('img', { class: 'brand-mark ink', src: FACE, alt: '', width: 40, height: 40 }),
            h('span', { class: 'brand-name' }, 'Trusty ', h('small', null, 'da'), ' Horse')),
          h('nav', { class: 'site-nav', 'aria-label': 'Main' }, navList({ dropdowns: true })),
          h('div', { class: 'header-actions' }, clicker, desktopAccount, toggle)),
        menu));

    const renderAccount = () => {
      desktopAccount.replaceChildren(...accountContent());
      mobileAccount.replaceChildren(...accountContent());
      clicker.hidden = !session.loggedIn;
    };
    renderAccount();
    document.addEventListener('trusty:session', renderAccount);

    setupMenu(toggle, menu);
    this.querySelectorAll('.nav-drop').forEach(setupDropdown);
    setupClicker(clicker);
  }
}

// Mouse users get the dropdown on hover (in CSS); the caret opens it for touch and keyboard.
function setupDropdown(group) {
  const toggle = group.querySelector('.nav-drop-toggle');
  const setOpen = (open) => toggle.setAttribute('aria-expanded', String(open));
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  toggle.addEventListener('click', () => setOpen(!isOpen()));
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

function setupClicker(button) {
  const countEl = button.querySelector('.clicker-count');
  // Shown count = highest total the server has reported + clicks whose POST hasn't answered yet.
  let serverCount = 0;
  let inFlight = 0;
  let loaded = false;
  const render = () => { countEl.textContent = fmt(serverCount + inFlight); };
  const accept = (data) => { serverCount = Math.max(serverCount, Number(data && data.clicks) || 0); };

  const load = async () => {
    if (!session.loggedIn || loaded) return;
    loaded = true;
    const { loggedIn } = await sessionReady;
    if (!loggedIn) { loaded = false; return; }
    try {
      const res = await fetch('/api/clicks');
      if (res.ok) accept(await res.json());
    } catch { /* leave the counter at its last value */ }
    render();
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
        slowNote = h('span', { class: 'plus-one slow-down', 'aria-hidden': 'true' }, 'Slow down!');
        slowNote.addEventListener('animationend', () => { slowNote.remove(); slowNote = null; });
        button.append(slowNote);
      }
      return;
    }
    inFlight += 1;
    render();
    const plus = h('span', { class: 'plus-one', 'aria-hidden': 'true' }, '+1');
    button.append(plus);
    plus.addEventListener('animationend', () => plus.remove());
    try {
      const res = await fetch('/api/clicks', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (res.status === 401) {
        sessionExpired();
        return;
      }
      if (res.ok) accept(await res.json());
    } catch { /* the click didn't land; drop it from the optimistic count */ }
    finally {
      inFlight -= 1;
      render();
    }
  });

  // Clicks earned elsewhere on the page (watching Trusty TV) float up as +N like a click does.
  document.addEventListener('trusty:clicks', (e) => {
    accept(e.detail);
    render();
    if (button.hidden || !(e.detail.added > 0)) return;
    const plus = h('span', { class: 'plus-one', 'aria-hidden': 'true' }, `+${e.detail.added}`);
    button.append(plus);
    plus.addEventListener('animationend', () => plus.remove());
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
          h('a', { class: 'brand', href: '/index.html' },
            h('img', { class: 'brand-mark ink', src: FACE, alt: '', width: 40, height: 40 }),
            h('span', { class: 'brand-name' }, 'Trusty ', h('small', null, 'da'), ' Horse')),
          h('p', null, 'Comics, games, and a state of the art AI horse. Drawn in the margins since 8th grade math.')),
        col('Explore', [['Comics', '/pages/comics.html'], ['Games', '/pages/games.html'], ['Trusty TV', '/pages/tv.html'], ['Trusty Tools', '/pages/tools.html'], ['TrustyGPT', '/pages/trustyGPT.html'], ['3D Trusty', '/pages/viewer.html'], ['Trusty Weather', '/pages/weather.html']]),
        col('More', [['Leaderboards', '/pages/leaderboard.html'], ['About Trusty', '/pages/about.html'], ['Credits', '/pages/credits.html']])),
      h('div', { class: 'container footer-bottom' },
        h('p', null, `© ${new Date().getFullYear()} Trusty Comics`),
        h('img', { class: 'footer-trusty ink', src: '/images/trusty.png', alt: '', width: 88, height: 67, loading: 'lazy' }))));
  }
}

customElements.define('trusty-header', TrustyHeader);
customElements.define('trusty-footer', TrustyFooter);
document.documentElement.dataset.auth = session.loggedIn ? 'in' : 'out';
