// Postgres (Supabase) access for the giveaway. Tables are prefixed gw_ so they can live next to other apps.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gw_entrants (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  support_coach  TEXT,
  referral_code  TEXT NOT NULL UNIQUE,
  referred_by    TEXT,
  entries        INTEGER NOT NULL DEFAULT 1,
  referral_count INTEGER NOT NULL DEFAULT 0,
  buyer_count    INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gw_leads (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  referrer_code TEXT,
  source        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gw_purchases (
  id            SERIAL PRIMARY KEY,
  order_id      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  referrer_code TEXT,
  product       TEXT,
  value         NUMERIC,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gw_clicks (
  id            SERIAL PRIMARY KEY,
  referral_code TEXT NOT NULL,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gw_leads_ref_idx ON gw_leads(referrer_code);
CREATE INDEX IF NOT EXISTS gw_purchases_ref_idx ON gw_purchases(referrer_code);
CREATE INDEX IF NOT EXISTS gw_purchases_email_idx ON gw_purchases(email);
CREATE INDEX IF NOT EXISTS gw_clicks_ref_idx ON gw_clicks(referral_code);
`;

async function init() { await pool.query(SCHEMA); }
const q = (text, params) => pool.query(text, params);

module.exports = { pool, q, init };
