// copy buttons + form submit (JSON) with graceful fallback to a normal POST
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-copy]'); if (!b) return;
  const el = document.querySelector(b.getAttribute('data-copy')); if (!el) return;
  const txt = el.value || el.textContent;
  try { await navigator.clipboard.writeText(txt); } catch (_) { el.select && el.select(); document.execCommand && document.execCommand('copy'); }
  const old = b.textContent; b.textContent = 'Copied ✓'; b.classList.add('copied'); setTimeout(() => { b.textContent = old; b.classList.remove('copied'); }, 1600);
});
const f = document.getElementById('enter-form');
if (f) f.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'One sec…';
  try {
    const r = await fetch('/api/enter', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(f))) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.redirect) { location.href = j.redirect; return; }
    throw new Error('bad response');
  } catch (_) { f.submit(); }
});

// countdown banner (days/hours/minutes/seconds to data-end); reloads when it hits zero so the next week's deadline shows
const cd = document.querySelector('.cd[data-end]');
if (cd) {
  const end = new Date(cd.getAttribute('data-end')).getTime();
  const u = { d: cd.querySelector('[data-u=d]'), h: cd.querySelector('[data-u=h]'), m: cd.querySelector('[data-u=m]'), s: cd.querySelector('[data-u=s]') };
  const pad = n => String(n).padStart(2, '0');
  const tick = () => {
    let ms = Math.max(0, end - Date.now());
    const d = Math.floor(ms / 864e5); ms -= d * 864e5;
    const h = Math.floor(ms / 36e5); ms -= h * 36e5;
    const m = Math.floor(ms / 6e4); ms -= m * 6e4;
    const s = Math.floor(ms / 1e3);
    u.d.textContent = d; u.h.textContent = pad(h); u.m.textContent = pad(m); u.s.textContent = pad(s);
    if (end - Date.now() <= 0) { clearInterval(t); setTimeout(() => location.reload(), 1500); }
  };
  tick(); const t = setInterval(tick, 1000);
}

// auto-size the script textareas so the whole message (incl. the link at the end) is visible without scrolling
document.querySelectorAll('.scripts textarea').forEach(t => { const fit = () => { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 4) + 'px'; }; fit(); window.addEventListener('resize', fit); });
