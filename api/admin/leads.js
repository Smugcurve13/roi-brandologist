import { db, ensureSchema, isConfigured, resolveTable } from "../../lib/db.js";
import { requireAuth } from "../../lib/auth.js";

// GET /api/admin/leads?table=roi|playbook&limit=&offset=
async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!isConfigured) return res.status(503).json({ error: "database_not_configured" });

  const spec = resolveTable(String(req.query.table || "roi"));
  if (!spec) return res.status(400).json({ error: "unknown table" });

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  try {
    await ensureSchema();
    const sql = db();
    // Table name comes from the allow-list above, never from the query string.
    const rows = await sql(
      `select * from ${spec.table} order by created_at desc limit $1 offset $2`,
      [limit, offset]
    );
    const [{ count }] = await sql(`select count(*)::int as count from ${spec.table}`);
    return res.status(200).json({
      table: req.query.table || "roi",
      label: spec.label,
      columns: spec.columns,
      total: count,
      limit,
      offset,
      rows,
    });
  } catch (err) {
    console.error("admin leads read failed:", err);
    return res.status(500).json({ error: "read_failed" });
  }
}

export default requireAuth(handler);
