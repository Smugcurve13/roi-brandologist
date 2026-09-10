import { db, ensureSchema, isConfigured } from "../lib/db.js";

// Exhibition ROI assessment leads.
//   POST  -> insert one row, returns { id }
//   PATCH -> update that same row as the visitor completes later steps
//
// The old Apps Script sheet appended a *new* row for the assessment, the
// qualification step and the review request, so one person produced three
// rows that had to be reconciled by phone number. Here it stays one row.

const str = (v) => (v === null || v === undefined || v === "" ? null : String(v).slice(0, 2000));
const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export default async function handler(req, res) {
  if (!isConfigured) {
    // Tell the client plainly so it can fall back rather than silently losing a lead.
    return res.status(503).json({ error: "database_not_configured" });
  }

  try {
    await ensureSchema();
    const sql = db();
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    if (req.method === "POST") {
      const rows = await sql`
        insert into roi_leads (
          name, company, whatsapp, answers, investment, confirmed_business,
          total_score, max_score, result_category, assessment_status,
          last_question_completed, utm_source, utm_campaign, landing_page_source
        ) values (
          ${str(body.name)}, ${str(body.company)}, ${str(body.whatsapp)},
          ${body.answers ? JSON.stringify(body.answers) : null},
          ${num(body.investment)}, ${num(body.confirmedBusiness)},
          ${num(body.totalScore)}, ${num(body.maxScore)},
          ${str(body.resultCategory)}, ${str(body.assessmentStatus)},
          ${num(body.lastQuestionCompleted)},
          ${str(body.utmSource)}, ${str(body.utmCampaign)}, ${str(body.landingPageSource)}
        )
        returning id`;
      return res.status(201).json({ id: rows[0].id });
    }

    if (req.method === "PATCH") {
      const id = num(body.id);
      if (!id) return res.status(400).json({ error: "id is required" });
      // coalesce: only overwrite a column when this call actually carries a value
      const rows = await sql`
        update roi_leads set
          qualification        = coalesce(${body.qualification ? JSON.stringify(body.qualification) : null}::jsonb, qualification),
          help_required        = coalesce(${str(body.helpRequired)}, help_required),
          roi_review_requested = roi_review_requested or ${Boolean(body.roiReviewRequested)},
          updated_at           = now()
        where id = ${id}
        returning id`;
      if (!rows.length) return res.status(404).json({ error: "lead not found" });
      return res.status(200).json({ id: rows[0].id });
    }

    res.setHeader("Allow", "POST, PATCH");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    console.error("roi lead write failed:", err);
    return res.status(500).json({ error: "write_failed" });
  }
}
