import { currentUser, authConfigured, clearCookie } from "../../lib/auth.js";
import { isConfigured as dbConfigured, TABLES } from "../../lib/db.js";

// Lets the admin page decide what to render on load without exposing anything
// to a signed-out visitor beyond "you are signed out".
export default function handler(req, res) {
  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearCookie());
    return res.status(200).json({ ok: true });
  }
  const user = currentUser(req);
  return res.status(200).json({
    signedIn: Boolean(user),
    email: user ? user.email : null,
    authConfigured,
    dbConfigured,
    tables: Object.entries(TABLES).map(([key, t]) => ({ key, label: t.label })),
  });
}
