// neuro.ts — AlgoriMed Engine v2.7
// ════════════════════════════════════════════════════════════════════
// NEURO moduli: GCS + Ko'z qorachig'i + Kranial nervlar
// FIX 7: engine.ts dan ajratilgan — mustaqil test qilish mumkin
// FIX 4: GCS validatsiya bu yerda markazlashtirilgan
// ════════════════════════════════════════════════════════════════════

import { TriggeredRule, XaiEntry, Severity } from '../types';

export interface NeuroResult {
  gcsTotal: number;
  severity: Severity;
  gcsScore: number;
  gcsRules: TriggeredRule[];
  xaiEntries: XaiEntry[];
}

// FIX 4: GCS VALIDATSIYA — markazlashtirilgan
// Noto'g'ri GCS → engine noto'g'ri qaror chiqaradi
// Bu yerda throw — UI layer try/catch bilan ushlashi kerak
export function validateGCS(eye: number, verbal: number, motor: number): void {
  if (eye < 1 || eye > 4)       throw new RangeError(`GCS Ko'z (E) xato: ${eye}. Diapazon: 1–4`);
  if (verbal < 1 || verbal > 5) throw new RangeError(`GCS So'z (V) xato: ${verbal}. Diapazon: 1–5`);
  if (motor < 1 || motor > 6)   throw new RangeError(`GCS Harakat (M) xato: ${motor}. Diapazon: 1–6`);
  const total = eye + verbal + motor;
  // Texnik jihatdan 3–15 bo'lishi kerak (yuqoridagi checks bilan ta'minlangan)
  // Lekin explicit check — mudofaa programmasi uchun
  if (total < 3 || total > 15)  throw new RangeError(`GCS jami xato: ${total}. Diapazon: 3–15`);
}

export function assessNeuro(params: {
  gcsTotal: number;
  eyeScore: number;
  verbalScore: number;
  motorScore: number;
}): NeuroResult {
  const { gcsTotal, eyeScore, verbalScore, motorScore } = params;

  // TBI og'irlik darajasi (BTF 2016)
  let severity: Severity;
  if      (gcsTotal >= 13) severity = 'mild';
  else if (gcsTotal >= 9)  severity = 'moderate';
  else if (gcsTotal >= 6)  severity = 'severe';
  else                     severity = 'critical';

  const gcsRules: TriggeredRule[] = [];
  const xaiEntries: XaiEntry[] = [];
  let gcsScore = 0;

  if      (gcsTotal <= 5)  {
    gcsScore = 100;
    gcsRules.push({ id: 'GCS-1', name: 'Kritik TBI',  protocol: 'GCS', riskLevel: 'high',
      description: `GCS ${gcsTotal} — kritik holat (3–5)`, weight: 1.0 });
    xaiEntries.push({
      fact:   `GCS jami: ${gcsTotal} (E${eyeScore}+V${verbalScore}+M${motorScore})`,
      effect: "Kritik darajadagi ong buzilishi — beyin o'zagi funksiyasi xavf ostida",
      impact: "GCS ≤5 = kritik holat. BTF 2016: GCS ≤8 neyrojarroh maslahat zarur. Tezkor baholash zarur",
      source: 'Teasdale & Jennett 1974, BTF 4th Ed. 2016'
    });
  } else if (gcsTotal <= 8)  {
    gcsScore = 85;
    gcsRules.push({ id: 'GCS-2', name: "Og'ir TBI",  protocol: 'GCS', riskLevel: 'high',
      description: `GCS ${gcsTotal} — og'ir TBI (6–8)`, weight: 0.85 });
    xaiEntries.push({
      fact:   `GCS jami: ${gcsTotal} (E${eyeScore}+V${verbalScore}+M${motorScore})`,
      effect: "Og'ir TBI — himoya reflekslari buzilishi, aspiratsiya va ikkilamchi miya jarohati ehtimoli oshadi",
      impact: "BTF 2016: GCS ≤8 = intubatsiya chegarasi. Shoshilinch KT va neyrojarroh maslahat zarur. IMPACT model: OR o'lim 3.2x",
      source: 'BTF 4th Ed. 2016, IMPACT model, ACS TQIP 2023'
    });
  } else if (gcsTotal <= 12) {
    gcsScore = 60;
    gcsRules.push({ id: 'GCS-3', name: "O'rta TBI",  protocol: 'GCS', riskLevel: 'high',
      description: `GCS ${gcsTotal} — o'rta og'irlikdagi TBI (9–12). NICE CG176: <13 = darhol CT ko'rsatmasi`, weight: 0.60 });
    xaiEntries.push({
      fact:   `GCS jami: ${gcsTotal} (E${eyeScore}+V${verbalScore}+M${motorScore})`,
      effect: "O'rta og'irlikdagi TBI — nevrologik yomonlashish ehtimoli mavjud",
      impact: "NICE CG176: GCS <13 = KT zarur. Dinamik kuzatish va neyrojarroh maslahat zarur",
      source: 'NICE CG176 2023, BTF 2016, CCHR Lancet 2001'
    });
  } else if (gcsTotal <= 14) {
    gcsScore = 20;
    gcsRules.push({ id: 'GCS-4', name: 'Yengil TBI', protocol: 'GCS', riskLevel: 'medium',
      description: `GCS ${gcsTotal} — yengil TBI (13–14)`, weight: 0.20 });
    xaiEntries.push({
      fact:   `GCS jami: ${gcsTotal} (E${eyeScore}+V${verbalScore}+M${motorScore})`,
      effect: 'Yengil TBI — GCS 13–14 CCHR yuqori xavf zonasida',
      impact: "CCHR (Stiell 2001): GCS <15 jarohatdan 2 soat o'tgach = yuqori xavf mezoni. Kuzatish zarur",
      source: 'CCHR Lancet 2001, NICE CG176 2023'
    });
  }

  return { gcsTotal, severity, gcsScore, gcsRules, xaiEntries };
}
