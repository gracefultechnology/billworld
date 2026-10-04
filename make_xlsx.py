#!/usr/bin/env python3
"""Build billers.xlsx from billers.csv (run build.py first). Needs xlsxwriter."""
import csv, os, sys, collections
import xlsxwriter

HERE = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "billers.xlsx")
csv.field_size_limit(10**8)
rows = list(csv.DictReader(open(os.path.join(HERE, "billers.csv"))))
cols = list(rows[0].keys())
LINKS = [c for c in cols if c.startswith("link_")]
CORE = ["name", "bill_type", "service_area", "service_area_detail", "tier", "website",
        "phone_customer_service", "payment_processor", "verified", "source_category"]

wb = xlsxwriter.Workbook(out, {"strings_to_urls": False, "constant_memory": False})
bold = wb.add_format({"bold": True, "bg_color": "#DDE6F0"})

def sheet(name, data, columns, widths=None):
    ws = wb.add_worksheet(name)
    ws.write_row(0, 0, columns, bold)
    for i, e in enumerate(data, 1):
        ws.write_row(i, 0, [(e.get(c) or "")[:32000] for c in columns])
    ws.freeze_panes(1, 1)
    ws.autofilter(0, 0, len(data), len(columns) - 1)
    for j, c in enumerate(columns):
        ws.set_column(j, j, (widths or {}).get(c, 40 if c.startswith("link_") or c in ("website", "notes") else 18))

det = [e for e in rows if e["tier"] == "detailed"]
ws = wb.add_worksheet("README")
info = [
    "U.S. billers with official pages for viewing and paying bills, autopay and statements",
    "Source of truth: categories/*.json (one file per bill group). Rebuild: build.py then make_xlsx.py.",
    f"Entries: {len(rows)}  |  detailed: {len(det)}  |  verified: {sum(1 for e in rows if e['verified'] == 'True')}",
    "Detailed sheet: billers whose official help pages were researched (view bill, pay, autopay setup/cancel, statements, paperless, assistance).",
    "All billers sheet: every entry incl. roster tier (identity + website) from EIA-861, FDIC, NCUA, EPA SDWIS, FCC, CMS, CFPB rosters.",
    "verified=True: the pages were opened and checked. A blank link was not found. Links were checked Sep 29 - Oct 3, 2026.",
]
for i, t in enumerate(info):
    ws.write(i, 0, t, bold if i == 0 else None)
ws.set_column(0, 0, 140)

ws = wb.add_worksheet("Coverage")
ws.write_row(0, 0, ["link", "detailed with link", "%"], bold)
for i, k in enumerate(LINKS, 1):
    n = sum(1 for e in det if e[k])
    ws.write_row(i, 0, [k[5:], n, round(100 * n / max(1, len(det)))])
r0 = len(LINKS) + 3
ws.write_row(r0, 0, ["bill_type", "entries", "detailed"], bold)
bt = collections.Counter(e["bill_type"] for e in rows)
dt = collections.Counter(e["bill_type"] for e in det)
for i, (t, n) in enumerate(bt.most_common(), r0 + 1):
    ws.write_row(i, 0, [t, n, dt[t]])
ws.set_column(0, 0, 28)

det_cols = ["name", "parent_company", "bill_type", "service_area", "service_area_detail",
            "approx_customers", "website", "login_url", "help_center_url"] + LINKS + [
            "phone_customer_service", "phone_pay_by_phone", "mail_payment_address",
            "payment_processor", "senior_programs", "notes", "verified", "last_checked",
            "entity_type", "source_category"]
sheet("Detailed", det, det_cols)
sheet("All billers", rows, CORE + ["link_pay_bill"])
wb.close()
print(out, os.path.getsize(out))
