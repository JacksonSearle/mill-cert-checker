// Generates the sample mill test reports in inbox/ and their page previews.
// Every document is fictional and says so in its footer. Four mills, four
// layouts, plus one "scanned" copy with no text layer. Needs Chrome installed.
//
//   npm run samples

import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const INBOX = path.join(ROOT, "inbox");
const PAGES = path.join(ROOT, "app/data/pages");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const FOOTER = "SAMPLE DOCUMENT. Fictional mill and fictional data, made for a software demonstration.";

// What each sample is meant to exercise is in the `why` field (not printed).
const certs = [
  { layout: "halden", id: "HR-88213", date: "09/14/2026", po: "2417-0031", heat: "N48213", spec: "ASME SA-516", grade: "70",
    thk: "1.000", c: ".22", mn: "1.08", p: ".012", s: ".004", si: ".25", ts: "78.5", ys: "52.1", el: "24",
    why: "clean pass" },
  { layout: "halden", id: "HR-88240", date: "09/21/2026", po: "2417-0031", heat: "N48377", spec: "ASME SA-516", grade: "70",
    thk: "0.500", c: ".29", mn: "1.02", p: ".010", s: ".006", si: ".22", ts: "81.2", ys: "55.4", el: "22",
    why: "carbon over the limit for this thickness" },
  { layout: "kessler", id: "KPW 5-10422", date: "2026-10-02", po: "2422-0012", heat: "K7731A", spec: "SA-516", grade: "Gr. 70",
    thk: "1.500", c: "0.24", mn: "1.12", p: "0.009", s: "0.003", si: "0.31", ts: "76.9", ys: "48.3", el: "25",
    why: "clean pass, different layout and labels" },
  { layout: "kessler", id: "KPW 5-10431", date: "2026-10-05", po: "2422-0012", heat: "", spec: "SA-516", grade: "Gr. 70",
    thk: "1.500", c: "0.23", mn: "1.10", p: "0.011", s: "0.004", si: "0.28", ts: "77.4", ys: "49.0", el: "24",
    why: "heat number left blank" },
  { layout: "seorim", id: "SR2611-0457", date: "2026.09.29", po: "2417-0031", heat: "H61190", spec: "ASME SA-516", grade: "70",
    thk: "25.4", c: "0.21", mn: "1.15", p: "0.013", s: "0.002", si: "0.33", ts: "540", ys: "355", el: "23",
    why: "metric units, passes after conversion" },
  { layout: "seorim", id: "SR2611-0502", date: "2026.10.08", po: "2422-0012", heat: "H61342", spec: "ASME SA-516", grade: "60",
    thk: "38.1", c: "0.19", mn: "1.05", p: "0.012", s: "0.003", si: "0.27", ts: "470", ys: "305", el: "27",
    why: "wrong grade for the order, and tensile below the ordered grade" },
  { layout: "tririver", id: "TRT-23-9917", date: "Oct 12, 2026", po: "2430-0007", heat: "T90455", spec: "ASME SA-106", grade: "B",
    size: "NPS 6 SCH 40", c: "0.21", mn: "0.88", p: "0.011", s: "0.008", si: "0.22", ts: "71.2", ys: "46.8", el: "33",
    why: "clean pass, pipe" },
  { layout: "tririver", id: "TRT-23-9951", date: "Oct 19, 2026", po: "2430-0007", heat: "T90518", spec: "ASME SA-106", grade: "B",
    size: "NPS 6 SCH 40", c: "0.18", mn: "0.74", p: "0.014", s: "0.010", si: "0.19", ts: "58.4", ys: "38.2", el: "36",
    why: "tensile strength below the minimum" },
  { layout: "halden", scanned: true, id: "HR-88302", date: "10/06/2026", po: "2417-0031", heat: "N48590", spec: "ASME SA-516", grade: "70",
    thk: "1.000", c: ".23", mn: "1.06", p: ".011", s: ".005", si: ".24", ts: "79.8", ys: "53.0", el: "23",
    why: "scanned image with no text layer, so nothing can be cross-checked automatically" },
];

const base = (body, css) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { width: 816px; height: 1056px; padding: 56px 60px; position: relative; color: #111; }
  table { border-collapse: collapse; width: 100%; }
  .sample { position: absolute; left: 60px; right: 60px; bottom: 34px; font: 10px Arial, sans-serif; color: #666; text-align: center; border-top: 1px solid #bbb; padding-top: 6px; }
  ${css}
</style></head><body>${body}<div class="sample">${FOOTER}</div></body></html>`;

const layouts = {
  // Classic boxed mill certificate, US units.
  halden: (c) => base(`
    <div class="head"><div><div class="name">HALDEN RIDGE STEEL</div><div class="sub">Plate Division &middot; 4100 Furnace Road</div></div>
      <div class="title">MILL TEST REPORT<br><span>EN 10204 Type 3.1</span></div></div>
    <table class="info">
      <tr><td><b>CERTIFICATE NO.</b><br>${c.id}</td><td><b>DATE</b><br>${c.date}</td><td><b>CUSTOMER P.O.</b><br>${c.po}</td></tr>
      <tr><td><b>SPECIFICATION</b><br>${c.spec} GR ${c.grade}</td><td><b>PRODUCT</b><br>PLATE, NORMALIZED</td><td><b>HEAT NO.</b><br>${c.heat}</td></tr>
      <tr><td><b>THICKNESS (IN)</b><br>${c.thk}</td><td><b>WIDTH x LENGTH (IN)</b><br>96 x 240</td><td><b>PIECES</b><br>2</td></tr>
    </table>
    <h3>CHEMICAL ANALYSIS (HEAT) &ndash; WEIGHT %</h3>
    <table class="grid"><tr><th>C</th><th>MN</th><th>P</th><th>S</th><th>SI</th><th>CU</th><th>NI</th><th>CR</th></tr>
      <tr><td>${c.c}</td><td>${c.mn}</td><td>${c.p}</td><td>${c.s}</td><td>${c.si}</td><td>.03</td><td>.02</td><td>.04</td></tr></table>
    <h3>TENSILE TEST</h3>
    <table class="grid"><tr><th>YIELD (KSI)</th><th>TENSILE (KSI)</th><th>ELONG % IN 2 IN</th><th>DIRECTION</th></tr>
      <tr><td>${c.ys}</td><td>${c.ts}</td><td>${c.el}</td><td>TRANSVERSE</td></tr></table>
    <p class="cert">We hereby certify that the material described above has been manufactured and tested in accordance with the
      specification shown and that the results meet its requirements.</p>
    <div class="sig">Quality Assurance Manager</div>`,
    `body { font: 12px "Courier New", monospace; }
     .head { display: flex; justify-content: space-between; border-bottom: 3px double #111; padding-bottom: 12px; }
     .name { font: bold 24px Arial, sans-serif; letter-spacing: 1px; } .sub { font-size: 11px; }
     .title { font: bold 16px Arial, sans-serif; text-align: right; } .title span { font-weight: normal; font-size: 11px; }
     .info { margin-top: 18px; } .info td { border: 1px solid #111; padding: 7px 9px; width: 33%; vertical-align: top; font-size: 13px; }
     .info b { font: bold 9px Arial, sans-serif; }
     h3 { font: bold 11px Arial, sans-serif; margin: 26px 0 6px; }
     .grid th, .grid td { border: 1px solid #111; padding: 7px; text-align: center; } .grid th { background: #e9e9e9; font: bold 10px Arial, sans-serif; }
     .cert { margin-top: 40px; font-size: 11px; line-height: 1.5; } .sig { margin-top: 56px; border-top: 1px solid #111; width: 240px; padding-top: 4px; font-size: 10px; }`),

  // Label/value list, long element names, different words for the same things.
  kessler: (c) => base(`
    <div class="band"><span>Kessler Plate Works</span><em>Certified Material Test Report</em></div>
    <div class="cols">
      <dl><dt>Report number</dt><dd>${c.id}</dd><dt>Issued</dt><dd>${c.date}</dd><dt>Purchase order</dt><dd>${c.po}</dd><dt>Melt / heat</dt><dd>${c.heat || "&nbsp;"}</dd></dl>
      <dl><dt>Material</dt><dd>${c.spec} ${c.grade}</dd><dt>Form</dt><dd>Plate</dd><dt>Gauge</dt><dd>${c.thk} in</dd><dt>Condition</dt><dd>Normalized</dd></dl>
    </div>
    <h2>Ladle analysis, percent by weight</h2>
    <table class="rows">
      <tr><td>Carbon</td><td>${c.c}</td><td>Manganese</td><td>${c.mn}</td></tr>
      <tr><td>Phosphorus</td><td>${c.p}</td><td>Sulfur</td><td>${c.s}</td></tr>
      <tr><td>Silicon</td><td>${c.si}</td><td>Aluminum</td><td>0.032</td></tr>
    </table>
    <h2>Mechanical properties</h2>
    <table class="rows">
      <tr><td>Ultimate tensile strength (UTS)</td><td>${c.ts} ksi</td></tr>
      <tr><td>Yield strength (YS, 0.2% offset)</td><td>${c.ys} ksi</td></tr>
      <tr><td>Elongation, 2 in gauge length</td><td>${c.el} %</td></tr>
    </table>
    <p class="note">The above figures are certified to be true and correct as contained in the records of the company.</p>`,
    `body { font: 13px Georgia, serif; }
     .band { background: #1d3557; color: #fff; padding: 16px 20px; display: flex; justify-content: space-between; align-items: baseline; }
     .band span { font: bold 22px Georgia, serif; } .band em { font-size: 13px; }
     .cols { display: flex; gap: 40px; margin-top: 24px; } dl { flex: 1; margin: 0; display: grid; grid-template-columns: 130px 1fr; row-gap: 8px; }
     dt { color: #555; font-size: 12px; } dd { margin: 0; font-weight: bold; border-bottom: 1px dotted #999; min-height: 18px; }
     h2 { font: bold 14px Georgia, serif; color: #1d3557; border-bottom: 2px solid #1d3557; padding-bottom: 4px; margin: 34px 0 10px; }
     .rows td { padding: 8px 10px; border-bottom: 1px solid #ccc; } .rows td:nth-child(even) { font-weight: bold; text-align: right; width: 110px; }
     .note { margin-top: 44px; font-style: italic; font-size: 12px; }`),

  // Metric inspection certificate: mm and MPa, numbered rows.
  seorim: (c) => base(`
    <table class="top"><tr><td class="logo">SEORIM STEEL CO., LTD.</td><td class="doc">INSPECTION CERTIFICATE<br><small>Type 3.1 / EN 10204</small></td></tr></table>
    <table class="meta">
      <tr><th>Certificate No.</th><td>${c.id}</td><th>Date of issue</th><td>${c.date}</td></tr>
      <tr><th>Order No.</th><td>${c.po}</td><th>Commodity</th><td>Hot rolled steel plate</td></tr>
      <tr><th>Specification</th><td>${c.spec} Grade ${c.grade}</td><th>Heat treatment</th><td>N</td></tr>
    </table>
    <table class="data">
      <tr><th rowspan="2">Heat No.</th><th rowspan="2">Thickness<br>(mm)</th><th colspan="5">Chemical composition (%)</th><th colspan="3">Tensile test</th></tr>
      <tr><th>C</th><th>Si</th><th>Mn</th><th>P</th><th>S</th><th>YS<br>(MPa)</th><th>TS<br>(MPa)</th><th>EL (%)<br>GL 50 mm</th></tr>
      <tr><td>${c.heat}</td><td>${c.thk}</td><td>${c.c}</td><td>${c.si}</td><td>${c.mn}</td><td>${c.p}</td><td>${c.s}</td><td>${c.ys}</td><td>${c.ts}</td><td>${c.el}</td></tr>
    </table>
    <p class="small">YS: yield strength. TS: tensile strength. EL: elongation. GL: gauge length. N: normalized.</p>
    <p class="small">We hereby certify that the material herein has been made and tested in accordance with the above specification.</p>
    <div class="stamp">Q.A. DEPT<br>INSPECTED</div>`,
    `body { font: 11px Arial, Helvetica, sans-serif; }
     .top td { padding: 0 0 14px; } .logo { font: bold 20px Arial, sans-serif; color: #0b5d3b; } .doc { text-align: right; font: bold 15px Arial, sans-serif; } .doc small { font-weight: normal; }
     .meta th, .meta td { border: 1px solid #444; padding: 6px 8px; text-align: left; } .meta th { background: #eef4f0; width: 17%; font-size: 10px; }
     .data { margin-top: 26px; } .data th, .data td { border: 1px solid #444; padding: 7px 4px; text-align: center; } .data th { background: #eef4f0; font-size: 10px; }
     .small { margin-top: 18px; color: #333; }
     .stamp { position: absolute; right: 90px; bottom: 150px; border: 2px solid #b22; color: #b22; border-radius: 50%; width: 96px; height: 96px; display: flex; align-items: center; justify-content: center; text-align: center; font-weight: bold; transform: rotate(-12deg); }`),

  // Pipe mill: results listed against the requirement, mixed-case labels.
  tririver: (c) => base(`
    <div class="hd"><div class="co">TRI-RIVER TUBE</div><div>Seamless Pipe Mill<br>Material Test Certificate</div></div>
    <div class="line"><b>Cert #:</b> ${c.id} &nbsp;&nbsp; <b>Issued:</b> ${c.date} &nbsp;&nbsp; <b>Cust. PO:</b> ${c.po}</div>
    <div class="line"><b>Product:</b> Seamless carbon steel pipe, ${c.spec} Grade ${c.grade} &nbsp;&nbsp; <b>Size:</b> ${c.size}</div>
    <div class="line"><b>Heat:</b> ${c.heat} &nbsp;&nbsp; <b>Lot:</b> 14 &nbsp;&nbsp; <b>Lengths:</b> 38 &nbsp;&nbsp; <b>Hydro:</b> 2500 psi, OK</div>
    <table class="t"><tr><th>Element</th><th>Result, wt %</th><th>Element</th><th>Result, wt %</th></tr>
      <tr><td>C</td><td>${c.c}</td><td>Mn</td><td>${c.mn}</td></tr>
      <tr><td>P</td><td>${c.p}</td><td>S</td><td>${c.s}</td></tr>
      <tr><td>Si</td><td>${c.si}</td><td>Cu</td><td>0.05</td></tr></table>
    <table class="t"><tr><th>Test</th><th>Result</th><th>Units</th></tr>
      <tr><td>Tensile strength</td><td>${c.ts}</td><td>ksi</td></tr>
      <tr><td>Yield strength</td><td>${c.ys}</td><td>ksi</td></tr>
      <tr><td>Elongation in 2 in</td><td>${c.el}</td><td>%</td></tr>
      <tr><td>Flattening</td><td>Acceptable</td><td></td></tr></table>
    <p>This is to certify that the product described was manufactured, sampled, tested and inspected in accordance with the specification.</p>`,
    `body { font: 12px Verdana, Geneva, sans-serif; }
     .hd { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 4px solid #a33; padding-bottom: 10px; margin-bottom: 18px; text-align: right; }
     .co { font: 900 28px "Arial Black", Arial, sans-serif; color: #a33; letter-spacing: -1px; }
     .line { margin: 8px 0; } .t { margin-top: 26px; } .t th { background: #a33; color: #fff; padding: 7px; text-align: left; font-size: 11px; }
     .t td { padding: 7px; border-bottom: 1px solid #bbb; } p { margin-top: 36px; font-size: 11px; }`),
};

const fileName = (c) => c.id.replace(/[^A-Za-z0-9]+/g, "-") + ".pdf";

fs.mkdirSync(INBOX, { recursive: true });
fs.mkdirSync(PAGES, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 });

for (const c of certs) {
  const html = layouts[c.layout](c);
  const pdf = path.join(INBOX, fileName(c));
  const png = path.join(PAGES, fileName(c).replace(/\.pdf$/, ".jpg"));
  await page.setContent(html, { waitUntil: "load" });

  if (!c.scanned) {
    await page.pdf({ path: pdf, format: "Letter", printBackground: true });
    await page.screenshot({ path: png, type: "jpeg", quality: 82 });
  } else {
    // Make it look like a photocopy that was scanned slightly crooked, then
    // build a PDF that contains only that picture (so it has no text layer).
    await page.addStyleTag({
      content: `html { background: #d9d6cf; } body { background: #f3f1ea; filter: grayscale(1) contrast(1.25) blur(0.45px); transform: rotate(-0.9deg) scale(0.985); }`,
    });
    const shot = await page.screenshot({ type: "jpeg", quality: 55 });
    fs.writeFileSync(png, shot);
    await page.setContent(
      `<style>@page{size:Letter;margin:0}html,body{margin:0}img{width:816px;height:1056px;display:block}</style><img src="data:image/jpeg;base64,${Buffer.from(shot).toString("base64")}">`,
      { waitUntil: "load" },
    );
    await page.pdf({ path: pdf, format: "Letter", printBackground: true });
  }
  console.log(`${fileName(c).padEnd(22)} ${c.why}`);
}

await browser.close();
