#!/usr/bin/env python3
"""One-time consolidation: merge categories/*.json into one file per bill group,
dedupe entries, apply cleaned notes, and drop research metadata.

usage: finalize.py <src_categories_dir> <dest_dir> [clean_out_dir]
"""
import glob, hashlib, json, os, re, sys, collections

SRC, DEST = sys.argv[1], sys.argv[2]
CLEAN = sys.argv[3] if len(sys.argv) > 3 else None

GROUPS = {
    "electric": "Electric utilities, co-ops, municipal utilities and retail electric providers",
    "gas": "Natural gas utilities and gas marketers",
    "water-sewer": "Water, sewer and stormwater utilities",
    "trash": "Trash and recycling collection",
    "propane-heating-oil": "Propane and heating oil delivery",
    "phone-wireless": "Mobile phone carriers",
    "phone-landline": "Home phone companies",
    "tv": "Cable, satellite and live TV streaming",
    "internet": "Home internet providers",
    "streaming-subscriptions": "Streaming services, subscriptions and memberships",
    "credit-cards": "Credit card and store card issuers",
    "banks": "Banks",
    "credit-unions": "Credit unions",
    "mortgage": "Mortgage, HELOC and reverse mortgage servicers",
    "loans": "Auto, personal and student loans",
    "medicare": "Medicare premiums and Medicare plans",
    "insurance": "Health, home, auto, life and other insurance",
    "medical": "Hospitals, physicians, ambulance, labs and other medical billing",
    "pharmacy-dme": "Pharmacies and medical equipment suppliers",
    "dental-vision-hearing": "Dental, vision and hearing",
    "senior-services": "Medical alert, home care and senior services",
    "property-tax": "Property tax collectors",
    "government": "Income tax and other government payments",
    "vehicle-tolls": "Vehicle registration and toll accounts",
    "housing": "Rent, HOA and senior living",
    "home-services": "Home security, warranties and home services",
    "storage-funeral": "Self-storage and funeral or cemetery plans",
    "other": "Other recurring bills",
}
TYPE_GROUP = {
    "electric": "electric", "gas": "gas", "water": "water-sewer", "sewer": "water-sewer",
    "trash": "trash", "propane": "propane-heating-oil", "heating-oil": "propane-heating-oil",
    "wireless": "phone-wireless", "landline": "phone-landline", "cable-tv": "tv",
    "satellite-tv": "tv", "internet": "internet", "streaming": "streaming-subscriptions",
    "subscription": "streaming-subscriptions", "membership": "streaming-subscriptions",
    "credit-card": "credit-cards", "bank": "banks", "credit-union": "credit-unions",
    "mortgage": "mortgage", "heloc": "mortgage", "reverse-mortgage": "mortgage",
    "auto-loan": "loans", "personal-loan": "loans", "student-loan": "loans",
    "medical": "medical", "pharmacy": "pharmacy-dme", "dental": "dental-vision-hearing",
    "vision": "dental-vision-hearing", "hearing": "dental-vision-hearing",
    "medical-alert": "senior-services", "property-tax": "property-tax",
    "income-tax": "government", "vehicle-registration": "vehicle-tolls", "toll": "vehicle-tolls",
    "rent": "housing", "hoa": "housing", "senior-living": "housing",
    "home-security": "home-services", "home-services": "home-services",
    "storage": "storage-funeral", "funeral": "storage-funeral", "other": "other",
}

def group_of(bt):
    bt = bt or "other"
    if bt.startswith("medicare"):
        return "medicare"
    if bt.startswith("insurance"):
        return "dental-vision-hearing" if bt in ("insurance-dental", "insurance-vision") else "insurance"
    return TYPE_GROUP.get(bt, "other")

FIELDS = ["name", "parent_company", "aliases", "bill_type", "entity_type", "service_area",
          "service_area_detail", "approx_customers", "tier", "website", "login_url", "help_center_url",
          "links", "phone_customer_service", "phone_pay_by_phone", "mail_payment_address",
          "payment_processor", "app", "senior_programs", "notes", "verified", "last_checked"]
# Useful extras kept as-is: identifiers for joining public datasets, and billing facts.
EXTRAS = ["issuer", "card_program", "subservicers", "escrow_info", "lienholder_address",
          "trash_billing_method", "legacy_successor", "hq_address", "eia_utility_id",
          "sdwis_pwsids", "ncua_charter", "fdic_cert", "cms_contracts", "county_fips"]
LINKS = ["view_bill", "pay_bill", "autopay_setup", "autopay_cancel", "statements_history",
         "paperless", "payment_assistance"]

clean = {}
if CLEAN:
    for p in glob.glob(os.path.join(CLEAN, "*.json")):
        clean.update(json.load(open(p)))

def cleaned(field, text):
    if not isinstance(text, str) or not text.strip():
        return None
    h = hashlib.sha1((field + "\0" + text).encode()).hexdigest()[:16]
    if h not in clean:
        missing[field] += 1
        return text
    return clean[h].strip() or None

def norm_name(n):
    n = (n or "").lower().replace("&", " and ")
    # Parenthesized text often tells apart same-named billers ("Memorial Hospital (Fremont, OH)"),
    # so keep it, apart from bare ID codes such as EPA PWSIDs.
    n = re.sub(r"\(\s*[a-z]{2}\d{5,}\s*\)", " ", n)
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    n = re.sub(r"\b(inc|llc|co|corp|corporation|company|the|of|l l c)\b", " ", n)
    return " ".join(n.split())

def score(e):
    links = e.get("links") or {}
    return (sum(1 for k in LINKS if links.get(k)) * 3 + (e.get("tier") == "detailed") * 5
            + sum(1 for k in FIELDS if e.get(k)) + bool(e.get("verified")))

def merge(a, b):
    """a wins; fill gaps from b."""
    out = dict(a)
    for k, v in b.items():
        if k == "links":
            la, lb = dict(out.get("links") or {}), v or {}
            for lk, lv in lb.items():
                if lv and not la.get(lk):
                    la[lk] = lv
            out["links"] = la
        elif v not in (None, "", [], {}) and out.get(k) in (None, "", [], {}):
            out[k] = v
    return out

missing = collections.Counter()
entries, files = [], sorted(glob.glob(os.path.join(SRC, "*.json")))
src_docs = {}
for f in files:
    doc = json.load(open(f))
    slug = os.path.basename(f)[:-5]
    src_docs[slug] = doc
    for e in doc.get("entries", []):
        e["_src"] = slug
        entries.append(e)

buckets = collections.OrderedDict()
for e in entries:
    sa = e.get("service_area") or []
    key = (norm_name(e.get("name")), group_of(e.get("bill_type")), ",".join(sorted(sa)))
    buckets.setdefault(key, []).append(e)

out = collections.defaultdict(list)
group_srcs = collections.defaultdict(set)
for key, es in buckets.items():
    group_srcs[key[1]].update(e["_src"] for e in es)
    es = sorted(es, key=score, reverse=True)
    m = es[0]
    for other in es[1:]:
        m = merge(m, other)
    r = {}
    for k in FIELDS + EXTRAS:
        v = m.get(k)
        if k in ("notes", "senior_programs"):
            v = cleaned(k, v)
        if k == "links":
            v = {lk: (v or {}).get(lk) for lk in LINKS}
        if k == "app" and isinstance(v, dict) and not any(v.values()):
            v = None
        if v in ("", [], {}) and k not in ("links",):
            v = None
        if k in EXTRAS and v is None:
            continue
        r[k] = v
    out[key[1]].append(r)

os.makedirs(DEST, exist_ok=True)
for g, es in sorted(out.items()):
    es.sort(key=lambda e: (",".join(e.get("service_area") or []), (e.get("name") or "").lower()))
    srcs = sorted(group_srcs[g])
    notes = "\n\n".join(f"[{s}] {src_docs[s]['coverage_notes'].strip()}" for s in srcs
                         if (src_docs[s].get("coverage_notes") or "").strip())
    sources, seen = [], set()
    for s in srcs:
        for x in src_docs[s].get("sources") or []:
            u = isinstance(x, dict) and x.get("url")
            if u and u not in seen:
                seen.add(u)
                sources.append(x)
    json.dump({"category": g, "description": GROUPS[g], "research_files": srcs,
               "coverage_notes": notes, "sources": sources, "entries": es},
              open(os.path.join(DEST, g + ".json"), "w"), indent=1, ensure_ascii=False)
total = sum(len(v) for v in out.values())
print(f"{len(entries)} source entries -> {total} after dedupe in {len(out)} files; "
      f"uncleaned: {dict(missing)}")
