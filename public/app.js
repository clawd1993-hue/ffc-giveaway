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
