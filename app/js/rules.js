// The rules: turn what was read off a certificate into one standard record,
// then check that record against the specification and the purchase order.
//
// This file has no dependencies and no I/O. The command-line tool, the tests
// and the web page all import it, so a correction made in the browser is
// re-checked by exactly the same code that checked the original.

export const KSI_PER_MPA = 0.1450377;
export const MM_PER_IN = 25.4;

export const FIELDS = {
  C: { label: "Carbon", unit: "%", group: "chemistry", digits: 3 },
  Mn: { label: "Manganese", unit: "%", group: "chemistry", digits: 3 },
  P: { label: "Phosphorus", unit: "%", group: "chemistry", digits: 3 },
  S: { label: "Sulfur", unit: "%", group: "chemistry", digits: 3 },
  Si: { label: "Silicon", unit: "%", group: "chemistry", digits: 3 },
  tensileKsi: { label: "Tensile strength", unit: "ksi", group: "mechanical", digits: 1 },
  yieldKsi: { label: "Yield strength", unit: "ksi", group: "mechanical", digits: 1 },
  elongationPct: { label: "Elongation", unit: "%", group: "mechanical", digits: 0 },
};

const TEXT_FIELDS = { heatNumber: "Heat number", poNumber: "PO number", specKey: "Specification" };

/** First number in a printed string: ".22" -> 0.22, "540 MPa" -> 540, "" -> null. */
export function parseNumber(printed) {
  if (printed == null) return null;
  const m = String(printed).match(/-?(?:\d+\.?\d*|\.\d+)/);
  return m ? Number(m[0]) : null;
}

const clean = (s) => (s == null ? null : String(s).trim() || null);

/**
 * Every specification a certificate claims, in standard form.
 * "ASME SA-516" + "Gr. 70" -> ["SA-516-70"].
 * Real certificates are often certified to several standards or grades at once
 * ("ASTM A53 / ASME SA106", "Gr B / L245"), so this returns all of them.
 */
export function normalizeSpecs(spec, grade) {
  const numbers = [...String(spec ?? "").matchAll(/\bS?A[\s-]?(\d{2,3})(?!\d)/gi)].map((m) => m[1]);
  const grades = String(grade ?? "")
    .split(/[\/,;]/)
    .map((g) => g.replace(/gr(ade)?\.?/i, "").trim().match(/^(\d{2,3}|[A-C])$/i)?.[1].toUpperCase())
    .filter(Boolean);
  const keys = [];
  for (const n of numbers) for (const g of grades) if (!keys.includes(`SA-${n}-${g}`)) keys.push(`SA-${n}-${g}`);
  return keys;
}

/** The single specification, or null if there is none or it can't tell. */
export function normalizeSpec(spec, grade) {
  return normalizeSpecs(spec, grade)[0] ?? null;
}

/** A printed column multiplier such as "x100" or "×1000" -> 100, 1000. */
export function parseScale(scale) {
  if (scale == null || String(scale).trim() === "") return 1;
  const m = String(scale).match(/[x×х*]\s*(10{1,4})\b/i); // Latin x, multiplication sign, or Cyrillic х
  return m ? Number(m[1]) : null;
}

function normalizeUnit(unit) {
  const u = String(unit ?? "").toLowerCase().replace(/[\s.]/g, "");
  if (["ksi"].includes(u)) return "ksi";
  if (["mpa", "n/mm2", "n/mm²"].includes(u)) return "MPa";
  if (["psi"].includes(u)) return "psi";
  if (["in", "inch", "inches", '"'].includes(u)) return "in";
  if (["mm"].includes(u)) return "mm";
  return null;
}

function normalizeGauge(gauge) {
  const n = parseNumber(gauge);
  const u = normalizeUnit(String(gauge ?? "").replace(/[-\d.\s]/g, ""));
  if (n == null) return null;
  const inches = u === "mm" ? n / MM_PER_IN : n;
  if (Math.abs(inches - 2) < 0.1) return "2in";
  if (Math.abs(inches - 8) < 0.2) return "8in";
  return null;
}

/**
 * One standard record from a raw reading. The reading keeps every value
 * exactly as printed; all conversion happens here so it can be audited.
 */
export function standardize(reading) {
  const values = {};
  const printed = {};
  const conversions = [];
  const problems = []; // things that could not be standardized

  for (const el of ["C", "Mn", "P", "S", "Si"]) {
    const item = reading.chemistry?.[el] ?? {};
    const p = clean(item.printed);
    const n = parseNumber(p);
    const scale = parseScale(item.scale);
    printed[el] = p == null ? null : `${p}${item.scale ? ` (${item.scale})` : ""}`;
    if (n == null) values[el] = null;
    else if (scale === 1) values[el] = n;
    else if (scale) {
      values[el] = round(n / scale, 4);
      conversions.push({ field: el, from: `${p} ${item.scale}`, to: `${values[el]} %` });
    } else {
      values[el] = null;
      problems.push({ field: el, reason: `Multiplier "${item.scale}" not recognized, so the value was not converted` });
    }
  }

  for (const [key, field] of [["tensile", "tensileKsi"], ["yield", "yieldKsi"]]) {
    const item = reading.mechanical?.[key] ?? {};
    const p = clean(item.printed);
    const n = parseNumber(p);
    const unit = normalizeUnit(item.unit);
    printed[field] = p == null ? null : `${p}${item.unit ? " " + item.unit : ""}`;
    if (n == null) values[field] = null;
    else if (unit === "ksi") values[field] = n;
    else if (unit === "MPa") {
      values[field] = round(n * KSI_PER_MPA, 1);
      conversions.push({ field, from: `${p} MPa`, to: `${values[field]} ksi` });
    } else if (unit === "psi") {
      values[field] = round(n / 1000, 1);
      conversions.push({ field, from: `${p} psi`, to: `${values[field]} ksi` });
    } else {
      values[field] = null;
      problems.push({ field, reason: `Unit "${item.unit ?? ""}" not recognized, so the value was not converted` });
    }
  }

  const el = reading.mechanical?.elongation ?? {};
  printed.elongationPct = clean(el.printed);
  values.elongationPct = parseNumber(el.printed);
  const gauge = normalizeGauge(el.gauge);

  let thicknessIn = null;
  const size = reading.size ?? {};
  const sizePrinted = clean(size.printed);
  const sizeUnit = normalizeUnit(size.unit);
  if (sizeUnit === "in") thicknessIn = parseNumber(sizePrinted);
  else if (sizeUnit === "mm") {
    const mm = parseNumber(sizePrinted);
    if (mm != null) {
      thicknessIn = round(mm / MM_PER_IN, 3);
      conversions.push({ field: "thicknessIn", from: `${sizePrinted} mm`, to: `${thicknessIn} in` });
    }
  }

  return {
    id: reading.id ?? reading.file.replace(/\.pdf$/i, ""),
    file: reading.file,
    mill: clean(reading.mill),
    certNumber: clean(reading.certNumber),
    certDate: clean(reading.certDate),
    poNumber: clean(reading.poNumber),
    heatNumber: clean(reading.heatNumber),
    specPrinted: [clean(reading.spec), clean(reading.grade)].filter(Boolean).join(" ") || null,
    specKey: normalizeSpec(reading.spec, reading.grade),
    specKeys: normalizeSpecs(reading.spec, reading.grade),
    productForm: clean(reading.productForm)?.toLowerCase() ?? null,
    sizePrinted: sizePrinted == null ? null : `${sizePrinted}${size.unit ? " " + size.unit : ""}`,
    thicknessIn,
    gauge,
    gaugePrinted: clean(el.gauge),
    values,
    printed,
    conversions,
    problems,
    readerNotes: reading.notes ?? [],
  };
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Limit that applies to one field, as { min, max } (either may be undefined). */
export function limitFor(spec, field, record) {
  const rule = spec.chemistry?.[field] ?? spec.mechanical?.[field];
  if (!rule) return null;
  if (rule.maxByThicknessIn) {
    if (record.thicknessIn == null) return { needs: "thickness" };
    const row = rule.maxByThicknessIn.find((r) => r.upTo == null || record.thicknessIn <= r.upTo);
    return { max: row.max };
  }
  if (rule.minByGauge) {
    if (!record.gauge) return { needs: "gauge length" };
    return { min: rule.minByGauge[record.gauge] };
  }
  return { min: rule.min, max: rule.max };
}

export function describeLimit(limit) {
  if (!limit) return "not checked";
  if (limit.needs) return `depends on ${limit.needs}`;
  const { min, max } = limit;
  if (min != null && max != null) return `${min} to ${max}`;
  if (min != null) return `${min} min`;
  if (max != null) return `${max} max`;
  return "not checked";
}

/** Apply a reviewer's corrections on top of the standardized record. */
export function applyCorrections(record, corrections = {}) {
  const out = { ...record, values: { ...record.values }, corrected: {} };
  for (const [field, value] of Object.entries(corrections)) {
    if (field in FIELDS) {
      out.corrected[field] = { from: record.values[field], to: value };
      out.values[field] = value;
    } else if (field in out) {
      out.corrected[field] = { from: record[field], to: value };
      out[field] = value;
    }
  }
  return out;
}

/**
 * Check one record. Returns a list of findings, each "pass", "flag" or "info".
 * Nothing here rejects material: a flag only means a person has to look.
 *
 * `verification` comes from comparing the reading with the PDF's own text:
 *   { hasTextLayer: boolean, notFound: [field, ...] }
 */
export function check(record, specs, orders, verification = { hasTextLayer: true, notFound: [] }) {
  const findings = [];
  const add = (field, status, label, detail) => findings.push({ field, status, label, ...detail });
  const corrected = record.corrected ?? {};

  // --- The document itself ---
  if (!verification.hasTextLayer) {
    add("document", "flag", "Scanned document", {
      reason: "Scanned image with no text layer. The values could not be cross-checked against the document, so a person must confirm them by eye.",
    });
  } else {
    for (const field of verification.notFound ?? []) {
      if (field in corrected) continue;
      add(field, "flag", FIELDS[field]?.label ?? TEXT_FIELDS[field] ?? field, {
        reason: "The value that was read does not appear in the document's text. Confirm it against the original.",
      });
    }
  }
  for (const p of record.problems ?? []) {
    if (p.field in corrected) continue;
    add(p.field, "flag", FIELDS[p.field]?.label ?? p.field, { reason: p.reason });
  }

  // --- Traceability ---
  if (!record.heatNumber) {
    add("heatNumber", "flag", "Heat number", { reason: "No heat number on the certificate. The material cannot be traced without it." });
  } else {
    add("heatNumber", "pass", "Heat number", { value: record.heatNumber });
  }

  // --- Purchase order ---
  const order = orders.find((o) => o.po === record.poNumber);
  let line = null;
  if (!record.poNumber) {
    add("poNumber", "flag", "PO number", { reason: "No purchase order number on the certificate." });
  } else if (!order) {
    add("poNumber", "flag", "PO number", { value: record.poNumber, reason: `Purchase order ${record.poNumber} is not on file.` });
  } else {
    add("poNumber", "pass", "PO number", { value: record.poNumber });
    const claimed = record.specKeys ?? (record.specKey ? [record.specKey] : []);
    const sameSpec = order.lines.filter((l) => claimed.includes(l.spec));
    line =
      sameSpec.find((l) => l.thicknessIn == null || (record.thicknessIn != null && Math.abs(l.thicknessIn - record.thicknessIn) < 0.01)) ?? null;

    if (!claimed.length) {
      add("specKey", "flag", "Specification", { value: record.specPrinted, reason: "Could not tell which specification and grade the certificate is for." });
    } else if (!sameSpec.length) {
      const ordered = [...new Set(order.lines.map((l) => l.spec))].join(" or ");
      add("specKey", "flag", "Specification", {
        value: claimed.join(", "),
        required: ordered,
        reason: `Certificate is for ${claimed.join(" / ")} but the order is for ${ordered}.`,
      });
    } else if (!line) {
      add("thicknessIn", "flag", "Thickness", {
        value: record.thicknessIn,
        unit: "in",
        required: sameSpec.map((l) => l.thicknessIn).join(" or "),
        reason: "No line on the purchase order has this thickness.",
      });
    } else {
      add("specKey", "pass", "Specification", { value: claimed.join(", "), required: line.spec });
    }
  }

  // --- Values against the ordered specification ---
  // Material is judged against what was ordered. With no order on file, fall
  // back to the specification the certificate itself claims.
  const claimedAll = record.specKeys ?? [];
  const specKey = line?.spec ?? order?.lines[0]?.spec ?? claimedAll.find((k) => specs[k]) ?? record.specKey;
  const spec = specs[specKey];
  if (!spec) {
    add("spec", "flag", "Limits", { reason: `No limits on file for ${specKey ?? "this specification"}, so the values were not checked.` });
    return { findings, specKey, order, line };
  }

  for (const [field, meta] of Object.entries(FIELDS)) {
    const limit = limitFor(spec, field, record);
    const value = record.values[field];
    const detail = { value, unit: meta.unit, required: describeLimit(limit), group: meta.group };
    if (!limit) {
      add(field, "info", meta.label, { ...detail, reason: "No limit on file for this value." });
    } else if (value == null) {
      add(field, "flag", meta.label, { ...detail, reason: "Not reported, or not readable." });
    } else if (limit.needs) {
      add(field, "flag", meta.label, { ...detail, reason: `The limit depends on ${limit.needs}, which was not found.` });
    } else if (limit.max != null && value > limit.max) {
      add(field, "flag", meta.label, { ...detail, reason: `${value} is above the maximum of ${limit.max}.` });
    } else if (limit.min != null && value < limit.min) {
      add(field, "flag", meta.label, { ...detail, reason: `${value} is below the minimum of ${limit.min}.` });
    } else {
      add(field, "pass", meta.label, detail);
    }
  }

  return { findings, specKey, order, line };
}

/**
 * Where a certificate stands.
 *   passed        every check passed, nobody had to look
 *   needs_review  something was flagged (or corrected) and nobody has decided yet
 *   approved      a person accepted it
 *   rejected      a person rejected it
 */
export function statusOf(findings, review) {
  if (review?.decision === "approved") return "approved";
  if (review?.decision === "rejected") return "rejected";
  const flagged = findings.some((f) => f.status === "flag");
  const touched = review && Object.keys(review.corrections ?? {}).length > 0;
  return flagged || touched ? "needs_review" : "passed";
}

export const STATUS_LABEL = {
  passed: "Passed automatically",
  needs_review: "Needs review",
  approved: "Approved by reviewer",
  rejected: "Rejected by reviewer",
};

/** Everything the page or the CLI needs to show one certificate. */
export function evaluate(entry, specs, orders, review) {
  const record = applyCorrections(entry.record, review?.corrections);
  const result = check(record, specs, orders, entry.verification);
  return { ...result, record, status: statusOf(result.findings, review), flags: result.findings.filter((f) => f.status === "flag") };
}
