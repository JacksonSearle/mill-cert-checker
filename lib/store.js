// File locations, the PDF text cross-check, and building the data file the page reads.
//
// By default everything lives in this project and feeds the demo app. Set
// CERT_HOME to a folder with its own inbox/ to work on a separate, private set
// of certificates: readings, reviews and results then stay in that folder and
// nothing is copied into the app.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractText, getDocumentProxy } from "unpdf";
import { standardize } from "../app/js/rules.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PRIVATE = Boolean(process.env.CERT_HOME);
export const HOME = PRIVATE ? path.resolve(process.env.CERT_HOME) : ROOT;
export const INBOX = path.join(HOME, "inbox");
export const READINGS = path.join(HOME, "data/readings");
export const REVIEWS = path.join(HOME, "data/reviews.json");
export const APP_DATA = path.join(ROOT, "app/data");
export const RECORDS = PRIVATE ? path.join(HOME, "records.json") : path.join(APP_DATA, "records.json");

export const readJSON = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);
export const writeJSON = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
};

export const specs = () => readJSON(path.join(APP_DATA, "specs.json"), {});
export const orders = () => {
  const own = path.join(HOME, "purchase_orders.json");
  return readJSON(PRIVATE && fs.existsSync(own) ? own : path.join(APP_DATA, "purchase_orders.json"), { orders: [] }).orders;
};

export const inboxFiles = () =>
  fs.existsSync(INBOX) ? fs.readdirSync(INBOX).filter((f) => /\.pdf$/i.test(f)).sort() : [];

const base = (file) => file.replace(/\.pdf$/i, "");
export const readingPath = (file) => path.join(READINGS, base(file) + ".json");

/**
 * Save the readings for one PDF. A certificate that covers several heats has
 * one reading per heat, and each becomes its own record ("file-heat").
 */
export function saveReadings(file, readings) {
  const readAt = new Date().toISOString();
  const many = readings.length > 1;
  writeJSON(
    readingPath(file),
    readings.map((r, i) => ({ ...r, id: many ? `${base(file)}-${String(r.heatNumber ?? i + 1).replace(/[^\w]+/g, "")}` : base(file), readAt })),
  );
}

export const allReadings = () => inboxFiles().flatMap((f) => [readJSON(readingPath(f), [])].flat());

/** The words in the PDF's own text layer ("" for a scanned image). */
export async function pdfText(file) {
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(path.join(INBOX, file))));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/**
 * Cross-check a reading against the document. Every value was supposed to be
 * copied exactly as printed, so each one should appear in the PDF's text.
 * Numbers must match a whole token: "24" does not count as found inside "240".
 */
export async function verify(reading, text) {
  if (!text) return { hasTextLayer: false, notFound: [] };

  // Each word as printed, and again with symbols stripped from its edges, so
  // "603" is found in "№603" and "0.21" in "(0.21)". A leading decimal point stays.
  const tokens = new Set(text.split(" ").flatMap((t) => [t.replace(/[,;:]+$/, ""), t.replace(/^[^\w.]+|[^\w]+$/g, "")]));
  const found = (printed) => {
    const p = String(printed).trim();
    return p.includes(" ") ? text.includes(p) : tokens.has(p);
  };

  const claims = {
    certNumber: reading.certNumber,
    poNumber: reading.poNumber,
    heatNumber: reading.heatNumber,
    C: reading.chemistry?.C?.printed,
    Mn: reading.chemistry?.Mn?.printed,
    P: reading.chemistry?.P?.printed,
    S: reading.chemistry?.S?.printed,
    Si: reading.chemistry?.Si?.printed,
    tensileKsi: reading.mechanical?.tensile?.printed,
    yieldKsi: reading.mechanical?.yield?.printed,
    elongationPct: reading.mechanical?.elongation?.printed,
  };
  const notFound = Object.entries(claims)
    .filter(([, printed]) => printed != null && String(printed).trim() !== "" && !found(printed))
    .map(([field]) => field);
  return { hasTextLayer: true, notFound };
}

/** Re-check every saved reading and write the data file. */
export async function build() {
  const entries = [];
  const texts = new Map();
  if (!PRIVATE) fs.mkdirSync(path.join(APP_DATA, "certs"), { recursive: true });

  for (const reading of allReadings()) {
    if (!texts.has(reading.file)) texts.set(reading.file, (await pdfText(reading.file)).replace(/\s+/g, " ").trim());
    if (!PRIVATE) fs.copyFileSync(path.join(INBOX, reading.file), path.join(APP_DATA, "certs", reading.file));
    const preview = `data/pages/${base(reading.file)}.jpg`;
    entries.push({
      record: standardize(reading),
      verification: await verify(reading, texts.get(reading.file)),
      pdf: PRIVATE ? null : `data/certs/${reading.file}`,
      preview: !PRIVATE && fs.existsSync(path.join(ROOT, "app", preview)) ? preview : null,
      readBy: reading.readBy ?? null,
    });
  }
  writeJSON(RECORDS, { entries });
  return entries;
}
