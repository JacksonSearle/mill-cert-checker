// The page: dashboard, review screen and inspection report.
// All checking is done by rules.js, the same module the command-line tool uses.

import { evaluate, FIELDS, STATUS_LABEL } from "./rules.js";

const view = document.getElementById("view");
const state = { entries: [], specs: {}, orders: [], reviews: {}, server: false, filter: "all" };

// ---------- data ----------

const getJSON = async (url) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};

const LOCAL_KEY = "mill-cert-checker:reviews";

async function load() {
  const [records, specs, po] = await Promise.all([
    getJSON("data/records.json"),
    getJSON("data/specs.json"),
    getJSON("data/purchase_orders.json"),
  ]);
  state.entries = records.entries;
  state.specs = specs;
  state.orders = po.orders;
  try {
    state.reviews = await getJSON("api/reviews");
    state.server = true;
  } catch {
    // No server (static demo): keep reviews in this browser.
    try {
      state.reviews = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}");
    } catch {
      state.reviews = {};
    }
  }
}

async function saveReview(id, review) {
  state.reviews[id] = review;
  if (state.server) {
    await fetch(`api/reviews/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(review) });
  } else {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state.reviews));
    } catch {
      /* private window: the decision still shows until the page is closed */
    }
  }
}

const results = () =>
  state.entries.map((entry) => ({ entry, review: state.reviews[entry.record.id], ...evaluate(entry, state.specs, state.orders, state.reviews[entry.record.id]) }));

// ---------- helpers ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (field, value) => (value == null ? "–" : field in FIELDS ? Number(value).toFixed(FIELDS[field].digits) : String(value));
const badge = (status) => `<span class="badge badge--${status}">${STATUS_LABEL[status]}</span>`;
const asPrinted = (rec, field) =>
  field === "specKey" ? rec.specPrinted ?? "–" : field === "thicknessIn" ? rec.sizePrinted ?? "–" : field in rec.printed ? rec.printed[field] ?? "–" : rec[field] ?? "–";
const jobOf = (r) => (r.order ? `${r.order.job} · ${r.order.jobName}` : "No matching order");
const reviewerName = () => {
  try {
    return localStorage.getItem("mill-cert-checker:name") ?? "";
  } catch {
    return "";
  }
};

// ---------- dashboard ----------

function dashboard() {
  const all = results();
  const count = (s) => all.filter((r) => r.status === s).length;
  const tiles = [
    ["Certificates read", all.length, ""],
    ["Passed automatically", count("passed"), "passed"],
    ["Waiting on a person", count("needs_review"), "needs_review"],
    ["Approved by reviewer", count("approved"), "approved"],
    ["Rejected by reviewer", count("rejected"), "rejected"],
  ];

  const reasons = new Map();
  for (const r of all.filter((x) => x.status === "needs_review")) for (const f of r.flags) reasons.set(f.label, (reasons.get(f.label) ?? 0) + 1);

  const jobs = new Map();
  for (const r of all) {
    const key = jobOf(r);
    const j = jobs.get(key) ?? { total: 0, passed: 0, needs_review: 0, approved: 0, rejected: 0 };
    j.total++;
    j[r.status]++;
    jobs.set(key, j);
  }

  const shown = all.filter((r) => state.filter === "all" || r.status === state.filter);
  const filters = [["all", "All"], ["needs_review", "Needs review"], ["passed", "Passed"], ["approved", "Approved"], ["rejected", "Rejected"]];

  view.innerHTML = `
    <section class="tiles">${tiles.map(([label, n, cls]) => `<div class="tile ${cls ? "tile--" + cls : ""}"><b>${n}</b><span>${label}</span></div>`).join("")}</section>

    <div class="two">
      <section class="card">
        <h2>Why certificates are waiting</h2>
        ${reasons.size ? `<ul class="reasons">${[...reasons].sort((a, b) => b[1] - a[1]).map(([label, n]) => `<li><b>${n}</b> ${esc(label)}</li>`).join("")}</ul>` : `<p class="muted">Nothing is waiting on review.</p>`}
      </section>
      <section class="card">
        <h2>By job</h2>
        <div class="scroll"><table>
          <tr><th>Job</th><th class="n">Certs</th><th class="n">Passed</th><th class="n">Waiting</th><th class="n">Approved</th><th class="n">Rejected</th></tr>
          ${[...jobs].map(([name, j]) => `<tr><td>${esc(name)}</td><td class="n">${j.total}</td><td class="n">${j.passed}</td><td class="n ${j.needs_review ? "warn" : ""}">${j.needs_review}</td><td class="n">${j.approved}</td><td class="n">${j.rejected}</td></tr>`).join("")}
        </table></div>
      </section>
    </div>

    <section class="card">
      <div class="card__head"><h2>Certificates</h2>
        <div class="filters">${filters.map(([key, label]) => `<button data-filter="${key}" class="${state.filter === key ? "on" : ""}">${label}</button>`).join("")}</div>
      </div>
      <div class="scroll"><table class="certs">
        <tr><th>Certificate</th><th>Mill</th><th>Job</th><th>Heat</th><th>Checked against</th><th>Status</th><th>Why</th></tr>
        ${shown.map((r) => `<tr data-go="#/cert/${esc(r.record.id)}">
            <td><a href="#/cert/${esc(r.record.id)}">${esc(r.record.certNumber ?? r.record.id)}</a></td>
            <td>${esc(r.record.mill)}</td><td>${esc(jobOf(r))}</td><td>${esc(r.record.heatNumber ?? "–")}</td><td>${esc(r.specKey ?? "–")}</td>
            <td>${badge(r.status)}</td>
            <td class="why">${r.flags.length ? esc(r.flags.map((f) => f.label).join(", ")) : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">None.</td></tr>`}
      </table></div>
    </section>`;

  view.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { state.filter = b.dataset.filter; dashboard(); }));
  view.querySelectorAll("tr[data-go]").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = tr.dataset.go; }));
}

// ---------- review screen ----------

function reviewScreen(id) {
  const r = results().find((x) => x.record.id === id);
  if (!r) return (view.innerHTML = `<p class="muted">No certificate "${esc(id)}". <a href="#/">Back</a></p>`);
  const { record, entry } = r;
  const review = r.review ?? { decision: null, corrections: {}, log: [] };
  const decided = r.status === "approved" || r.status === "rejected";

  const row = (f) => {
    const canCorrect = !decided && (f.field in FIELDS || f.field === "heatNumber");
    const was = record.corrected?.[f.field];
    return `<tr class="is-${f.status}">
      <td>${esc(f.label)}</td>
      <td class="mono">${esc(asPrinted(entry.record, f.field))}</td>
      <td class="mono">${f.value == null ? "–" : esc(fmt(f.field, f.value))}${f.unit && f.value != null ? " " + f.unit : ""}${was ? ` <span class="chip">corrected from ${esc(fmt(f.field, was.from))}</span>` : ""}</td>
      <td class="mono">${esc(f.required ?? "")}</td>
      <td><span class="res res--${f.status}">${f.status === "pass" ? "Pass" : f.status === "flag" ? "Flag" : "Not checked"}</span>
        ${canCorrect ? `<button class="link" data-correct="${f.field}">Correct</button>` : ""}</td>
    </tr>${f.reason ? `<tr class="is-${f.status} reason"><td colspan="5">${esc(f.reason)}</td></tr>` : ""}`;
  };

  view.innerHTML = `
    <p class="crumbs"><a href="#/">&larr; All certificates</a></p>
    <div class="review">
      <section class="doc card">
        <div class="card__head"><h2>Original document</h2><a href="${esc(entry.pdf)}" target="_blank" rel="noopener">Open PDF</a></div>
        ${entry.preview ? `<img src="${esc(entry.preview)}" alt="First page of certificate ${esc(record.certNumber)}">` : `<object data="${esc(entry.pdf)}" type="application/pdf"><p><a href="${esc(entry.pdf)}">Open the PDF</a></p></object>`}
      </section>

      <div class="side">
        <section class="card">
          <div class="card__head"><h2>${esc(record.certNumber ?? record.id)}</h2>${badge(r.status)}</div>
          <dl class="facts">
            <dt>Mill</dt><dd>${esc(record.mill)}</dd>
            <dt>Job</dt><dd>${esc(jobOf(r))}</dd>
            <dt>Purchase order</dt><dd>${esc(record.poNumber ?? "–")}${r.line ? `, line ${r.line.line}: ${esc(r.line.description)}` : ""}</dd>
            <dt>On the certificate</dt><dd>${esc(record.specPrinted ?? "–")}, ${esc(record.sizePrinted ?? "–")}</dd>
            <dt>Checked against</dt><dd>${esc(r.specKey ?? "–")}</dd>
          </dl>
          ${r.flags.length ? `<div class="flags"><h3>${r.flags.length === 1 ? "1 thing needs" : r.flags.length + " things need"} a person</h3><ul>${r.flags.map((f) => `<li><b>${esc(f.label)}.</b> ${esc(f.reason)}</li>`).join("")}</ul></div>` : `<p class="ok">Every check passed.</p>`}
          ${record.conversions.length ? `<p class="muted small">Converted: ${record.conversions.map((c) => `${esc(c.from)} &rarr; ${esc(c.to)}`).join("; ")}.</p>` : ""}
          ${record.readerNotes.length ? `<p class="muted small">Reader's notes: ${record.readerNotes.map(esc).join(" ")}</p>` : ""}
        </section>

        <section class="card">
          <h2>Checks</h2>
          <div class="scroll"><table class="checks">
            <tr><th>Item</th><th>As printed</th><th>Standard value</th><th>Required</th><th>Result</th></tr>
            ${r.findings.filter((f) => f.field !== "document").map(row).join("")}
          </table></div>
        </section>

        <section class="card">
          <h2>Review</h2>
          ${decided
            ? `<p>${badge(r.status)}</p><button class="btn btn--ghost" data-act="reopen">Reopen</button>`
            : r.status === "passed"
              ? `<p class="muted">Nothing to review. This certificate passed every check.</p>`
              : `<label>Your name<input id="who" value="${esc(reviewerName())}" autocomplete="name"></label>
                 <label>Note (required)<textarea id="note" rows="3" placeholder="What you checked and why you decided this"></textarea></label>
                 <p id="err" class="err" hidden></p>
                 <div class="actions"><button class="btn" data-act="approved">Approve</button><button class="btn btn--danger" data-act="rejected">Reject</button></div>`}
          <p><a href="#/form/${esc(id)}">Receiving inspection report &rarr;</a></p>
          ${review.log.length ? `<h3>History</h3><ol class="log">${review.log.map((l) => `<li><time>${esc(new Date(l.at).toLocaleString())}</time> <b>${esc(l.by)}</b> ${esc(l.action)}${l.note ? `: ${esc(l.note)}` : ""}</li>`).join("")}</ol>` : ""}
        </section>
      </div>
    </div>`;

  const who = () => view.querySelector("#who")?.value.trim() ?? reviewerName();
  const fail = (msg) => { const e = view.querySelector("#err"); if (e) { e.textContent = msg; e.hidden = false; } };
  const log = (action, note) => review.log.push({ at: new Date().toISOString(), by: who() || "Reviewer", action, note });
  const remember = () => { try { localStorage.setItem("mill-cert-checker:name", who()); } catch { /* fine */ } };

  view.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
    const act = b.dataset.act;
    if (act === "reopen") {
      review.decision = null;
      log("reopened the review");
    } else {
      const note = view.querySelector("#note").value.trim();
      if (!who()) return fail("Enter your name.");
      if (!note) return fail("Add a note saying what you checked.");
      remember();
      review.decision = act;
      log(act === "approved" ? "approved" : "rejected", note);
    }
    await saveReview(id, review);
    reviewScreen(id);
  }));

  // "Correct" swaps the button for a small inline editor.
  view.querySelectorAll("[data-correct]").forEach((b) => b.addEventListener("click", () => {
    const field = b.dataset.correct;
    const label = FIELDS[field]?.label ?? "Heat number";
    const current = record.values?.[field] ?? record[field] ?? "";
    const box = document.createElement("span");
    box.className = "edit";
    box.innerHTML = `<input aria-label="Corrected ${esc(label)}" value="${esc(current)}"><button class="btn btn--ghost">Save</button>`;
    b.replaceWith(box);
    const input = box.querySelector("input");
    input.focus();
    const save = async () => {
      const raw = input.value.trim();
      if (!raw) return;
      const value = field in FIELDS ? Number(raw) : raw;
      if (field in FIELDS && !Number.isFinite(value)) return input.classList.add("bad");
      const before = field in FIELDS ? entry.record.values[field] : entry.record[field];
      review.corrections = { ...review.corrections, [field]: value };
      review.log.push({ at: new Date().toISOString(), by: who() || "Reviewer", action: `corrected ${label} from ${before ?? "blank"} to ${value}` });
      await saveReview(id, review);
      reviewScreen(id);
    };
    box.querySelector("button").addEventListener("click", save);
    input.addEventListener("keydown", (e) => e.key === "Enter" && save());
  }));
}

// ---------- inspection report ----------

function formScreen(id) {
  const r = results().find((x) => x.record.id === id);
  if (!r) return (view.innerHTML = `<p class="muted">No certificate "${esc(id)}". <a href="#/">Back</a></p>`);
  const { record } = r;
  const last = [...(r.review?.log ?? [])].reverse().find((l) => l.action === "approved" || l.action === "rejected");
  const disposition = { passed: "ACCEPTED", approved: "ACCEPTED AFTER REVIEW", rejected: "REJECTED", needs_review: "ON HOLD: WAITING FOR REVIEW" }[r.status];
  const box = (label, value) => `<div><span>${label}</span><b>${esc(value ?? "–")}</b></div>`;

  view.innerHTML = `
    <p class="crumbs noprint"><a href="#/cert/${esc(id)}">&larr; Back to review</a> <button class="btn btn--ghost" onclick="print()">Print</button></p>
    <article class="form">
      <header><h1>Receiving Inspection Report</h1><p>Material test report review &middot; sample format</p></header>
      <div class="grid">
        ${box("Job", r.order ? `${r.order.job} ${r.order.jobName}` : null)}${box("Purchase order", record.poNumber)}${box("PO line", r.line ? `${r.line.line}: ${r.line.description}` : null)}
        ${box("Supplier / mill", record.mill)}${box("Certificate no.", record.certNumber)}${box("Certificate date", record.certDate)}
        ${box("Heat no.", record.heatNumber)}${box("Specification ordered", r.specKey)}${box("Specification on certificate", record.specKey ?? record.specPrinted)}
      </div>
      <table>
        <tr><th>Item</th><th>Required</th><th>Reported</th><th>Result</th></tr>
        ${r.findings.filter((f) => f.field in FIELDS).map((f) => `<tr><td>${esc(f.label)}${f.unit ? `, ${f.unit}` : ""}</td><td>${esc(f.required)}</td><td>${esc(fmt(f.field, f.value))}${record.corrected?.[f.field] ? " *" : ""}</td><td>${f.status === "pass" ? "OK" : f.status === "flag" ? "EXCEPTION" : "N/A"}</td></tr>`).join("")}
      </table>
      ${Object.keys(record.corrected ?? {}).length ? `<p class="small">* Corrected by the reviewer against the original document.</p>` : ""}
      ${r.flags.length ? `<div class="exceptions"><b>Exceptions</b><ul>${r.flags.map((f) => `<li>${esc(f.label)}: ${esc(f.reason)}</li>`).join("")}</ul></div>` : ""}
      <div class="disp disp--${r.status}"><span>Disposition</span><b>${disposition}</b></div>
      <div class="grid">
        ${box("Reviewed by", r.status === "passed" ? "Automatic check, no exceptions" : last?.by)}
        ${box("Date", last ? new Date(last.at).toLocaleDateString() : null)}
        ${box("Reviewer's note", last?.note)}
      </div>
    </article>`;
}

// ---------- routing ----------

function route() {
  const [, page, id] = location.hash.split("/");
  window.scrollTo(0, 0);
  if (page === "cert" && id) reviewScreen(decodeURIComponent(id));
  else if (page === "form" && id) formScreen(decodeURIComponent(id));
  else dashboard();
}

function modeBar() {
  if (state.server) return;
  const bar = document.getElementById("mode");
  bar.hidden = false;
  bar.innerHTML = `Demo mode: review decisions are saved in this browser only. <button class="link" id="reset">Reset the demo</button>`;
  bar.querySelector("#reset").addEventListener("click", () => {
    state.reviews = {};
    try { localStorage.removeItem(LOCAL_KEY); } catch { /* fine */ }
    route();
  });
}

load()
  .then(() => { modeBar(); route(); addEventListener("hashchange", route); })
  .catch((err) => { view.innerHTML = `<p class="err">Could not load the data: ${esc(err.message)}. Run <code>npm run build</code>.</p>`; });
