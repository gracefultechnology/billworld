"""Build synthetic immutable Inframark statements; reportlab is only a build dependency.

Layout cues come from the operator FAQ (security code and payment ID in the bill's
top-right box, regional water authority fee, mailed-payment P.O. box). Line-item
amounts, usage and the layout itself are synthetic.
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
MANIFEST = ROOT / 'research' / 'inframark-statements.json'
# Synthetic splits; each sums to the seeded invoice amount.
LINES = {
    8432: [('Water service (6,000 gal)', 3150), ('Sewer service', 2875), ('Regional water authority fee', 1907), ('Garbage collection', 500)],
    7219: [('Water service (4,800 gal)', 2612), ('Sewer service', 2875), ('Regional water authority fee', 1232), ('Garbage collection', 500)],
    5190: [('Water service (3,000 gal)', 1640), ('Sewer service', 2400), ('Regional water authority fee', 650), ('Garbage collection', 500)],
}


def fixtures():
    code = """
import {World} from './billworld/engine.mjs';
const w=new World(':memory:',{construction:true});
try{const f=w.create({siteId:'inframark',taskId:'inframark-username-login-v1'}),s=w.state(f.episodeId),site=JSON.parse((await import('node:fs')).readFileSync('./billworld/sites/inframark.json'));
console.log(JSON.stringify(s.invoices.map(i=>{const a=s.accounts.find(a=>a.id===i.accountId);return {siteId:s.siteId,invoiceId:i.id,accountId:i.accountId,
number:i.number,period:i.period,dueDate:i.dueDate,amountCents:i.amountCents,customerNumber:a.customerNumber,name:a.name,
paymentId:a.starnikPaymentId,serviceAddress:a.serviceAddress,securityCode:site.construction_account_credentials[a.id].security_code};})));}finally{w.close();}
"""
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT.parent, text=True))


def money(cents):
    return f'${cents / 100:.2f}'


def build():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    documents = []
    for fx in fixtures():
        lines = LINES[fx['amountCents']]
        assert sum(v for _, v in lines) == fx['amountCents']
        filename = f"inframark-{fx['invoiceId']}.pdf"
        path = OUTPUT / filename
        pdf = canvas.Canvas(str(path), pagesize=letter, invariant=1, pageCompression=1)
        pdf.setTitle('Billworld synthetic Inframark water bill')
        pdf.setAuthor('Billworld')
        navy, grey = HexColor('#0b3c5d'), HexColor('#55626d')
        pdf.setFillColor(navy)
        pdf.setFont('Helvetica-Bold', 20)
        pdf.drawString(48, 738, 'Inframark')
        pdf.setFont('Helvetica', 11)
        pdf.drawString(48, 720, 'Water, sewer and district services statement')
        pdf.setFillColor(grey)
        pdf.setFont('Helvetica', 9)
        pdf.drawString(48, 706, 'Synthetic local benchmark fixture; not an actual district bill.')
        # Top-right box: the FAQ says the security code and payment ID are printed here.
        pdf.setStrokeColor(navy)
        pdf.rect(352, 676, 212, 84, fill=0, stroke=1)
        pdf.setFillColor(navy)
        pdf.setFont('Helvetica-Bold', 9)
        for i, (label, value) in enumerate([('Security code', fx['securityCode']), ('Payment ID', fx['paymentId']),
                                            ('Account number', fx['customerNumber']), ('Due date', fx['dueDate'])]):
            pdf.drawString(362, 744 - i * 18, label)
            pdf.setFont('Helvetica', 10)
            pdf.drawRightString(556, 744 - i * 18, value)
            pdf.setFont('Helvetica-Bold', 9)
        pdf.setStrokeColor(HexColor('#c9d3db'))
        pdf.line(48, 660, 564, 660)
        y = 636
        for label, value in [('Customer', fx['name']), ('Service address', fx['serviceAddress']),
                             ('Bill number', fx['number']), ('Billing period', fx['period'])]:
            pdf.setFillColor(grey)
            pdf.setFont('Helvetica', 9)
            pdf.drawString(48, y, label)
            pdf.setFillColor(navy)
            pdf.setFont('Helvetica', 11)
            pdf.drawString(170, y, value)
            y -= 24
        y -= 8
        pdf.setFont('Helvetica-Bold', 11)
        pdf.drawString(48, y, 'Current charges')
        y -= 20
        pdf.setFont('Helvetica', 10)
        for label, cents in lines:
            pdf.drawString(60, y, label)
            pdf.drawRightString(548, y, money(cents))
            y -= 18
        pdf.setFillColor(HexColor('#e8f0f6'))
        pdf.rect(48, y - 30, 516, 32, fill=1, stroke=0)
        pdf.setFillColor(navy)
        pdf.setFont('Helvetica-Bold', 13)
        pdf.drawString(60, y - 20, 'Total amount due')
        pdf.drawRightString(548, y - 20, money(fx['amountCents']))
        y -= 64
        pdf.setFont('Helvetica', 9)
        pdf.setFillColor(grey)
        for line in [
            'Pay online at the Resident Portal: card convenience fee 3% of payment; electronic check fee $1.00.',
            'To pay with your own bank\'s online bill pay, use the Payment ID shown above.',
            'Mail payments to: ATTN: Your MUD District, P.O. Box 3264, Houston, TX 77253-3264.',
            'Payments received after the due date are subject to a late fee (amount set by your district).',
            'The regional water authority fee funds the conversion from groundwater to surface water.',
            'Customer Service: (832) 467-1599. Usage, charges and layout on this statement are synthetic.',
        ]:
            pdf.drawString(48, y, line)
            y -= 15
        pdf.setFont('Helvetica', 8)
        pdf.drawString(48, 40, 'Billworld local benchmark environment')
        pdf.drawRightString(564, 40, 'Page 1 of 1')
        pdf.showPage()
        pdf.save()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        documents.append({key: fx[key] for key in ('siteId', 'invoiceId', 'accountId', 'number', 'period', 'dueDate',
                                                   'amountCents', 'customerNumber', 'name')} | {'file': filename, 'sha256': digest})
    MANIFEST.write_text(json.dumps({'schema': 1, 'synthetic': True, 'documents': documents}, indent=2) + '\n')
    print(json.dumps(documents, indent=2))


if __name__ == '__main__':
    build()
