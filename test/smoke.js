// End-to-end smoke against a real DATABASE_URL on a throwaway port. Uses unique test emails; cleans up after.
process.env.PORT = process.env.PORT || '10777';
process.env.PUBLIC_URL = `http://localhost:${process.env.PORT}`;
process.env.HOOK_SECRET = 'testsecret'; process.env.ADMIN_TOKEN = 'testadmin';
const db = require('../db'); const { app } = require('../server');
const T = Date.now(); const A = `smoke-a-${T}@example.com`, B = `smoke-b-${T}@example.com`, C = `smoke-c-${T}@example.com`;
const base = process.env.PUBLIC_URL; let fails = 0;
const ok = (c, m) => { console.log((c ? '✅' : '❌') + ' ' + m); if (!c) fails++; };
const J = async (p, o = {}) => { const r = await fetch(base + p, { redirect: 'manual', ...o }); let body = null; try { body = await r.clone().json(); } catch { body = await r.text(); } return { r, body }; };
(async () => {
  await db.init(); const srv = app.listen(process.env.PORT);
  try {
    // 1 enter
    let { r, body } = await J('/api/enter', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ email: A }) });
    ok(r.status === 200 && body.share_url && body.share_url.includes('free-case-study?ref=') && body.referral_code, 'enter creates entrant + case-study share link');
    const code = body.referral_code; const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    // 2 dashboard
    ({ r, body } = await J('/creator-giveaway/dashboard', { headers: { cookie } }));
    ok(r.status === 200 && body.includes('Almost Entered') && body.includes(`free-case-study?ref=${code}`), 'dashboard (0 entries) shows Almost Entered + case-study share link');
    ({ r } = await J('/creator-giveaway/dashboard')); ok(r.status === 302, 'dashboard without cookie redirects');
    // 3 re-enter same email -> same code
    ({ r, body } = await J('/api/enter', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ name: 'Smoke Alpha', email: A.toUpperCase() }) }));
    ok(body.referral_code === code, 're-enter with same email returns existing code');
    // 4 share link redirect
    ({ r } = await J(`/r/${code}`)); const loc = r.headers.get('location') || '';
    ok(r.status === 302 && loc.includes(`ref=${code}`) && loc.startsWith('https://go.facelessreelslab.com/free-case-study'), 'share link redirects to case study with ref');
    // 5 lead hook (+1)
    ({ body } = await J('/api/hooks/cf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hook-secret': 'testsecret' }, body: JSON.stringify({ type: 'lead', email: B, first_name: 'Smoke', last_name: 'Bravo', ref: code }) }));
    ok(body.credited === true, 'lead with ref credits referrer');
    ({ body } = await J('/api/hooks/cf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hook-secret': 'testsecret' }, body: JSON.stringify({ type: 'lead', email: B, ref: code }) }));
    ok(body.credited === false, 'duplicate lead not credited twice');
    ({ r } = await J('/api/hooks/cf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lead', email: C, ref: code }) }));
    ok(r.status === 401, 'hook rejects missing secret');
    // 6 purchase hook without ref -> falls back to lead's referrer (+4)
    ({ body } = await J('/api/hooks/cf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hook-secret': 'testsecret' }, body: JSON.stringify({ type: 'purchase', email: B, order_id: `o-${T}-1`, product: 'FF Challenge', event: 'purchase', value: 6.95 }) }));
    ok(body.credited === true, 'purchase falls back to lead referrer and credits +4');
    ({ body } = await J('/api/hooks/cf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hook-secret': 'testsecret' }, body: JSON.stringify({ type: 'purchase', email: B, order_id: `o-${T}-1`, event: 'purchase', value: 6.95 }) }));
    ok(body.new === false, 'same order not counted twice');
    ({ body } = await J('/api/hooks/cf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hook-secret': 'testsecret' }, body: JSON.stringify({ type: 'purchase', email: B, order_id: `o-${T}-2`, event: 'oto_dfy_products', value: 47 }) }));
    ok(body.ignored, 'upsell products ignored');
    // 7 totals
    ({ body } = await J(`/admin/entrant?token=testadmin&email=${A}`));
    ok(body.entrant.entries === 5 && body.entrant.referral_count === 1 && body.entrant.buyer_count === 1, `entrant totals = 0 base +1 lead +4 buyer = 5 (got ${body.entrant.entries})`);
    // 8 friend got their own entry + self-referral blocked
    ({ body } = await J(`/admin/entrant?token=testadmin&email=${B}`)); ok(body.entrant && body.entrant.entries === 0 && body.entrant.referred_by === code, 'referred friend is entered with 0 entries (must share)');
    ({ body } = await J('/api/hooks/cf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hook-secret': 'testsecret' }, body: JSON.stringify({ type: 'lead', email: A, ref: code }) }));
    ok(body.credited === false, 'self-referral not credited');
    // 9 leaderboard + rules + landing + ended
    ({ body } = await J('/api/leaderboard')); ok(Array.isArray(body) && body.some(x => x.name.startsWith('Smoke')), 'leaderboard shows a display name derived from email when no name given');
    ({ r, body } = await J('/creator-giveaway?email=' + C)); ok(r.status === 200 && body.includes(`value="${C}"`), 'landing prefills email');
    ({ r } = await J('/creator-giveaway/rules')); ok(r.status === 200, 'rules page');
    ({ body } = await J('/admin/draw?token=testadmin')); ok(body.winner && body.total_entries > 0, 'weighted draw returns a winner');
    ({ r, body } = await J('/creator-giveaway/dashboard', { headers: { cookie } })); ok(body.includes("You're Entered") && body.includes('friends joined'), 'dashboard (with entries) shows Entered + math bubble');
  } finally {
    await db.q('DELETE FROM gw_clicks WHERE referral_code IN (SELECT referral_code FROM gw_entrants WHERE email LIKE $1)', [`smoke-%-${T}@example.com`]);
    await db.q('DELETE FROM gw_purchases WHERE email LIKE $1', [`smoke-%-${T}@example.com`]);
    await db.q('DELETE FROM gw_leads WHERE email LIKE $1', [`smoke-%-${T}@example.com`]);
    await db.q('DELETE FROM gw_entrants WHERE email LIKE $1', [`smoke-%-${T}@example.com`]);
    srv.close(); await db.pool.end();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
