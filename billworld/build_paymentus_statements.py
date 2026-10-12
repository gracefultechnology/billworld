"""Build synthetic immutable statements; reportlab is only a build dependency."""
import hashlib
import json
import subprocess
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'output' / 'pdf'


def build():
    # Export only statement fields from the same authoritative fixture as the runtime.
    code = """
import {World} from './billworld/engine.mjs';
const w=new World(':memory:',{construction:true});
// The multi-account task links a second Batavia account; its bill needs a statement too.
try{const seen=new Set(),rows=[];for(const taskId of ['batavia-email-login-v1','batavia-pay-multiple-accounts-v1']){const f=w.create({siteId:'batavia-utilities',taskId}),s=w.state(f.episodeId);
rows.push(...s.invoices.filter(i=>!seen.has(i.id)&&seen.add(i.id)).map(i=>({siteId:s.siteId,invoiceId:i.id,accountId:i.accountId,
number:i.number,period:i.period,dueDate:i.dueDate,amountCents:i.amountCents,
customerNumber:s.accounts.find(a=>a.id===i.accountId).customerNumber,
name:s.accounts.find(a=>a.id===i.accountId).name,
serviceAddress:s.accounts.find(a=>a.id===i.accountId).serviceAddress})));}console.log(JSON.stringify(rows));}finally{w.close();}
"""
    fixtures = json.loads(subprocess.check_output(
        ['node', '--input-type=module', '-e', code], cwd=ROOT.parent, text=True))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    documents = []
    for fixture in fixtures:
        filename = f"batavia-{fixture['invoiceId']}.pdf"
        path = OUTPUT / filename
        pdf = canvas.Canvas(str(path), pagesize=letter, invariant=1, pageCompression=1)
        pdf.setTitle('Billworld synthetic Batavia utility statement')
        pdf.setAuthor('Billworld')
        pdf.setFillColor(HexColor('#163c55'))
        pdf.setFont('Helvetica-Bold', 23)
        pdf.drawString(48, 735, 'Batavia utility statement')
        pdf.setFillColor(HexColor('#526472'))
        pdf.setFont('Helvetica', 11)
        pdf.drawString(48, 710, 'Synthetic local benchmark fixture')
        pdf.setStrokeColor(HexColor('#ced8df'))
        pdf.line(48, 690, 564, 690)
        rows = [
            ('Customer', fixture['name']),
            ('Account number', fixture['customerNumber']),
            ('Service address', fixture['serviceAddress']),
            ('Bill number', fixture['number']),
            ('Billing period', fixture['period']),
            ('Due date', fixture['dueDate']),
        ]
        y = 654
        for label, value in rows:
            pdf.setFillColor(HexColor('#526472'))
            pdf.setFont('Helvetica', 10)
            pdf.drawString(48, y, label)
            pdf.setFillColor(HexColor('#163c55'))
            pdf.setFont('Helvetica', 12)
            pdf.drawString(190, y, value)
            y -= 32
        pdf.setFillColor(HexColor('#eaf1f5'))
        pdf.rect(48, 385, 516, 55, fill=1, stroke=0)
        pdf.setFillColor(HexColor('#163c55'))
        pdf.setFont('Helvetica-Bold', 14)
        pdf.drawString(64, 408, 'Original bill amount')
        pdf.drawRightString(548, 408, f"${fixture['amountCents'] / 100:.2f}")
        pdf.setFont('Helvetica', 10)
        for index, line in enumerate([
            'This fixed statement records the original seeded bill amount.',
            'Posted and pending payments appear separately in the portal history.',
            'Payment processing fees do not reduce the bill balance.',
            'No original statement layout or service line items were captured.',
            'This document is synthetic and is not an actual city bill.',
        ]):
            pdf.drawString(48, 348 - index * 19, line)
        pdf.setFillColor(HexColor('#526472'))
        pdf.setFont('Helvetica', 9)
        pdf.drawString(48, 48, 'Billworld construction environment')
        pdf.drawRightString(564, 48, 'Page 1 of 1')
        pdf.showPage()
        pdf.save()
        documents.append({**fixture, 'file': filename,
                          'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    manifest = {'schema': 1, 'synthetic': True, 'documents': documents,
                'evidence': 'Official guide documents View Bill PDF download; original PDF contents unavailable',
                'policy': 'Immutable seeded original bills; scoped authenticated download, live payments in history'}
    (ROOT / 'research' / 'paymentus-statements.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    build()
