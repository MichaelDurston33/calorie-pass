// Small helpers shared by app.js and journal.js.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const $ = (id) => document.getElementById(id);

// Calls one of the database functions in supabase/schema.sql.
export async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `Request failed (${res.status})`);
  return body;
}

// Browser-local date as YYYY-MM-DD.
export function today() {
  return new Date().toLocaleDateString("en-CA");
}

// "30 Sep", in the browser's own date style.
export function fmtDay(date, options = {}) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", ...options });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
