// RFC 4180 CSV. Objects/arrays are JSON-encoded so jsonb columns survive the
// round trip into a spreadsheet instead of rendering as [object Object].
function cell(value) {
  if (value === null || value === undefined) return "";
  let s;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);

  // A leading =, +, - or @ makes Excel/Sheets treat the cell as a formula.
  // Prefix with a single quote so exported lead data can never execute.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;

  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const lines = [columns.map(cell).join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(","));
  // CRLF + BOM so Excel opens UTF-8 (₹, em dashes) correctly on Windows.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function csvFilename(prefix) {
  const d = new Date().toISOString().slice(0, 10);
  return `${prefix}-${d}.csv`;
}
