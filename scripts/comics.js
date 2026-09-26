// Full-screen comic reader. Season pages list episodes as cards with data-episode / data-pages;
// this turns them into a reader with deep links (#ep-2), back-button support and keyboard nav.
import { h } from '/scripts/site.js';

export function mountSeason(root = document.querySelector('[data-comic]')) {
  if (!root) return;
  const comic = root.dataset.comic;
  const season = root.dataset.season;
  const seasonLabel = root.dataset.seasonLabel || '';
  const nextSeason = root.dataset.nextSeason ? { href: root.dataset.nextSeason, label: root.dataset.nextSeasonLabel || 'Next season' } : null;

  const episodes = [...root.querySelectorAll('[data-episode]')]
    .map((card) => ({ n: Number(card.dataset.episode), pages: Number(card.dataset.pages), card }))
    .sort((a, b) => a.n - b.n);
  if (!episodes.length) return;

  const pagePath = (ep, page) => `/images/comics/${comic}/${season}/e${ep}/p${page}.jpg`;

  const title = h('h2', { class: 'reader-title', id: 'reader-title' });
  const closeBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, '✕ Close');
  const prevBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'aria-label': 'Previous episode' }, '←', h('span', { class: 'btn-label' }, ' Prev'));
  const nextBtn = h('button', { type: 'button', class: 'btn btn-outline btn-sm', 'aria-label': 'Next episode' }, h('span', { class: 'btn-label' }, 'Next '), '→');
  const pages = h('div', { class: 'reader-pages' });
  const endText = h('p');
  const endAction = h('div', { class: 'btn-row' });

  const dialog = h('dialog', { class: 'reader', 'aria-labelledby': 'reader-title' },
    h('div', { class: 'reader-bar' },
      h('div', null, closeBtn),
      title,
      h('div', { class: 'reader-nav' }, prevBtn, nextBtn)),
    pages,
    h('div', { class: 'reader-end' }, endText, endAction));
  document.body.append(dialog);

  let current = null;
  let pushedHistory = false;

  function render(ep) {
    const index = episodes.indexOf(ep);
    const prev = episodes[index - 1];
    const next = episodes[index + 1];

    title.replaceChildren(`Episode ${ep.n}`, h('small', null, `${seasonLabel} · ${ep.pages} ${ep.pages === 1 ? 'page' : 'pages'}`));
    pages.replaceChildren(...Array.from({ length: ep.pages }, (_, i) => h('img', {
      src: pagePath(ep.n, i + 1),
      alt: `${seasonLabel}, Episode ${ep.n}, page ${i + 1} of ${ep.pages}`,
      width: 1000,
      height: 1330,
      loading: i < 2 ? 'eager' : 'lazy',
      decoding: 'async',
    })));

    prevBtn.disabled = !prev;
    nextBtn.disabled = !next;
    endText.textContent = `End of Episode ${ep.n}`;
    if (next) {
      endAction.replaceChildren(h('button', { type: 'button', class: 'btn btn-highlight', onclick: () => go(next) }, `Read Episode ${next.n} →`));
    } else if (nextSeason) {
      endAction.replaceChildren(h('a', { class: 'btn btn-highlight', href: nextSeason.href }, `${nextSeason.label} →`));
    } else {
      endAction.replaceChildren(h('button', { type: 'button', class: 'btn btn-outline', onclick: () => close() }, 'Back to episodes'));
    }
    dialog.scrollTop = 0;
  }

  function open(ep, { push }) {
    current = ep;
    render(ep);
    if (push) {
      history.pushState({ comicEpisode: ep.n }, '', `#ep-${ep.n}`);
      pushedHistory = true;
    }
    if (!dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add('reader-open');
    }
    closeBtn.focus();
  }

  function go(ep) {
    current = ep;
    render(ep);
    history.replaceState(history.state, '', `#ep-${ep.n}`);
  }

  function hide() {
    if (dialog.open) dialog.close();
    document.documentElement.classList.remove('reader-open');
    if (current) current.card.querySelector('a')?.focus({ preventScroll: true });
    current = null;
  }

  function close() {
    if (pushedHistory) {
      pushedHistory = false;
      history.back();
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      hide();
    }
  }

  function syncFromHash() {
    const match = location.hash.match(/^#ep-(\d+)$/);
    const ep = match && episodes.find((e) => e.n === Number(match[1]));
    if (ep) open(ep, { push: false });
    else hide();
  }

  for (const ep of episodes) {
    ep.card.querySelector('a')?.addEventListener('click', (e) => {
      e.preventDefault();
      open(ep, { push: true });
    });
  }

  closeBtn.addEventListener('click', close);
  prevBtn.addEventListener('click', () => { const i = episodes.indexOf(current); if (i > 0) go(episodes[i - 1]); });
  nextBtn.addEventListener('click', () => { const i = episodes.indexOf(current); if (i < episodes.length - 1) go(episodes[i + 1]); });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && !prevBtn.disabled) prevBtn.click();
    if (e.key === 'ArrowRight' && !nextBtn.disabled) nextBtn.click();
  });
  window.addEventListener('popstate', () => { pushedHistory = false; syncFromHash(); });

  syncFromHash();
}
