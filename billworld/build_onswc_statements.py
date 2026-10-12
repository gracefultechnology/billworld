"""Build synthetic ONSWC statements; reportlab is only a build dependency.

Run with a Python that has ReportLab, e.g. `.upstream/review-venv/bin/python
billworld/build_onswc_statements.py`. Line items come from the same tenant
fixture the runtime uses (published Rocklyn rates; synthetic usage).
"""
import hashlib
import json
import subprocess
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'output' / 'pdf'
MANIFEST = ROOT / 'research' / 'onswc-statements.json'


def money(cents):
    return f"${cents / 100:,.2f}"


def build():
    code = """
import {World} from './billworld/engine.mjs';
const w=new World(':memory:',{construction:true});
try{const f=w.create({siteId:'onswc',taskId:'onswc-username-login-v1'}),s=w.state(f.episodeId);
console.log(JSON.stringify(s.invoices.map(i=>{const a=s.accounts.find(a=>a.id===i.accountId);return{siteId:s.siteId,invoiceId:i.id,accountId:i.accountId,
number:i.number,period:i.period,dueDate:i.dueDate,amountCents:i.amountCents,customerNumber:a.customerNumber,name:a.name,
billDate:i.billDate,pastDueDate:i.pastDueDate,lines:i.lines,serviceAddress:a.serviceAddress};})));}finally{w.close();}
"""
    fixtures = json.loads(subprocess.check_output(
        ['node', '--input-type=module', '-e', code], cwd=ROOT.parent, text=True))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    documents = []
    navy, gray, line = HexColor('#14415e'), HexColor('#55636e'), HexColor('#cfd9e0')
    for fixture in fixtures:
        filename = f"onswc-{fixture['invoiceId']}.pdf"
        path = OUTPUT / filename
        pdf = canvas.Canvas(str(path), pagesize=letter, invariant=1, pageCompression=1)
        pdf.setTitle('Billworld synthetic Old North State Water Company statement')
        pdf.setAuthor('Billworld')
        pdf.setFillColor(navy)
        pdf.setFont('Helvetica-Bold', 20)
        pdf.drawString(48, 738, 'Old North State Water Company')
        pdf.setFont('Helvetica', 11)
        pdf.setFillColor(gray)
        pdf.drawString(48, 720, 'Water and wastewater statement - synthetic local benchmark fixture')
        pdf.drawRightString(564, 738, 'Customer Service (877) 511-2911')
        pdf.setStrokeColor(line)
        pdf.line(48, 704, 564, 704)
        rows = [
            ('Customer', fixture['name']),
            ('Account number', fixture['customerNumber']),
            ('Service address', fixture['serviceAddress']),
            ('Bill number', fixture['number']),
            ('Service period', fixture['period'] + ' (billed monthly in arrears)'),
            ('Billing date', fixture['billDate']),
            ('Due date', fixture['dueDate'] + ' (due on billing date)'),
            ('Past due after', fixture['pastDueDate']),
        ]
        y = 676
        for label, value in rows:
            pdf.setFillColor(gray)
            pdf.setFont('Helvetica', 10)
            pdf.drawString(48, y, label)
            pdf.setFillColor(navy)
            pdf.setFont('Helvetica', 11)
            pdf.drawString(180, y, value)
            y -= 22
        y -= 8
        pdf.setFont('Helvetica-Bold', 11)
        pdf.drawString(48, y, 'Charges')
        pdf.drawRightString(564, y, 'Amount')
        y -= 6
        pdf.line(48, y, 564, y)
        pdf.setFont('Helvetica', 10)
        for item in fixture['lines']:
            y -= 18
            pdf.drawString(48, y, item['label'])
            pdf.drawRightString(564, y, money(item['amountCents']))
        y -= 14
        pdf.setFillColor(HexColor('#e9f1f6'))
        pdf.rect(48, y - 34, 516, 34, fill=1, stroke=0)
        pdf.setFillColor(navy)
        pdf.setFont('Helvetica-Bold', 13)
        pdf.drawString(60, y - 22, 'Total amount due')
        pdf.drawRightString(552, y - 22, money(fixture['amountCents']))
        y -= 62
        pdf.setFont('Helvetica', 9)
        pdf.setFillColor(gray)
        for text in [
            'Rates shown are the published Rocklyn water and wastewater rates (onswc.com/our-rates); usage is synthetic.',
            'Water: 1% per month finance charge on balances still past due 25 days after the billing date.',
            'Wastewater: 1% per month finance charge on balances still past due 15 days after the billing date.',
            'Online payments in the customer portal include a processing fee; ACH Auto Draft is available.',
            'Remit to: P.O. Box 738601, Dallas, TX 75373-8601.',
            'Payments and processing fees appear in the portal Transaction History, not on this fixed statement.',
            'This document is synthetic and is not an actual Old North State Water Company bill.',
        ]:
            pdf.drawString(48, y, text)
            y -= 15
        pdf.drawString(48, 48, 'Billworld construction environment')
        pdf.drawRightString(564, 48, 'Page 1 of 1')
        pdf.showPage()
        pdf.save()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        keep = {k: fixture[k] for k in ('siteId', 'invoiceId', 'accountId', 'number', 'period', 'dueDate', 'amountCents', 'customerNumber', 'name')}
        documents.append({**keep, 'file': filename, 'sha256': digest, 'bytes': path.stat().st_size})
    MANIFEST.write_text(json.dumps({
        'schema': 1, 'synthetic': True, 'documents': documents,
        'evidence': 'Layout is a Billworld reconstruction; no original ONSWC statement was captured. Charges use published Rocklyn rates with synthetic usage.',
        'policy': 'Runtime serves a statement only when every bound invoice field still matches; changed invoices require a rebuild.',
    }, indent=2) + '\n')
    print(json.dumps(documents, indent=2))


if __name__ == '__main__':
    build()
