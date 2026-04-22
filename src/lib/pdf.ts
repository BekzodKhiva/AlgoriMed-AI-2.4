// pdf.ts — PDF hisobot generatori
import { AnalysisResult } from './types';

const DECISION_LABELS: Record<string, string> = {
  NO_CT_REQUIRED: 'KT TALAB ETILMAYDI',
  CT_RECOMMENDED: 'KT TAVSIYA ETILADI',
  CT_REQUIRED: 'KT BAJARISH TAVSIYA ETILADI',
  IMMEDIATE_CT: 'SHOSHILINCH KT',
  SURGICAL_EVALUATION: 'JARROHLIK BAHOLASH',
};

const URGENCY_LABELS: Record<string, string> = {
  LOW: 'Past', MODERATE: "O'rtacha", HIGH: 'Yuqori', EMERGENCY: 'FAVQULODDA',
};

const SEVERITY_LABELS: Record<string, string> = {
  mild: 'Yengil', moderate: "O'rta", severe: "Og'ir", critical: 'Kritik',
};

export async function generatePDF(result: AnalysisResult, doctorName: string): Promise<void> {
  const { jsPDF } = await import('jspdf');

  // jsPDF latin1 kodlash ishlatadi — barcha maxsus belgilarni xavfsiz ASCII ga aylantirish
  const sanitize = (text: string): string => text
    .replace(/≥/g, '>=').replace(/≤/g, '<=')
    .replace(/→/g, '->').replace(/←/g, '<-')
    .replace(/°/g, ' daraja')
    .replace(/–/g, '-').replace(/—/g, '-')
    .replace(/⚠️/g, '[!]').replace(/🚨/g, '[!!]')
    .replace(/✅/g, '[OK]').replace(/❌/g, '[X]')
    .replace(/[^\x00-\x7F]/g, '');  // qolgan barcha non-ASCII olib tashlanadi

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 18;
  const contentW = pageW - margin * 2;
  let y = margin;

  const addText = (text: string, x: number, yPos: number, opts: { size?: number; bold?: boolean; color?: [number,number,number]; align?: 'left'|'center'|'right' } = {}) => {
    doc.setFontSize(opts.size ?? 10);
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    if (opts.color) doc.setTextColor(...opts.color);
    else doc.setTextColor(30, 30, 30);
    doc.text(sanitize(text), x, yPos, { align: opts.align ?? 'left' });
  };

  const addLine = (yPos: number, color: [number,number,number] = [220,220,220]) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.3);
    doc.line(margin, yPos, pageW - margin, yPos);
  };

  const addRect = (x: number, yPos: number, w: number, h: number, color: [number,number,number]) => {
    doc.setFillColor(...color);
    doc.roundedRect(x, yPos, w, h, 2, 2, 'F');
  };

  // ── HEADER ──────────────────────────────────────────────────────────────
  addRect(0, 0, pageW, 28, [15, 52, 96]);
  addText('ALGORIMED', pageW / 2, 11, { size: 18, bold: true, color: [255,255,255], align: 'center' });
  addText('Klinik Qaror Qo\'llab-Quvvatlash Tizimi — TBI Tahlil Hisoboti', pageW / 2, 20, { size: 8, color: [180,210,255], align: 'center' });
  y = 36;

  // ── META ────────────────────────────────────────────────────────────────
  const dateStr = result.analyzedAt
    ? new Date(result.analyzedAt).toLocaleString('uz-UZ', { dateStyle: 'long', timeStyle: 'short' })
    : new Date().toLocaleString('uz-UZ');

  addText(`Shifokor: ${doctorName}`, margin, y, { size: 9, color: [80,80,80] });
  addText(`Sana: ${dateStr}`, pageW - margin, y, { size: 9, color: [80,80,80], align: 'right' });
  y += 5;

  if (result.patientInfo) {
    const ctLabel = result.patientInfo.ctFindings && result.patientInfo.ctFindings.length > 0
      ? result.patientInfo.ctFindings.join(', ')
      : 'Normal/Bajarilmagan';
    addText(`Bemor: ${result.patientInfo.age} yosh, ${result.patientInfo.sex} | Mexanizm: ${result.patientInfo.traumaMechanism} | KT: ${ctLabel}`, margin, y, { size: 9, color: [80,80,80] });
    y += 5;
  }
  addLine(y); y += 6;

  // ── DECISION BOX ────────────────────────────────────────────────────────
  const urgencyColors: Record<string, [number,number,number]> = {
    LOW: [39,120,85], MODERATE: [180,120,0], HIGH: [200,70,0], EMERGENCY: [180,0,0],
  };
  const boxColor = urgencyColors[result.urgency] ?? [100,100,100];
  addRect(margin, y, contentW, 22, boxColor);
  addText(DECISION_LABELS[result.decision] ?? result.decision, pageW / 2, y + 9, { size: 14, bold: true, color: [255,255,255], align: 'center' });
  addText(`Shoshqichlik: ${URGENCY_LABELS[result.urgency]} | Xavf bali: ${result.score}/100 | Ishonchlilik: ${Math.round(result.confidence * 100)}%`, pageW / 2, y + 17, { size: 8, color: [230,230,230], align: 'center' });
  y += 28;

  // ── SCORES ROW ──────────────────────────────────────────────────────────
  addText('PROTOKOL BALLARI', margin, y, { size: 9, bold: true, color: [15,52,96] }); y += 5;
  const protocols = [
    { name: 'CCHR', score: result.breakdown.cchr.score, weight: 35 },
    { name: 'GCS',  score: result.breakdown.gcs.score,  weight: 30 },
    { name: 'BTF',  score: result.breakdown.btf.score,  weight: 20 },
    { name: 'NICE', score: result.breakdown.nice.score, weight: 10 },
    { name: 'ALC',  score: result.breakdown.alcohol.score, weight: 5 },
  ];
  const colW = contentW / protocols.length;
  protocols.forEach((p, i) => {
    const x = margin + i * colW;
    addRect(x + 1, y, colW - 2, 16, [240, 245, 252]);
    addText(p.name, x + colW / 2, y + 6, { size: 8, bold: true, color: [15,52,96], align: 'center' });
    addText(`${p.score}`, x + colW / 2, y + 12, { size: 10, bold: true, color: [15,52,96], align: 'center' });
  });
  y += 22;

  // ── CLINICAL FINDINGS ───────────────────────────────────────────────────
  addText('KLINIK TOPILMALAR', margin, y, { size: 9, bold: true, color: [15,52,96] }); y += 5;
  const SURGICAL_LABELS: Record<string, string> = {
    not_required: 'Talab etilmaydi', monitor: 'Kuzatish', urgent: 'Shoshilinch', emergency: 'FAVQULODDA'
  };
  addText(`GCS Jami: ${result.gcsTotal} | Og'irlik: ${SEVERITY_LABELS[result.severity] ?? result.severity} | Jarrohlik: ${SURGICAL_LABELS[result.surgicalUrgency] ?? result.surgicalUrgency}`, margin, y, { size: 9 }); y += 7;
  addLine(y); y += 5;

  // ── REASONS ─────────────────────────────────────────────────────────────
  addText('FAOLLASHGAN QOIDALAR', margin, y, { size: 9, bold: true, color: [15,52,96] }); y += 5;
  result.reasons.forEach(r => {
    if (y > 260) { doc.addPage(); y = margin; }
    addText(`• ${r}`, margin + 3, y, { size: 8.5, color: [40,40,40] });
    y += 5;
  });
  y += 3; addLine(y); y += 5;

  // ── TREATMENT ───────────────────────────────────────────────────────────
  addText('DAVOLASH TAKTIKASI', margin, y, { size: 9, bold: true, color: [15,52,96] }); y += 5;
  result.treatmentTactics.forEach((t, i) => {
    if (y > 260) { doc.addPage(); y = margin; }
    addRect(margin, y - 3, 5, 5, [15,52,96]);
    addText(`${i + 1}.`, margin + 1.5, y + 0.5, { size: 7, bold: true, color: [255,255,255] });
    const lines = doc.splitTextToSize(sanitize(t), contentW - 8);
    lines.forEach((line: string) => {
      addText(line, margin + 8, y, { size: 8.5 });
      y += 5;
    });
    y += 1;
  });
  y += 3; addLine(y); y += 5;

  // ── SOURCES ─────────────────────────────────────────────────────────────
  addText(`Manbalar: ${result.sources.join(' | ')}`, margin, y, { size: 8, color: [100,100,100] }); y += 5;

  // ── FOOTER ──────────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    addRect(0, 287, pageW, 10, [15,52,96]);
    addText(result.disclaimer, pageW / 2, 293, { size: 7, color: [180,210,255], align: 'center' });
    addText(`${p} / ${pageCount}`, pageW - margin, 293, { size: 7, color: [180,210,255], align: 'right' });
  }

  // PDF nomi: TBI-DDMMYYYY-001
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const pdfDateStr = `${dd}${mm}${yyyy}`;
  const counterRaw = localStorage.getItem('algorimed_pdf_counter') ?? '0';
  const counter = parseInt(counterRaw) + 1;
  localStorage.setItem('algorimed_pdf_counter', String(counter));
  const counterStr = String(counter).padStart(3, '0');
  doc.save(`TBI-${pdfDateStr}-${counterStr}.pdf`);
}
