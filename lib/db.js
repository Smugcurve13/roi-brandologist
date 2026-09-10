import { neon } from "@neondatabase/serverless";

// Neon's Vercel integration injects a family of variables and the exact set has
// changed over time; the older Vercel Postgres integration used POSTGRES_*.
// Take the first one present rather than assuming a single name, so a naming
// difference can't silently leave the site returning 503.
const CONNECTION_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
];

export const connectionVar = CONNECTION_VARS.find((k) => process.env[k]) || null;
const CONNECTION_STRING = connectionVar ? process.env[connectionVar] : "";

export const isConfigured = Boolean(CONNECTION_STRING);

let _sql = null;
export function db() {
  if (!isConfigured) {
    throw new Error("DATABASE_URL is not set — connect the Neon integration in Vercel.");
  }
  if (!_sql) _sql = neon(CONNECTION_STRING);
  return _sql;
}

// The two lead types are deliberately separate tables. They have different
// shapes and different lifecycles: an ROI lead is one row that gets updated as
// the visitor completes later steps, while a playbook lead is a single
// standalone capture that may have no assessment behind it at all.
const SCHEMA = [
  `create table if not exists roi_leads (
     id                      bigserial primary key,
     created_at              timestamptz not null default now(),
     updated_at              timestamptz not null default now(),
     name                    text,
     company                 text,
     whatsapp                text,
     answers                 jsonb,
     investment              numeric,
     confirmed_business      numeric,
     total_score             integer,
     max_score               integer,
     result_category         text,
     assessment_status       text,
     last_question_completed integer,
     qualification           jsonb,
     help_required           text,
     roi_review_requested    boolean not null default false,
     utm_source              text,
     utm_campaign            text,
     landing_page_source     text
   )`,
  `create table if not exists playbook_leads (
     id                  bigserial primary key,
     created_at          timestamptz not null default now(),
     contact_mode        text,
     phone               text,
     email               text,
     name                text,
     company             text,
     source              text,
     utm_source          text,
     utm_campaign        text,
     landing_page_source text
   )`,
  `create index if not exists roi_leads_created_at_idx on roi_leads (created_at desc)`,
  `create index if not exists playbook_leads_created_at_idx on playbook_leads (created_at desc)`,
];

// Serverless functions are cold-started per instance, so guard with a
// module-level flag: `create table if not exists` is cheap but not free.
let ensured = false;
export async function ensureSchema() {
  if (ensured) return;
  const sql = db();
  for (const stmt of SCHEMA) await sql(stmt);
  ensured = true;
}

export const TABLES = {
  roi: {
    table: "roi_leads",
    label: "Exhibition ROI Score",
    columns: [
      "id", "created_at", "name", "company", "whatsapp",
      "total_score", "max_score", "result_category", "assessment_status",
      "last_question_completed", "investment", "confirmed_business",
      "answers", "qualification", "help_required", "roi_review_requested",
      "utm_source", "utm_campaign", "landing_page_source",
    ],
  },
  playbook: {
    table: "playbook_leads",
    label: "Playbook Early Access",
    columns: [
      "id", "created_at", "contact_mode", "phone", "email",
      "name", "company", "source",
      "utm_source", "utm_campaign", "landing_page_source",
    ],
  },
};

// Only ever resolve a table through this — never interpolate a caller-supplied
// name into SQL.
export function resolveTable(key) {
  return Object.prototype.hasOwnProperty.call(TABLES, key) ? TABLES[key] : null;
}
