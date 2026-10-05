// Minimal searchable-text PDF writer for synthetic statements (Helvetica, single page per call).
export function textPdf(lines, { title = 'Statement' } = {}) {
  const escPdf = s => String(s).replace(/[\\()]/g, c => '\\' + c).replace(/[^\x20-\x7e]/g, '-');
  let y = 760; const ops = ['BT', '/F1 16 Tf', `72 ${y} Td`, `(${escPdf(title)}) Tj`, 'ET'];
  for (const line of lines) { y -= line.startsWith('#') ? 26 : 16; if (y < 60) break; const big = line.startsWith('#'); ops.push('BT', `/F1 ${big ? 13 : 10} Tf`, `72 ${y} Td`, `(${escPdf(big ? line.slice(1).trim() : line)}) Tj`, 'ET'); }
  const stream = ops.join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, `<< /Title (${escPdf(title)}) /Producer (Billworld) >>`];
  let out = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
