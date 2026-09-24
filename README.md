# ffc-giveaway — FFC Creator Gear Giveaway

2-page viral referral funnel. Landing (`/creator-giveaway`) → entry form → dashboard (`/creator-giveaway/dashboard`) with live entries, personal share link (`/r/CODE`), copy-paste scripts, weekly top-10 leaderboard.

**Mechanic:** 1 entry for entering · +1 per friend who registers for the free case study via your link · +4 when a referred friend buys the FFC.

**How referrals flow:** `/r/CODE` → 302 to `CASE_STUDY_URL?ref=CODE` (ClickFunnels). The CF head script stores `ref` and fills a hidden `giveaway_ref` field on the opt-in + checkout forms → CF webhook → `whop-cf-bridge` → `POST /api/hooks/cf` here (`{type: lead|purchase, email, ref, order_id, product, event}`) → entries credited. Purchases without a ref fall back to the ref stored on the buyer's lead.

**Env:** `DATABASE_URL` (Postgres/Supabase), `PUBLIC_URL`, `CASE_STUDY_URL`, `SESSION_SECRET`, `HOOK_SECRET` (bridge sends `x-hook-secret`), `ADMIN_TOKEN`, `GIVEAWAY_END` (ISO), `WINNERS_DATE`, `PRIZE_NAME`, `PRIZE_VALUE`, `COACHES` (comma list).

**Admin:** `/admin/entrants?token=` (`&format=csv`), `/admin/entrant?token=&email=`, `/admin/draw?token=` (weighted random winner).

**Ended state:** after `GIVEAWAY_END` the landing shows "ended" + case-study CTA; dashboard freezes entries; hooks stop crediting.
