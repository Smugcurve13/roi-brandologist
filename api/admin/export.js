import { db, ensureSchema, isConfigured, resolveTable } from "../../lib/db.js";
import { requireAuth } from "../../lib/auth.js";
import { toCsv, csvFilename } from "../../lib/csv.js";

// GET /api/admin/export?table=roi|playbook
// Exports whichever table the admin page currently has active — the table key
// is passed through from the UI's own state.
async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!isConfigured) return res.status(503).json({ error: "database_not_configured" });

  const key = String(req.query.table || "roi");
  const spec = resolveTable(key);
  if (!spec) return res.status(400).json({ error: "unknown table" });

  try {
    await ensureSchema();
    const sql = db();
    const rows = await sql(`select * from ${spec.table} order by created_at desc`);
    const csv = toCsv(spec.columns, rows);
    const filename = csvFilename(key === "playbook" ? "playbook-leads" : "exhibition-roi-leads");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(csv);
  } catch (err) {
    console.error("admin export failed:", err);
    return res.status(500).json({ error: "export_failed" });
  }
}

export default requireAuth(handler);
