#!/usr/bin/env python3
"""Audit the Billworld source catalog without changing research records.

Usage: python3 audit_billworld.py [--output-dir billworld-audit]
Processor families are candidate mappings, never authenticated-flow evidence.
"""
import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
LINKS = ("view_bill", "pay_bill", "autopay_setup", "autopay_cancel",
         "statements_history", "paperless", "payment_assistance")
FIELDS = ("website", "login_url", "help_center_url", "payment_processor")
FAMILIES = (
    ("smarthub", "NISC SmartHub"), ("invoicecloud", "InvoiceCloud"),
    ("invoice cloud", "InvoiceCloud"), ("paymentus", "Paymentus"),
    ("mychart", "Epic MyChart"), ("municipalonline", "Tyler candidate"),
    ("municipal online", "Tyler candidate"), ("xpress bill", "Xpress Bill Pay"),
    ("kubra", "KUBRA"), ("speedpay", "ACI Speedpay"),
    ("personapay", "PersonaPay"), ("rentcafe", "Yardi RentCafe"),
    ("yardi", "Yardi candidate"), ("synchrony", "Synchrony"),
    ("comenity", "Bread Financial candidate"), ("bread financial", "Bread Financial candidate"),
    ("starnik", "Starnik"), ("bs&a", "BS&A Online"), ("wipp", "Edmunds WIPP"),
    ("pay.gov", "Pay.gov"), ("stripe", "Stripe candidate"),
    ("ritaohio", "RITA"), ("regional income tax agency", "RITA"),
)


def identity(entry, category):
    # Provisional identity: a curated immutable ID is needed before production.
    key = [category, entry.get("name"), entry.get("bill_type"),
           sorted(entry.get("service_area") or [])]
    return "biller_" + hashlib.sha256(json.dumps(key, ensure_ascii=False).encode()).hexdigest()[:20]


def family(entry):
    # Only processor and portal fields; notes can mention unrelated alternatives.
    haystack = " ".join(str(entry.get(k) or "") for k in
                        ("payment_processor", "login_url")) .lower()
    matches = sorted({label for token, label in FAMILIES if token in haystack})
    return " | ".join(matches) if matches else "unclassified"


def write_csv(path, rows, fields):
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def audit(output_dir):
    rows = []
    category_paths = sorted((ROOT / "categories").glob("*.json"))
    for path in category_paths:
        doc = json.loads(path.read_text())
        if not isinstance(doc.get("entries"), list):
            raise ValueError(f"{path}: entries must be a list")
        for entry in doc["entries"]:
            rows.append(dict(entry, source_category=path.stem))
    detailed = [e for e in rows if e.get("tier") == "detailed"]
    summary = {
        "entry_count": len(rows), "category_count": len(category_paths),
        "tier_counts": dict(collections.Counter(e.get("tier") for e in rows)),
        "verified_flag_count": sum(e.get("verified") is True for e in rows),
        "verification_limit": "Existing verified flags do not prove authenticated behavior or per-link evidence.",
        "fill_counts": {},
        "distinct_processor_strings": len({e["payment_processor"] for e in rows if e.get("payment_processor")}),
        "same_autopay_setup_cancel_url": sum(bool((e.get("links") or {}).get("autopay_setup"))
            and (e.get("links") or {}).get("autopay_setup") == (e.get("links") or {}).get("autopay_cancel") for e in rows),
        "verified_without_website": sum(e.get("verified") is True and not e.get("website") for e in rows),
        "last_checked_counts": dict(sorted(collections.Counter(e.get("last_checked") or "missing" for e in rows).items())),
    }
    for label, entries in (("all", rows), ("detailed", detailed)):
        summary["fill_counts"][label] = {k: sum(bool(e.get(k)) for e in entries) for k in FIELDS}
        summary["fill_counts"][label]["links"] = {
            k: sum(bool((e.get("links") or {}).get(k)) for e in entries) for k in LINKS}
    xref_path = ROOT / "rosters/payment_platform_usage_xref.csv"
    with xref_path.open() as handle:
        xref = list(csv.DictReader(handle))
    categories = {p.stem for p in category_paths}
    summary["processor_xref"] = {
        "rows": len(xref),
        "rows_with_noncurrent_category_file": sum(e["category_file"] not in categories for e in xref),
        "limit": "Category labels need reconciliation; this does not establish that biller mappings are wrong.",
    }
    identities = [identity(e, e["source_category"]) for e in rows]
    if len(set(identities)) != len(identities):
        raise ValueError("Provisional catalog identity collision or duplicate")
    output_dir.mkdir(parents=True, exist_ok=True)
    backlog = []
    candidates = []
    family_counts = collections.Counter()
    for e, biller_id in zip(rows, identities):
        missing = [k for k in FIELDS if not e.get(k)]
        missing += [f"links.{k}" for k in LINKS if not (e.get("links") or {}).get(k)]
        fam = family(e)
        family_counts[fam] += 1
        base = {
            "provisional_biller_id": biller_id, "name": e.get("name"),
            "category": e["source_category"], "bill_type": e.get("bill_type"),
            "tier": e.get("tier"), "website": e.get("website"),
            "login_url": e.get("login_url"), "portal_family_candidate": fam,
        }
        backlog.append(dict(base, missing_fields=";".join(missing),
            source_verified_flag=e.get("verified"), last_checked=e.get("last_checked"),
            evidence_status="catalog_only", implementation_status="not_assessed",
            source_file=f"categories/{e['source_category']}.json"))
        if e.get("tier") == "detailed" and e.get("website") and e.get("login_url"):
            score = sum(bool((e.get("links") or {}).get(k)) for k in LINKS)
            candidates.append(dict(base, documentation_link_count=score,
                source_verified_flag=e.get("verified")))
    candidates.sort(key=lambda e: (-e["documentation_link_count"], e["category"], e["name"]))
    summary["portal_family_candidate_counts"] = dict(family_counts.most_common())
    summary["pilot_candidate_count"] = len(candidates)
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    write_csv(output_dir / "catalog_backlog.csv", backlog, list(backlog[0]))
    write_csv(output_dir / "pilot_candidates.csv", candidates, list(candidates[0]) if candidates else [])
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "billworld-audit")
    audit(parser.parse_args().output_dir)
