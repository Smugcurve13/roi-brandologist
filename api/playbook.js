import { db, ensureSchema, isConfigured } from "../lib/db.js";

// Playbook early-access leads — deliberately a separate table from roi_leads.
// These people may never have taken the assessment (the #playbook deep link
// drops them straight onto the form), so they have their own shape and their
// own export.

const str = (v) => (v === null || v === undefined || v === "" ? null : String(v).slice(0, 2000));

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!isConfigured) return res.status(503).json({ error: "database_not_configured" });

  try {
    await ensureSchema();
    const sql = db();
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const mode = body.contactMode === "email" ? "email" : "phone";
    const phone = mode === "phone" ? str(body.phone) : null;
    const email = mode === "email" ? str(body.email) : null;
    if (!phone && !email) return res.status(400).json({ error: "a phone number or email is required" });

    const rows = await sql`
      insert into playbook_leads (
        contact_mode, phone, email, name, company, source,
        utm_source, utm_campaign, landing_page_source
      ) values (
        ${mode}, ${phone}, ${email}, ${str(body.name)}, ${str(body.company)}, ${str(body.source)},
        ${str(body.utmSource)}, ${str(body.utmCampaign)}, ${str(body.landingPageSource)}
      )
      returning id`;
    return res.status(201).json({ id: rows[0].id });
  } catch (err) {
    console.error("playbook lead write failed:", err);
    return res.status(500).json({ error: "write_failed" });
  }
}
