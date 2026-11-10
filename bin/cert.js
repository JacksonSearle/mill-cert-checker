#!/usr/bin/env node
// cert: the bridge between whoever reads the certificates (Claude Code, via
// the read-certs skill) and the app. The reader only reports what is printed.
// Converting units, checking limits and deciding what needs review all happen
// here, in ordinary code.

import fs from "node:fs";
import path from "node:path";
import { evaluate, STATUS_LABEL } from "../app/js/rules.js";
import { INBOX, PRIVATE, RECORDS, REVIEWS, build, inboxFiles, orders, readJSON, readingPath, saveReadings, specs } from "../lib/store.js";

const HELP = `cert: mill test report checker

  cert inbox                 List the PDFs in inbox/ that have not been read yet
  cert template              Print an empty reading to fill in
  cert submit <reading.json> Save one reading (or an array of readings) and re-check everything.
                             A certificate with several heats gets one reading per heat.
  cert build                 Re-check everything and rebuild the data the page shows
  cert status                Summary of every certificate and why it was flagged
  cert show <id>             Every check for one certificate

Set CERT_HOME=<folder> to work on a separate set of certificates (its own inbox/,
readings and results) without touching the demo data.
`;

const TEMPLATE = {
  file: "EXAMPLE.pdf",
  mill: null,
  certNumber: null,
  certDate: null,
  poNumber: null,
  heatNumber: null,
  spec: null,
  grade: null,
  productForm: null,
  size: { printed: null, unit: null },
  chemistry: {
    C: { printed: null, scale: null },
    Mn: { printed: null, scale: null },
    P: { printed: null, scale: null },
    S: { printed: null, scale: null },
    Si: { printed: null, scale: null },
  },
  mechanical: {
    tensile: { printed: null, unit: null },
    yield: { printed: null, unit: null },
    elongation: { printed: null, gauge: null },
  },
  notes: [],
};

function validate(reading) {
  const errors = [];
  if (!reading.file) errors.push("file is required");
  else if (!fs.existsSync(path.join(INBOX, reading.file))) errors.push(`${reading.file} is not in inbox/`);
  for (const key of ["chemistry", "mechanical", "size"]) if (typeof reading[key] !== "object" || !reading[key]) errors.push(`${key} is missing`);
  for (const el of ["C", "Mn", "P", "S", "Si"]) {
    const p = reading.chemistry?.[el]?.printed;
    if (p != null && typeof p !== "string") errors.push(`chemistry.${el}.printed must be a string copied from the document, or null`);
  }
  for (const key of ["tensile", "yield", "elongation"]) {
    const p = reading.mechanical?.[key]?.printed;
    if (p != null && typeof p !== "string") errors.push(`mechanical.${key}.printed must be a string copied from the document, or null`);
  }
  return errors;
}

function evaluateAll(entries) {
  const reviews = readJSON(REVIEWS, {});
  return entries.map((entry) => ({ entry, ...evaluate(entry, specs(), orders(), reviews[entry.record.id]) }));
}

function printStatus(results) {
  const counts = {};
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    console.log(`${r.record.id.padEnd(14)} ${STATUS_LABEL[r.status]}`);
    for (const f of r.flags) console.log(`${" ".repeat(15)}- ${f.label}: ${f.reason}`);
  }
  console.log("\n" + Object.entries(counts).map(([s, n]) => `${n} ${STATUS_LABEL[s].toLowerCase()}`).join(", "));
}

const [command, arg] = process.argv.slice(2);

switch (command) {
  case "inbox": {
    const unread = inboxFiles().filter((f) => !fs.existsSync(readingPath(f)));
    if (!unread.length) console.log("Nothing new. Every PDF in inbox/ has been read.");
    for (const f of unread) console.log(path.join(INBOX, f));
    break;
  }
  case "template":
    console.log(JSON.stringify(TEMPLATE, null, 2));
    break;
  case "submit": {
    if (!arg) throw new Error("Usage: cert submit <reading.json>");
    const input = JSON.parse(fs.readFileSync(arg, "utf8"));
    const readings = Array.isArray(input) ? input : [input];
    const problems = readings.flatMap((r) => validate(r).map((e) => `${r.file ?? "?"}: ${e}`));
    if (problems.length) {
      console.error("Not saved:\n" + problems.map((p) => "  " + p).join("\n"));
      process.exit(1);
    }
    const byFile = Map.groupBy(readings, (r) => r.file);
    for (const [file, group] of byFile) saveReadings(file, group);
    console.log(`Saved ${readings.length} reading(s) from ${byFile.size} certificate(s)${PRIVATE ? " (private set, not shown in the app)" : ""}.\n`);
    printStatus(evaluateAll(await build()));
    break;
  }
  case "build":
    printStatus(evaluateAll(await build()));
    break;
  case "status":
    printStatus(evaluateAll(readJSON(RECORDS, { entries: [] }).entries));
    break;
  case "show": {
    const results = evaluateAll(readJSON(RECORDS, { entries: [] }).entries);
    const r = results.find((x) => x.record.id === arg);
    if (!r) throw new Error(`No certificate "${arg}". Known: ${results.map((x) => x.record.id).join(", ")}`);
    console.log(`${r.record.id}: ${STATUS_LABEL[r.status]} (checked against ${r.specKey})`);
    for (const f of r.findings) {
      const value = f.value == null ? "" : ` ${f.value}${f.unit ? " " + f.unit : ""}`;
      console.log(`  ${f.status.toUpperCase().padEnd(5)} ${f.label}${value}${f.required ? ` [required: ${f.required}]` : ""}${f.reason ? ` - ${f.reason}` : ""}`);
    }
    break;
  }
  default:
    console.log(HELP);
}
