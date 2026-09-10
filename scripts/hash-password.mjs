#!/usr/bin/env node
// Generate the value for the ADMIN_PASSWORD_HASH env var.
//
//   node scripts/hash-password.mjs 'the-password'
//
// Paste the output into Vercel → Settings → Environment Variables.
// The plaintext password is never stored in this repo.
import { hashPassword } from "../lib/auth.js";
import { randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("usage: node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}

const hash = await hashPassword(password);
console.log("\nADMIN_PASSWORD_HASH=" + hash);
console.log("\nIf you also need a fresh session key:");
console.log("SESSION_SECRET=" + randomBytes(32).toString("base64url") + "\n");
