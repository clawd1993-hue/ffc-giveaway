// FFC Creator Gear Giveaway — 2-page viral referral funnel
//   GET  /creator-giveaway               landing + entry form (ended state after GIVEAWAY_END)
//   POST /api/enter                      create/find entrant -> session cookie -> dashboard
//   GET  /creator-giveaway/dashboard     entries, share link, scripts, leaderboard (cookie-gated)
//   GET  /r/:code                        share link: logs click, sets ref cookie, redirects to the case-study opt-in with ?ref=
//   POST /api/hooks/cf                   from whop-cf-bridge: {type:'lead'|'purchase', email, first_name, last_name, ref, order_id, product, value}
//   GET  /creator-giveaway/rules         official rules
//   GET  /api/leaderboard                public top 10
//   GET  /admin/entrants|draw?token=     admin
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const PORT = process.env.PORT || 10000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CASE_STUDY_URL = process.env.CASE_STUDY_URL || 'https://go.facelessreelslab.com/free-case-study';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const HOOK_SECRET = process.env.HOOK_SECRET || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const GIVEAWAY_END = process.env.GIVEAWAY_END || '2026-10-31T23:59:59-04:00';
const WINNERS_DATE = process.env.WINNERS_DATE || 'November 3rd';
const PRIZE_NAME = process.env.PRIZE_NAME || 'MacBook Neo';
const PRIZE_VALUE = process.env.PRIZE_VALUE || '$599';
const COACHES = (process.env.COACHES || 'Not sure,Jessica,McKenzie,Ivana,Other').split(',').map(s => s.trim()).filter(Boolean);
const POINTS = { lead: 1, purchase: 4 }; // a buying friend = 1 (registered) + 4 (bonus) = 5 entries
const BASE_ENTRIES = 0; // entering alone earns nothing — you have to share
const MAIN_PRODUCT_EVENTS = new Set(['purchase']); // bridge event names that count as "bought the FFC"

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normEmail = e => String(e || '').trim().toLowerCase();
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const isEnded = () => Date.now() > new Date(GIVEAWAY_END).getTime();
const fmtEnd = () => new Date(GIVEAWAY_END).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/New_York' }) + ' ET';
// the share link IS the case-study page with the referral code on it (the bridge reads ?ref= off the CF landing URL)
const shareUrl = code => { const u = new URL(CASE_STUDY_URL); u.searchParams.set('ref', code); return u.toString(); };
const TZ = process.env.COUNTDOWN_TZ || 'America/New_York';
function tzParts(d) { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', timeZoneName: 'short' }).formatToParts(d).forEach(x => { p[x.type] = x.value; }); return p; }
function tzOffsetMs(d) { const p = tzParts(d); const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); return asUtc - d.getTime(); }
// End of the current week (Sunday 23:59:59 in TZ). If it's already past this week's end, next week's.
function weekEnd(now = new Date()) {
  const p = tzParts(now);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  const daysToSun = (7 - wd) % 7;
  let guess = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + daysToSun, 23, 59, 59) - tzOffsetMs(now));
  guess = new Date(guess.getTime() - (tzOffsetMs(guess) - tzOffsetMs(now))); // correct if DST flips before Sunday
  guess = new Date(Math.floor(guess.getTime() / 1000) * 1000);
  const hard = new Date(GIVEAWAY_END).getTime();
  return new Date(Math.min(guess.getTime(), hard));
}
function countdownBanner() {
  const end = weekEnd();
  return `<section class="banner"><div class="banner-title">⏳ Giveaway Ends In</div>
  <div class="cd" data-end="${end.toISOString()}">
    <div class="cd-unit"><b data-u="d">0</b><span>days</span></div><div class="cd-sep">:</div>
    <div class="cd-unit"><b data-u="h">00</b><span>hours</span></div><div class="cd-sep">:</div>
    <div class="cd-unit"><b data-u="m">00</b><span>minutes</span></div><div class="cd-sep">:</div>
    <div class="cd-unit"><b data-u="s">00</b><span>seconds</span></div>
  </div></section>`;
}
function genCode() { return crypto.randomBytes(4).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || crypto.randomBytes(3).toString('hex').toUpperCase(); }
function sign(v) { return crypto.createHmac('sha256', SESSION_SECRET).update(String(v)).digest('base64url'); }
function setSession(res, id) { res.setHeader('Set-Cookie', [`gw=${id}.${sign(id)}; Path=/; Max-Age=${60 * 60 * 24 * 90}; HttpOnly; SameSite=Lax${PUBLIC_URL.startsWith('https') ? '; Secure' : ''}`, ...(res.getHeader('Set-Cookie') ? [].concat(res.getHeader('Set-Cookie')) : [])]); }
function cookies(req) { const out = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return out; }
function sessionId(req) { const c = cookies(req).gw || ''; const [id, sig] = c.split('.'); if (!id || !sig) return null; return sig === sign(id) ? Number(id) : null; }
function refCookie(res, code) { const prev = res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie', [...(prev ? [].concat(prev) : []), `gw_ref=${encodeURIComponent(code)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`]); }
function nameParts(name, email) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) { const l = String(email || '').split('@')[0].replace(/[._+-]+/g, ' ').trim(); const w = l.split(' ')[0] || 'Someone'; return { first: w.charAt(0).toUpperCase() + w.slice(1, 12), lastInitial: '' }; }
  return { first: p[0], lastInitial: p.length > 1 ? p[p.length - 1][0].toUpperCase() + '.' : '' };
}

// ---------- data ----------
async function findEntrantByEmail(email) { const r = await db.q('SELECT * FROM gw_entrants WHERE email=$1', [email]); return r.rows[0] || null; }
async function findEntrantByCode(code) { if (!code) return null; const r = await db.q('SELECT * FROM gw_entrants WHERE referral_code=$1', [String(code).toUpperCase()]); return r.rows[0] || null; }
async function createEntrant({ name, email, support_coach, referred_by }) {
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    try {
      const r = await db.q('INSERT INTO gw_entrants(name,email,support_coach,referral_code,referred_by,entries) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [name, email, support_coach || null, code, referred_by || null, BASE_ENTRIES]);
      return r.rows[0];
    } catch (e) { if (!/gw_entrants_referral_code_key/.test(e.message)) throw e; }
  }
  throw new Error('could not allocate referral code');
}
// A friend registered for the case study (or entered the giveaway) via someone's link. One credit per friend email, ever.
async function recordLead({ email, name, referrer_code, source }) {
  const ref = await findEntrantByCode(referrer_code);
  const ins = await db.q('INSERT INTO gw_leads(email,referrer_code,source) VALUES($1,$2,$3) ON CONFLICT (email) DO NOTHING RETURNING id', [email, ref ? ref.referral_code : null, source || null]);
  const isNew = ins.rowCount === 1;
  if (isNew && ref && ref.email !== email && !isEnded()) {
    await db.q('UPDATE gw_entrants SET entries=entries+$1, referral_count=referral_count+1 WHERE id=$2', [POINTS.lead, ref.id]);
  }
  // the friend is entered too (1 base entry) so they get their own link
  let friend = await findEntrantByEmail(email);
  if (!friend && isNew) friend = await createEntrant({ name: name || '', email, referred_by: ref ? ref.referral_code : null });
  return { isNew, credited: isNew && !!ref && ref.email !== email, referrer: ref, friend };
}
// A friend bought the FFC. +4 to the referrer, once per order; referrer = ref on the order, else the ref stored on their lead.
async function recordPurchase({ order_id, email, referrer_code, product, value, name }) {
  let ref = await findEntrantByCode(referrer_code);
  if (ref && ref.email !== email) await recordLead({ email, name, referrer_code: ref.referral_code, source: 'purchase' }); // no-op if already a lead
  if (!ref) { const l = await db.q('SELECT referrer_code FROM gw_leads WHERE email=$1', [email]); if (l.rows[0]?.referrer_code) ref = await findEntrantByCode(l.rows[0].referrer_code); }
  if (!ref) { const e = await findEntrantByEmail(email); if (e?.referred_by) ref = await findEntrantByCode(e.referred_by); }
  const ins = await db.q('INSERT INTO gw_purchases(order_id,email,referrer_code,product,value) VALUES($1,$2,$3,$4,$5) ON CONFLICT (order_id) DO NOTHING RETURNING id', [String(order_id), email, ref ? ref.referral_code : null, product || null, value ?? null]);
  const isNew = ins.rowCount === 1;
  let credited = false;
  if (isNew && ref && ref.email !== email && !isEnded()) {
    // only the first FFC purchase per buyer email counts for a bonus
    const prior = await db.q('SELECT count(*)::int AS n FROM gw_purchases WHERE email=$1 AND referrer_code=$2 AND order_id<>$3', [email, ref.referral_code, String(order_id)]);
    if (prior.rows[0].n === 0) { await db.q('UPDATE gw_entrants SET entries=entries+$1, buyer_count=buyer_count+1 WHERE id=$2', [POINTS.purchase, ref.id]); credited = true; }
  }
  return { isNew, credited, referrer: ref };
}
async function leaderboard(limit = 10) {
  const r = await db.q(`
    SELECT e.name, e.email, e.entries,
      COALESCE((SELECT count(*) FROM gw_leads l WHERE l.referrer_code=e.referral_code AND l.created_at > now() - interval '7 days'),0)::int * $2
      + COALESCE((SELECT count(*) FROM gw_purchases p WHERE p.referrer_code=e.referral_code AND p.created_at > now() - interval '7 days'),0)::int * $3 AS week_points
    FROM gw_entrants e
    ORDER BY week_points DESC, e.entries DESC, e.created_at ASC
    LIMIT $1`, [limit, POINTS.lead, POINTS.purchase]);
  return r.rows.map(x => { const n = nameParts(x.name, x.email); return { name: `${n.first} ${n.lastInitial}`.trim() || 'New entrant', entries: x.entries, week_points: x.week_points }; });
}

// ---------- pages ----------
function layout({ title, body, extraHead = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/style.css?v=7">${extraHead}</head><body>
<main class="wrap">${body}</main>
<footer class="foot">Faceless Funnel Challenge · <a href="/creator-giveaway/rules">Official Rules</a> · No purchase necessary. Void where prohibited.</footer>
<script src="/static/app.js?v=5"></script></body></html>`;
}

function landingPage({ prefillEmail = '', ref = '', ended = false }) {
  const formOrEnded = ended
    ? `<div class="card ended"><h3>This giveaway has ended</h3><p>Winners are being contacted by email. Thanks to everyone who entered and shared.</p><a class="btn" href="${esc(CASE_STUDY_URL)}">Watch the free faceless brand case study →</a></div>`
    : `<form class="card form" id="enter-form" method="post" action="/api/enter" autocomplete="on">
        <input type="hidden" name="ref" value="${esc(ref)}">
        <label>Email<input name="email" type="email" required placeholder="you@email.com" value="${esc(prefillEmail)}" maxlength="120"></label>
        <button class="btn big" type="submit">Enter &amp; Get My Share Link</button>
        <p class="tiny muted">By entering you agree to the <a href="/creator-giveaway/rules">Official Rules</a>. We'll only email you about this giveaway.</p>
      </form>`;
  const body = `
  ${ended ? '' : countdownBanner()}
  <section class="hero">
    <div class="hero-text">
      <span class="pill">🎁 Creator Gear Giveaway</span>
      <h1>Win a ${esc(PRIZE_NAME)} to Build Your Faceless Digital Product Brand</h1>
      <p class="sub">This week we're giving away a ${esc(PRIZE_NAME)} and 5× $1,000 "Business Funding" scholarships to 5 FFC members! Enter your details below to register for the giveaway.</p>
      <a class="btn big" href="#enter">Enter &amp; Get My Share Link</a>
    </div>
    <div class="hero-img"><img src="/static/img/macbook.jpg" alt="${esc(PRIZE_NAME)}" width="640" height="480"><span class="tag">${esc(PRIZE_VALUE)} value</span></div>
  </section>
  <section id="enter" class="two">
    ${formOrEnded}
    <div class="how">
      <h3>How it works</h3>
      <ol>
        <li><b>Enter</b> with your email.</li>
        <li><b>Get a personal link</b> on the next page.</li>
        <li><b>Share it.</b> Every friend who registers for the free case study using your link = entries for you.</li>
      </ol>
      <div class="points"><span>1 entry</span> per friend who registers <span>5 entries</span> per friend who joins the Challenge</div>
    </div>
  </section>
  <section class="rules">
    <h4>Prizes &amp; the fine print</h4>
    <ul>
      <li>1 × ${esc(PRIZE_NAME)} (approx. ${esc(PRIZE_VALUE)} value).</li>
      <li>5 × $1,000 "Business Funding" scholarships for FFC members.</li>
      <li>Ends <b>${esc(fmtEnd())}</b>. Winners announced ${esc(WINNERS_DATE)}.</li>
      <li>No purchase necessary. Void where prohibited. <a href="/creator-giveaway/rules">Official Rules</a>.</li>
    </ul>
  </section>`;
  return layout({ title: `Win a ${PRIZE_NAME} — Creator Gear Giveaway`, body });
}

function dashboardPage({ e, board, ended }) {
  const link = shareUrl(e.referral_code);
  const registered = Math.max(0, e.referral_count - e.buyer_count); // friends who registered but haven't joined yet
  const joined = e.buyer_count;
  const total = e.entries;
  const hasEntries = total > 0;
  const dm = `Hey, random favor?\n\nI'm in a 10-day faceless creator challenge that shows beginners how to build a silent Instagram brand + simple digital products without being on camera.\n\nThey're giving away a ${PRIZE_NAME} this month to help someone build their setup. Every friend who registers for their free faceless brand case study gives me extra entries and you get entered too.\n\nIf you're cool with it, just drop your email here so it counts for both of us: ${link}`;
  const em = `Subject: quick favor (30 seconds)\n\nHey,\n\nI joined a 10-day faceless creator challenge — it teaches beginners how to build a faceless Instagram brand and sell simple digital products, no camera needed.\n\nThey're giving away a ${PRIZE_NAME} this month. If you register for their free faceless brand case study through my link, I get extra entries and you get entered too:\n\n${link}\n\nThanks!`;
  const rows = board.length ? board.map((b, i) => `<li><span class="rank">${i + 1}</span><span class="who">${esc(b.name)}</span><span class="pts">${b.entries} ${b.entries === 1 ? 'entry' : 'entries'}</span></li>`).join('') : '<li class="muted">Be the first on the board — share your link.</li>';
  const head = hasEntries
    ? `<span class="pill">✅ You're entered</span><h1>You're Entered! 🎉</h1><p class="sub big">Get more chances to win: follow the instructions below.</p>`
    : `<span class="pill">⚡ One more step</span><h1>You're Almost Entered…<br>Last Step!</h1><p class="sub big">Share your link below. Your first friend who registers = your first entry.</p>`;
  const body = `
  <section class="dash-top">
    ${head}
    ${ended ? `<div class="notice">Giveaway closed, winners announced on ${esc(WINNERS_DATE)}. Entries are frozen.</div>` : ''}
  </section>
  <section class="card math">
    <h3>Your entries</h3>
    <div class="mathrow">
      <div class="term"><b>${registered}</b><span>friends registered</span></div><div class="op">×</div><div class="term"><b>1</b><span>entry</span></div>
      <div class="op">+</div>
      <div class="term"><b>${joined}</b><span>friends joined</span></div><div class="op">×</div><div class="term"><b>5</b><span>entries</span></div>
      <div class="op">=</div>
      <div class="term total"><b>${total}</b><span>${total === 1 ? 'entry' : 'entries'}</span></div>
    </div>
    ${hasEntries ? '' : '<p class="muted tiny">Entries update automatically the moment a friend registers.</p>'}
  </section>
  <section class="card share">
    <h3>Share your link</h3>
    <ul class="earn">
      <li>Every friend who registers for the free case study through your link <b>(= 1 entry)</b></li>
      <li>Every friend who joins the 10‑Day Faceless Creator Challenge through your link <b>(= 5 entries)</b></li>
      <li>Everyone you bring in gets entered to win the ${esc(PRIZE_NAME)} too.</li>
    </ul>
  </section>
  <section class="card scripts">
    <h3>Just copy &amp; paste the message below to share with your friends and family</h3>
    <p class="muted">✅ Your personal link <span class="mono">${esc(link)}</span> is already inside the message. You'll <b>both</b> be entered to win the ${esc(PRIZE_NAME)}!</p>
    <label>DM / text message<textarea id="dm" rows="9" readonly>${esc(dm)}</textarea><button class="btn" data-copy="#dm">Copy Message</button></label>
    <label>Email version<textarea id="em" rows="10" readonly>${esc(em)}</textarea><button class="btn" data-copy="#em">Copy Email</button></label>
    <p class="tiny muted">Just want the link? <span class="mono" id="share-link-text">${esc(link)}</span> <button class="linkbtn" data-copy="#share-link-text">copy</button></p>
  </section>
  <section class="card board">
    <h3>🏆 Top Referrers This Week</h3>
    <ol class="lb">${rows}</ol>
  </section>`;
  return layout({ title: hasEntries ? "You're entered — Creator Gear Giveaway" : 'Last step — Creator Gear Giveaway', body });
}

function rulesPage() {
  const body = `<section class="card rules-page"><h1>Official Rules — Creator Gear Giveaway</h1>
  <p><b>Sponsor:</b> Faceless Funnel Challenge. <b>No purchase necessary to enter or win.</b> A purchase does not increase your chances of winning beyond the bonus entries described below, which are also available by other means (see Alternate Entry).</p>
  <p><b>Eligibility:</b> Open to individuals 18+ where permitted by law. Void where prohibited. Employees and contractors of the Sponsor are not eligible.</p>
  <p><b>Period:</b> Ends ${esc(fmtEnd())}. Winners announced ${esc(WINNERS_DATE)} and contacted by email.</p>
  <p><b>How to enter:</b> Submit the entry form to receive your personal link. You earn 1 entry for each friend who registers for the free faceless brand case study through your link, and 5 entries in total for each friend who joins the 10‑Day Faceless Creator Challenge through your link. Referral credits are counted once per unique friend.</p>
  <p><b>Alternate entry:</b> Email support@facelessfunnelchallenge.com with subject "Giveaway entry" and your name to receive one entry without any purchase or referral. Referral entries are available free of charge by sharing your link.</p>
  <p><b>Prizes:</b> One (1) ${esc(PRIZE_NAME)} (approx. retail value ${esc(PRIZE_VALUE)}). Five (5) $1,000 "Business Funding" scholarships for FFC members (credit toward FFC programs; non‑transferable, no cash value). Sponsor may substitute a prize of equal or greater value.</p>
  <p><b>Winner selection:</b> Random drawing weighted by valid entries. Winners must respond within 7 days or an alternate is drawn.</p>
  <p><b>General:</b> Entries generated by scripts, fake accounts or self‑referrals are void. Sponsor's decisions are final. This promotion is not sponsored, endorsed, administered by, or associated with Instagram, Meta or Apple.</p>
  <p><a class="btn" href="/creator-giveaway">← Back to the giveaway</a></p></section>`;
  return layout({ title: 'Official Rules — Creator Gear Giveaway', body });
}

// ---------- routes ----------
app.get('/', (req, res) => res.redirect('/creator-giveaway'));
app.get('/health', (req, res) => res.json({ ok: true, ended: isEnded(), end: GIVEAWAY_END }));

app.get('/creator-giveaway', async (req, res) => {
  const ref = String(req.query.ref || cookies(req).gw_ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (req.query.ref && ref) refCookie(res, ref);
  const sid = sessionId(req);
  if (sid && !req.query.email && !req.query.ref) { const r = await db.q('SELECT id FROM gw_entrants WHERE id=$1', [sid]); if (r.rows[0]) return res.redirect('/creator-giveaway/dashboard'); }
  res.send(landingPage({ prefillEmail: isEmail(normEmail(req.query.email)) ? normEmail(req.query.email) : '', ref, ended: isEnded() }));
});

app.post('/api/enter', async (req, res) => {
  try {
    if (isEnded()) return res.redirect('/creator-giveaway');
    const name = String(req.body.name || '').trim().slice(0, 80);
    const email = normEmail(req.body.email);
    const support_coach = String(req.body.support_coach || '').trim().slice(0, 60) || null;
    const ref = String(req.body.ref || cookies(req).gw_ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!isEmail(email)) return res.status(400).send(layout({ title: 'Oops', body: '<section class="card"><h3>Please enter a valid email.</h3><a class="btn" href="/creator-giveaway">Try again</a></section>' }));
    let e = await findEntrantByEmail(email);
    if (e) {
      if (support_coach && !e.support_coach) await db.q('UPDATE gw_entrants SET support_coach=$1 WHERE id=$2', [support_coach, e.id]);
    } else {
      // entering via a friend's link counts as that friend's referral (one credit per email, shared with case-study leads)
      const lead = ref ? await recordLead({ email, name, referrer_code: ref, source: 'giveaway_page' }) : null;
      e = (lead && lead.friend) || await findEntrantByEmail(email) || await createEntrant({ name, email, support_coach, referred_by: ref || null });
      if ((name && e.name !== name) || (support_coach && !e.support_coach)) { await db.q('UPDATE gw_entrants SET name=COALESCE(NULLIF($1,\'\'),name), support_coach=COALESCE(support_coach,$2) WHERE id=$3', [name, support_coach, e.id]); }
    }
    setSession(res, e.id);
    if (req.headers.accept && req.headers.accept.includes('application/json')) return res.json({ ok: true, redirect: '/creator-giveaway/dashboard', referral_code: e.referral_code, share_url: shareUrl(e.referral_code) });
    res.redirect('/creator-giveaway/dashboard');
  } catch (err) { console.error('enter error', err); res.status(500).send(layout({ title: 'Error', body: '<section class="card"><h3>Something went wrong. Please try again.</h3><a class="btn" href="/creator-giveaway">Back</a></section>' })); }
});

app.get('/creator-giveaway/dashboard', async (req, res) => {
  const sid = sessionId(req);
  if (!sid) return res.redirect('/creator-giveaway');
  const r = await db.q('SELECT * FROM gw_entrants WHERE id=$1', [sid]);
  if (!r.rows[0]) return res.redirect('/creator-giveaway');
  res.setHeader('Cache-Control', 'no-store');
  res.send(dashboardPage({ e: r.rows[0], board: await leaderboard(10), ended: isEnded() }));
});

// magic link for emails: /creator-giveaway/me?email=... -> dashboard (only if the entrant exists)
app.get('/creator-giveaway/me', async (req, res) => {
  const e = await findEntrantByEmail(normEmail(req.query.email));
  if (!e) return res.redirect('/creator-giveaway' + (req.query.email ? `?email=${encodeURIComponent(normEmail(req.query.email))}` : ''));
  setSession(res, e.id); res.redirect('/creator-giveaway/dashboard');
});

app.get('/r/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const e = await findEntrantByCode(code);
  if (e && !isEnded()) { db.q('INSERT INTO gw_clicks(referral_code,ip,user_agent) VALUES($1,$2,$3)', [code, req.ip, String(req.headers['user-agent'] || '').slice(0, 300)]).catch(() => {}); refCookie(res, code); }
  const u = new URL(CASE_STUDY_URL);
  if (e) { u.searchParams.set('ref', code); u.searchParams.set('utm_source', 'giveaway'); u.searchParams.set('utm_medium', 'referral'); u.searchParams.set('utm_campaign', 'creator-gear-giveaway'); }
  res.redirect(302, u.toString());
});

app.get('/api/leaderboard', async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await leaderboard(10)); });

// whop-cf-bridge forwards ClickFunnels events here
app.post('/api/hooks/cf', async (req, res) => {
  try {
    if (HOOK_SECRET && req.headers['x-hook-secret'] !== HOOK_SECRET) return res.status(401).json({ error: 'bad secret' });
    const b = req.body || {};
    const email = normEmail(b.email);
    if (!isEmail(email)) return res.json({ ok: true, ignored: 'no_email' });
    const ref = String(b.ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    const name = [b.first_name, b.last_name].filter(Boolean).join(' ').trim();
    if (b.type === 'lead') {
      const r = await recordLead({ email, name, referrer_code: ref, source: 'case_study' });
      return res.json({ ok: true, type: 'lead', new: r.isNew, credited: r.credited, referrer: r.referrer?.referral_code || null });
    }
    if (b.type === 'purchase') {
      if (b.event && !MAIN_PRODUCT_EVENTS.has(b.event)) return res.json({ ok: true, ignored: `event ${b.event}` });
      if (!b.order_id) return res.json({ ok: true, ignored: 'no_order_id' });
      const r = await recordPurchase({ order_id: b.order_id, email, referrer_code: ref, product: b.product, value: b.value, name });
      return res.json({ ok: true, type: 'purchase', new: r.isNew, credited: r.credited, referrer: r.referrer?.referral_code || null });
    }
    res.json({ ok: true, ignored: 'unknown type' });
  } catch (err) { console.error('hook error', err); res.status(500).json({ ok: false, error: String(err.message || err) }); }
});

app.get('/creator-giveaway/rules', (req, res) => res.send(rulesPage()));

// ---------- admin ----------
function admin(req, res) { if (!ADMIN_TOKEN || req.query.token !== ADMIN_TOKEN) { res.status(401).json({ error: 'unauthorized' }); return false; } return true; }
app.get('/admin/entrants', async (req, res) => {
  if (!admin(req, res)) return;
  const r = await db.q('SELECT id,name,email,support_coach,referral_code,referred_by,entries,referral_count,buyer_count,created_at FROM gw_entrants ORDER BY entries DESC, created_at ASC');
  if (req.query.format === 'csv') {
    res.type('text/csv').attachment('entrants.csv');
    return res.send(['id,name,email,support_coach,referral_code,referred_by,entries,referral_count,buyer_count,created_at', ...r.rows.map(x => [x.id, x.name, x.email, x.support_coach || '', x.referral_code, x.referred_by || '', x.entries, x.referral_count, x.buyer_count, x.created_at.toISOString()].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n'));
  }
  const totals = await db.q('SELECT (SELECT count(*) FROM gw_entrants)::int AS entrants,(SELECT coalesce(sum(entries),0) FROM gw_entrants)::int AS entries,(SELECT count(*) FROM gw_leads)::int AS leads,(SELECT count(*) FROM gw_purchases)::int AS purchases,(SELECT count(*) FROM gw_clicks)::int AS clicks');
  res.json({ totals: totals.rows[0], entrants: r.rows });
});
app.get('/admin/draw', async (req, res) => {
  if (!admin(req, res)) return;
  const r = await db.q('SELECT id,name,email,entries FROM gw_entrants WHERE entries>0');
  const total = r.rows.reduce((s, x) => s + x.entries, 0);
  if (!total) return res.json({ winner: null, total_entries: 0 });
  let n = crypto.randomInt(total); let winner = null;
  for (const x of r.rows) { if (n < x.entries) { winner = x; break; } n -= x.entries; }
  res.json({ winner, total_entries: total, entrants: r.rows.length, drawn_at: new Date().toISOString() });
});
app.get('/admin/entrant', async (req, res) => {
  if (!admin(req, res)) return;
  const e = await findEntrantByEmail(normEmail(req.query.email)); if (!e) return res.status(404).json({ error: 'not found' });
  const leads = await db.q('SELECT email,source,created_at FROM gw_leads WHERE referrer_code=$1 ORDER BY created_at', [e.referral_code]);
  const buys = await db.q('SELECT email,order_id,product,value,created_at FROM gw_purchases WHERE referrer_code=$1 ORDER BY created_at', [e.referral_code]);
  const clicks = await db.q('SELECT count(*)::int AS n FROM gw_clicks WHERE referral_code=$1', [e.referral_code]);
  res.json({ entrant: e, share_url: shareUrl(e.referral_code), clicks: clicks.rows[0].n, leads: leads.rows, purchases: buys.rows });
});

app.use((req, res) => res.status(404).send(layout({ title: 'Not found', body: '<section class="card"><h3>Page not found</h3><a class="btn" href="/creator-giveaway">Go to the giveaway</a></section>' })));

if (require.main === module) {
  // Start listening right away (health check passes), then create tables; retry if the DB is waking up (Supabase free tier pauses).
  app.listen(PORT, () => console.log(`ffc-giveaway listening on :${PORT} public=${PUBLIC_URL} ends=${GIVEAWAY_END} ended=${isEnded()}`));
  (async () => {
    for (let i = 1; ; i++) {
      try { await db.init(); console.log('db ready'); break; }
      catch (err) { console.error(`db init failed (attempt ${i}): ${err.message}`); await new Promise(r => setTimeout(r, Math.min(60000, 5000 * i))); }
    }
  })();
}
module.exports = { app, recordLead, recordPurchase, leaderboard };
