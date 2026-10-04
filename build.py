#!/usr/bin/env python3
"""Merge categories/*.json into billers.json, billers.csv and COVERAGE.md."""
import csv, glob, json, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LINKS = ["view_bill", "pay_bill", "autopay_setup", "autopay_cancel",
         "statements_history", "paperless", "payment_assistance"]

rows, cats, bad = [], [], []
for path in sorted(glob.glob(os.path.join(HERE, "categories", "*.json"))):
    slug = os.path.basename(path)[:-5]
    try:
        doc = json.load(open(path))
    except Exception as e:
        bad.append((slug, str(e)))
        continue
    entries = doc.get("entries", [])
    cats.append((slug, doc, entries))
    for e in entries:
        e = dict(e)
        e["source_category"] = slug
        rows.append(e)

json.dump({"entry_count": len(rows), "entries": rows},
          open(os.path.join(HERE, "billers.json"), "w"), indent=1)

cols = ["name", "parent_company", "bill_type", "entity_type", "service_area",
        "service_area_detail", "approx_customers", "tier", "website", "login_url",
        "help_center_url"] + [f"link_{k}" for k in LINKS] + [
        "phone_customer_service", "phone_pay_by_phone", "mail_payment_address",
        "payment_processor", "senior_programs", "verified", "last_checked",
        "source_category", "notes"]
with open(os.path.join(HERE, "billers.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(cols)
    for e in rows:
        links = e.get("links") or {}
        out = []
        for c in cols:
            v = links.get(c[5:]) if c.startswith("link_") else e.get(c)
            if isinstance(v, list):
                v = ";".join(map(str, v))
            elif isinstance(v, dict):
                v = json.dumps(v)
            out.append("" if v is None else v)
        w.writerow(out)

det = [e for e in rows if e.get("tier") == "detailed"]
by_type = collections.Counter(e.get("bill_type") or "?" for e in rows)
det_type = collections.Counter(e.get("bill_type") or "?" for e in det)
state_type = collections.defaultdict(collections.Counter)
for e in det:
    for s in e.get("service_area") or []:
        state_type[s][e.get("bill_type") or "?"] += 1

md = ["# Biller coverage", "",
      f"- Entries: **{len(rows)}** (detailed {len(det)}, verified "
      f"{sum(1 for e in rows if e.get('verified'))})",
      f"- Category files: {len(cats)}" + (f"; unparseable: {bad}" if bad else ""), "",
      "## Link fill rate (detailed entries)", "", "| link | filled | % |", "|---|---:|---:|"]
for k in LINKS:
    n = sum(1 for e in det if (e.get("links") or {}).get(k))
    md.append(f"| {k} | {n} | {100*n//max(1,len(det))}% |")
md += ["", "## By bill type", "", "| bill_type | entries | detailed |", "|---|---:|---:|"]
for t, n in by_type.most_common():
    md.append(f"| {t} | {n} | {det_type[t]} |")
md += ["", "## Per category", "", "| category | entries | detailed | verified |", "|---|---:|---:|---:|"]
for slug, doc, es in cats:
    md.append(f"| {slug} | {len(es)} | {sum(1 for e in es if e.get('tier')=='detailed')} | "
              f"{sum(1 for e in es if e.get('verified'))} |")
md += ["", "## Detailed electric/gas/water entries per state", "",
       "| state | electric | gas | water | sewer |", "|---|---:|---:|---:|---:|"]
for s in sorted(k for k in state_type if len(k) == 2 and k != "US"):
    c = state_type[s]
    md.append(f"| {s} | {c['electric']} | {c['gas']} | {c['water']} | {c['sewer']} |")
open(os.path.join(HERE, "COVERAGE.md"), "w").write("\n".join(md))
print(len(rows), "entries,", len(det), "detailed,", len(cats), "categories", bad or "")
