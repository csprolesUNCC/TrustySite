// Login, register, forgot-password and reset-password forms. Each page includes only its own form.
import { h, session } from '/scripts/site.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// Only same-origin, non-auth paths are allowed as a post-login destination.
function safeNext(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin || url.pathname.startsWith('/pages/auth/')) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
const next = safeNext(params.get('next'));
const withNext = (path) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

function setStatus(el, text, tone = 'info') {
  el.textContent = text;
  el.dataset.tone = tone;
}

function setLoading(button, loading, label) {
  if (loading) {
    button.dataset.label ??= button.textContent;
    button.disabled = true;
    button.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), label);
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label;
  }
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

for (const wrap of document.querySelectorAll('.password-wrap')) {
  const input = wrap.querySelector('input');
  const toggle = wrap.querySelector('.password-toggle');
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-pressed', String(show));
    input.focus();
  });
}

for (const link of document.querySelectorAll('[data-keep-next]')) {
  link.href = withNext(link.getAttribute('href'));
}

/* ---------- Login ---------- */
const loginForm = $('login-form');
if (loginForm) {
  const status = $('form-status');
  const submit = loginForm.querySelector('[type="submit"]');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus(status, '');
    setLoading(submit, true, 'Logging in…');
    try {
      const { res, data } = await postJSON('/api/auth/login', { email: $('email').value, password: $('password').value });
      if (res.ok) {
        session.save(data.username);
        setStatus(status, 'Logged in! Taking you back…', 'success');
        location.href = next || '/index.html';
        return;
      }
      setStatus(status, data.message || 'Login failed. Please try again.', 'error');
    } catch {
      setStatus(status, 'A network error occurred. Please check your connection.', 'error');
    }
    setLoading(submit, false);
  });
}

/* ---------- Register ---------- */
const registerForm = $('register-form');
if (registerForm) {
  const status = $('form-status');
  const submit = registerForm.querySelector('[type="submit"]');
  const password = $('password');
  const confirm = $('confirm-password');
  confirm.addEventListener('input', () => confirm.removeAttribute('aria-invalid'));

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (password.value !== confirm.value) {
      confirm.setAttribute('aria-invalid', 'true');
      setStatus(status, 'Passwords do not match.', 'error');
      confirm.focus();
      return;
    }
    setStatus(status, '');
    setLoading(submit, true, 'Creating account…');
    try {
      const { res, data } = await postJSON('/api/auth/register', {
        username: $('username').value.trim(),
        email: $('email').value,
        password: password.value,
      });
      if (res.ok) {
        setStatus(status, 'Success! Account created. Redirecting to login…', 'success');
        setTimeout(() => { location.href = withNext('/pages/auth/login.html'); }, 1500);
        return;
      }
      setStatus(status, data.message || 'Registration failed. Please try again.', 'error');
    } catch {
      setStatus(status, 'A network error occurred. Please check your connection.', 'error');
    }
    setLoading(submit, false);
  });
}

/* ---------- Forgot password ---------- */
const forgotForm = $('forgot-form');
if (forgotForm) {
  const status = $('form-status');
  const submit = forgotForm.querySelector('[type="submit"]');
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus(status, '');
    setLoading(submit, true, 'Sending…');
    try {
      const { res, data } = await postJSON('/api/auth/request-reset', { email: $('email').value });
      if (res.ok) {
        setStatus(status, 'Check your email for the link. This email may take up to 5 minutes to arrive.', 'success');
      } else {
        setStatus(status, data.message || 'Error requesting reset.', 'error');
      }
    } catch {
      setStatus(status, 'Error requesting reset.', 'error');
    }
    setLoading(submit, false);
  });
}

/* ---------- Reset password ---------- */
const resetForm = $('reset-form');
if (resetForm) {
  const token = params.get('token');
  const status = $('form-status');
  const submit = resetForm.querySelector('[type="submit"]');
  const password = $('password');
  const confirm = $('confirm-password');

  if (!token) {
    resetForm.hidden = true;
    $('reset-missing').hidden = false;
  }

  confirm.addEventListener('input', () => confirm.removeAttribute('aria-invalid'));
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (password.value !== confirm.value) {
      confirm.setAttribute('aria-invalid', 'true');
      setStatus(status, 'Passwords do not match.', 'error');
      confirm.focus();
      return;
    }
    setStatus(status, '');
    setLoading(submit, true, 'Updating…');
    try {
      const { res, data } = await postJSON('/api/auth/reset-password', { token, newPassword: password.value });
      if (res.ok) {
        setStatus(status, 'Success! Redirecting to login…', 'success');
        setTimeout(() => { location.href = '/pages/auth/login.html'; }, 2000);
        return;
      }
      setStatus(status, data.message || 'Something went wrong. Please try again.', 'error');
    } catch {
      setStatus(status, 'Network error.', 'error');
    }
    setLoading(submit, false);
  });
}
