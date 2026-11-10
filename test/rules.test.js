import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections, check, evaluate, normalizeSpec, parseNumber, standardize, statusOf } from "../app/js/rules.js";

const specs = JSON.parse(fs.readFileSync(new URL("../app/data/specs.json", import.meta.url)));
const { orders } = JSON.parse(fs.readFileSync(new URL("../app/data/purchase_orders.json", import.meta.url)));

// A plate certificate that should pass against PO 2417-0031 line 1.
const good = () => ({
  file: "T-1.pdf", mill: "Test Mill", certNumber: "T-1", poNumber: "2417-0031", heatNumber: "H1",
  spec: "ASME SA-516", grade: "70", productForm: "Plate", size: { printed: "1.000", unit: "in" },
  chemistry: { C: { printed: ".22" }, Mn: { printed: "1.08" }, P: { printed: ".012" }, S: { printed: ".004" }, Si: { printed: ".25" } },
  mechanical: { tensile: { printed: "78.5", unit: "ksi" }, yield: { printed: "52.1", unit: "ksi" }, elongation: { printed: "24", gauge: "2 in" } },
});
const flagsFor = (reading, verification) => check(standardize(reading), specs, orders, verification).findings.filter((f) => f.status === "flag").map((f) => f.field);

test("parseNumber reads numbers as printed", () => {
  assert.equal(parseNumber(".22"), 0.22);
  assert.equal(parseNumber("540 MPa"), 540);
  assert.equal(parseNumber("1.000"), 1);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber(null), null);
});

test("normalizeSpec handles the ways mills write a specification", () => {
  assert.equal(normalizeSpec("ASME SA-516", "70"), "SA-516-70");
  assert.equal(normalizeSpec("SA-516", "Gr. 70"), "SA-516-70");
  assert.equal(normalizeSpec("ASTM A516", "Grade 70"), "SA-516-70");
  assert.equal(normalizeSpec("ASME SA-106", "B"), "SA-106-B");
  assert.equal(normalizeSpec("mystery", "70"), null);
});

test("a clean certificate passes with no flags", () => {
  assert.deepEqual(flagsFor(good()), []);
});

test("metric values are converted and the conversion is recorded", () => {
  const r = good();
  r.size = { printed: "25.4", unit: "mm" };
  r.mechanical.tensile = { printed: "540", unit: "MPa" };
  r.mechanical.yield = { printed: "355", unit: "MPa" };
  r.mechanical.elongation.gauge = "50 mm";
  const rec = standardize(r);
  assert.equal(rec.thicknessIn, 1);
  assert.equal(rec.values.tensileKsi, 78.3);
  assert.equal(rec.values.yieldKsi, 51.5);
  assert.equal(rec.gauge, "2in");
  assert.equal(rec.conversions.length, 3);
  assert.deepEqual(flagsFor(r), []);
});

test("the carbon limit depends on thickness", () => {
  const thick = good();
  thick.chemistry.C.printed = ".28";
  assert.deepEqual(flagsFor(thick), []); // 1 in plate: 0.28 max
  const thin = good();
  thin.size.printed = "0.500";
  thin.chemistry.C.printed = ".28";
  assert.deepEqual(flagsFor(thin), ["C"]); // 1/2 in plate: 0.27 max
});

test("values exactly on a limit pass", () => {
  const r = good();
  r.mechanical.tensile.printed = "70";
  r.chemistry.Mn.printed = "1.20";
  assert.deepEqual(flagsFor(r), []);
});

test("a missing heat number is flagged, never filled in", () => {
  const r = good();
  r.heatNumber = null;
  assert.equal(standardize(r).heatNumber, null);
  assert.deepEqual(flagsFor(r), ["heatNumber"]);
});

test("a missing value is flagged rather than treated as passing", () => {
  const r = good();
  r.chemistry.P.printed = null;
  assert.deepEqual(flagsFor(r), ["P"]);
});

test("an unknown unit is flagged instead of guessed", () => {
  const r = good();
  r.mechanical.tensile.unit = "kgf/mm2";
  assert.ok(flagsFor(r).includes("tensileKsi"));
});

test("the wrong grade is judged against what was ordered", () => {
  const r = good();
  r.grade = "60";
  r.mechanical.tensile.printed = "68";
  const result = check(standardize(r), specs, orders);
  assert.equal(result.specKey, "SA-516-70");
  assert.deepEqual(result.findings.filter((f) => f.status === "flag").map((f) => f.field), ["specKey", "tensileKsi"]);
});

test("an unknown purchase order and a thickness that was not ordered are flagged", () => {
  const a = good();
  a.poNumber = "9999-0001";
  assert.ok(flagsFor(a).includes("poNumber"));
  const b = good();
  b.size.printed = "0.750";
  assert.ok(flagsFor(b).includes("thicknessIn"));
});

test("a scanned document and an unverified value both need a person", () => {
  assert.deepEqual(flagsFor(good(), { hasTextLayer: false, notFound: [] }), ["document"]);
  assert.deepEqual(flagsFor(good(), { hasTextLayer: true, notFound: ["Mn"] }), ["Mn"]);
});

test("a correction is re-checked, and still needs a person to approve", () => {
  const r = good();
  r.chemistry.C.printed = ".82"; // misread of .28
  const entry = { record: standardize(r), verification: { hasTextLayer: true, notFound: [] } };
  assert.equal(evaluate(entry, specs, orders).status, "needs_review");
  const review = { decision: null, corrections: { C: 0.28 }, log: [] };
  const after = evaluate(entry, specs, orders, review);
  assert.equal(after.flags.length, 0);
  assert.equal(after.status, "needs_review");
  assert.equal(evaluate(entry, specs, orders, { ...review, decision: "approved" }).status, "approved");
  assert.equal(applyCorrections(entry.record, review.corrections).corrected.C.from, 0.82);
});

test("status reflects the reviewer's decision", () => {
  assert.equal(statusOf([], undefined), "passed");
  assert.equal(statusOf([{ status: "flag" }], undefined), "needs_review");
  assert.equal(statusOf([{ status: "flag" }], { decision: "rejected" }), "rejected");
});

// Found by testing on a real certificate.
test("chemistry printed with a column multiplier is divided by code, not by the reader", () => {
  const r = good();
  r.chemistry.C = { printed: "19", scale: "x100" };
  r.chemistry.S = { printed: "10", scale: "х1000" }; // Cyrillic х, as one real mill prints it
  const rec = standardize(r);
  assert.equal(rec.values.C, 0.19);
  assert.equal(rec.values.S, 0.01);
  r.chemistry.P = { printed: "17", scale: "per mille" };
  assert.ok(flagsFor(r).includes("P"));
});

test("a certificate that lists several specifications matches the one that was ordered", () => {
  const r = good();
  r.spec = "ASTM A53/A53M-24 / ASME SA106 /SA106M-19";
  r.grade = "L245 / Gr B / P265GH-TC1";
  r.poNumber = "2430-0007";
  r.size = { printed: "NPS 6 SCH 40", unit: null };
  const result = check(standardize(r), specs, orders);
  assert.deepEqual(standardize(r).specKeys, ["SA-53-B", "SA-106-B"]);
  assert.equal(result.specKey, "SA-106-B");
  assert.equal(result.findings.find((f) => f.field === "specKey").status, "pass");
});
