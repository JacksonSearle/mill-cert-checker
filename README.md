# Mill Cert Checker

Reads steel mill test reports (mill certs), checks them against the specification and the
purchase order, fills in a receiving inspection report, and sends anything questionable to
a person.

**Everything in this repository is sample data.** The mills, jobs, purchase orders and
certificates are fictional. The specification limits in `app/data/specs.json` were entered
from memory for the demonstration and must be verified against the current standard before
anyone relies on them.

```bash
npm install
npm start        # http://localhost:4318
npm test
```

## How it works

```
inbox/*.pdf ──▶ Claude Code reads ──▶ cert submit ──▶ standardize ──▶ check ──▶ dashboard
               (copies what is                         (units,        (limits,    review screen
                printed, nothing else)                  names)         PO match)   inspection report
```

1. **Read.** Certificates arrive as PDFs in `inbox/`. Claude Code reads them with the
   `/read-certs` skill and copies each value exactly as printed. It is told not to convert,
   interpret or fill gaps: a blank field is recorded as blank.
2. **Cross-check the reading.** Every value that was read must appear, character for
   character, in the PDF's own text. A value that doesn't is flagged. A scanned image has no
   text to check against, so the whole certificate goes to a person.
3. **Standardize.** Code turns each reading into one record: MPa becomes ksi, millimetres
   become inches, and "ASME SA-516 GR 70", "SA-516 Gr. 70" and "A516 Grade 70" all become
   `SA-516-70`. Each conversion is kept so a reviewer can see it.
4. **Check.** Code compares the record with the limits for the specification that was
   *ordered*, and with the purchase order: right grade, a thickness that was actually
   ordered, heat number present. Each check is a pass or a flag with the reason in plain words.
5. **Review.** Certificates with no flags pass automatically. Flagged ones wait for a
   person, who sees the original document beside the checks and can correct a value (it is
   re-checked immediately), approve or reject. A note is required, and every action is logged.
6. **Report.** Each certificate has a receiving inspection report filled in from the record,
   with its disposition and who reviewed it.

The software never rejects material and never approves a flagged certificate. Only a person does.

## Why the reading and the deciding are separate

The reading is done by a language model, because every mill lays its certificate out
differently. Everything after that is ordinary code with tests, because a pass/fail
decision should be exact and repeatable. The model is never asked whether material is
acceptable, and the code never has to guess what a document says.

## Using it with your Claude account

No API key is needed. Open Claude Code in this folder and run:

```
/read-certs
```

It lists the unread PDFs (`node bin/cert.js inbox`), reads them, and submits the readings
(`node bin/cert.js submit`). The skill is in `.claude/skills/read-certs/SKILL.md`.

Other commands:

```bash
node bin/cert.js status        # every certificate and why it was flagged
node bin/cert.js show HR-88240 # every check for one certificate
node bin/cert.js build         # re-check everything after editing specs or purchase orders
```

To start over, delete `data/readings/` and `data/reviews.json`, then run `/read-certs` again.

## The sample certificates

`npm run samples` regenerates nine certificates from four fictional mills (needs Chrome).
Each one is there to exercise something:

| Certificate | What it tests | Expected |
| --- | --- | --- |
| HR-88213 | Clean plate certificate, US units | Passes |
| HR-88240 | Carbon 0.29 on 1/2 in plate, where the limit is 0.27 | Flagged |
| HR-88302 | Scanned image with no text layer | Flagged for visual confirmation |
| KPW 5-10422 | Different layout and labels ("Melt", "UTS", "Gauge") | Passes |
| KPW 5-10431 | Heat number left blank | Flagged |
| SR2611-0457 | Metric units (mm, MPa) | Passes after conversion |
| SR2611-0502 | Grade 60 supplied against an order for Grade 70 | Flagged twice |
| TRT-23-9917 | Pipe certificate | Passes |
| TRT-23-9951 | Tensile strength 58.4 ksi against a 60 minimum | Flagged |

The readings in `data/readings/` were produced by Claude Code following the skill, not typed in.

## Files

```
inbox/                      certificates to read (PDF)
.claude/skills/read-certs/  instructions for the reader
bin/cert.js                 command-line tool the reader reports through
lib/store.js                file handling, the PDF text cross-check, building the page's data
app/js/rules.js             standardizing and checking; shared by the tool, the tests and the page
app/js/app.js               dashboard, review screen, inspection report
app/data/specs.json         specification limits (illustrative)
app/data/purchase_orders.json
data/readings/              what was read from each certificate, as printed
data/reviews.json           reviewers' decisions and the log of what they did
server.js                   serves the app and saves reviews; no dependencies
test/rules.test.js          tests for the rules
samples/make-samples.mjs    generates the sample certificates
```

The `app/` folder also works as plain static files with no server. In that mode review
decisions are kept in the browser, which is how the public demo runs.

## Limits

- Two specifications have limits on file: SA-516 Grade 70 plate and SA-106 Grade B pipe.
  Anything else is flagged as "no limits on file".
- Only heat analysis and room-temperature tensile results are checked. Impact tests,
  hardness, carbon equivalent, product analysis and supplementary requirements are not.
- Elongation for pipe is not checked, because the requirement depends on the specimen.
- One certificate is assumed to cover one heat.
- It has only been run on the nine sample documents here, never on real certificates.
