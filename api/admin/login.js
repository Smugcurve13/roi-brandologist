import { ADMIN_EMAIL, authConfigured, verifyPassword, issueSession, sessionCookie } from "../../lib/auth.js";

const FAIL = "Incorrect email or password.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  if (!authConfigured) {
    return res.status(503).json({ error: "Admin auth is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD_HASH and SESSION_SECRET in Vercel." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  // Always run the hash comparison, even when the email is wrong, so response
  // time doesn't reveal whether the address exists. Same message either way.
  const stored = process.env.ADMIN_PASSWORD_HASH || "";
  const passwordOk = await verifyPassword(password, stored);

  if (email !== ADMIN_EMAIL || !passwordOk) {
    return res.status(401).json({ error: FAIL });
  }

  res.setHeader("Set-Cookie", sessionCookie(issueSession(email)));
  return res.status(200).json({ ok: true, email });
}
