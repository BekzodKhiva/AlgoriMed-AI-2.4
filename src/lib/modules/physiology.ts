// physiology.ts — AlgoriMed Engine v2.7
// ════════════════════════════════════════════════════════════════════
// VITAL SIGNS moduli: SBP / SpO2 / RR / RTS
// FIX 7: engine.ts dan ajratilgan — test qilish osonlashadi
//
// ARXITEKTURA: Bu modul PURE OVERRIDE (weighted score ishlatilmaydi)
// SBP < 90 && SpO2 < 90 → early return EMERGENCY (engine.ts da)
// ════════════════════════════════════════════════════════════════════

import { TriggeredRule, XaiEntry, AnalysisResult } from '../types';

export interface PhysiologyResult {
  vitalScore: number;
  vitalOverride: 'emergency' | 'urgent' | null;
  surgicalUrgencyDelta: AnalysisResult['surgicalUrgency'];
  vitalRules: TriggeredRule[];
  xaiEntries: XaiEntry[];
  rtsScore?: number;
}

// ── RTS KODLASH (Boyd et al. 1987) ───────────────────────────────────────
export function rtsCode_GCS(gcs: number): number {
  if (gcs >= 13) return 4;
  if (gcs >= 9)  return 3;
  if (gcs >= 6)  return 2;
  if (gcs >= 4)  return 1;
  return 0;
}

export function rtsCode_SBP(sbp: number): number {
  if (sbp > 89) return 4;
  if (sbp > 75) return 3;
  if (sbp > 49) return 2;
  if (sbp > 0)  return 1;
  return 0;
}

export function rtsCode_RR(rr: number): number {
  if (rr >= 10 && rr <= 29) return 4;
  if (rr > 29)              return 3;
  if (rr >= 6)              return 2;
  if (rr >= 1)              return 1;
  return 0;
}

export function assessPhysiology(params: {
  sbp?: number;
  spO2?: number;
  respiratoryRate?: number;
  gcsTotal: number;
  hasSBP: boolean;
  hasSpO2: boolean;
  hasRR: boolean;
  chestPain?: boolean;
  abdominalPain?: boolean;
}): PhysiologyResult {
  const { sbp = 0, spO2 = 100, respiratoryRate: rr = 0, gcsTotal } = params;
  const { hasSBP, hasSpO2, hasRR } = params;

  const vitalRules: TriggeredRule[] = [];
  const xaiEntries: XaiEntry[] = [];
  let vitalScore   = 0;
  let vitalOverride: 'emergency' | 'urgent' | null = null;
  let surgicalUrgencyDelta: AnalysisResult['surgicalUrgency'] = 'not_required';

  // NOT: SBP < 90 && SpO2 < 90 kombinatsiyasi engine.ts da early return sifatida handle qilingan
  // Bu yerda faqat alohida holatlar

  // K_V2: Kritik gipotenziya (SBP < 90)
  if (hasSBP && sbp < 90) {
    vitalScore    = Math.max(vitalScore, 90);
    vitalOverride = vitalOverride ?? 'urgent';
    surgicalUrgencyDelta = 'urgent';
    vitalRules.push({
      id: 'VIT-SBP1', name: 'Kritik gipotenziya',
      protocol: 'VITAL', riskLevel: 'high',
      description: `SBP ${sbp} mmHg < 90 — KRITIK ikkilamchi TBI jarohati. OR o'lim: 4.36 (BTF 2016, WSES 2019)`,
      weight: 0.90
    });
    xaiEntries.push({
      fact:   `SBP = ${sbp} mmHg (chegara: 90 mmHg)`,
      effect: 'Gipotenziya → serebral perfuziya bosimi (CPP) pasayadi → miya ishemiyasi → ikkilamchi TBI zararlanishi',
      impact: `O'lim xavfi OR 4.36 (hospital gipotenziya). Serebral avtoregulyatsiya buziladi. Maqsad: SBP >= 110 mmHg (ACS TBI 2024)`,
      source: 'BTF 2016/2023, WSES 2019, ACS TBI 2024, IMPACT model'
    });
    xaiEntries.push({
      fact:   'OVERRIDE SABABI: SBP < 90 mmHg',
      effect: 'VITAL OVERRIDE URGENT — boshqa protokollar ikkinchi o\'rinda',
      impact: 'Urgency: HIGH → EMERGENCY chegarasiga yaqin',
      source: 'BTF 2016, IMPACT model'
    });
  }
  // K_V3: Gipotenziya xavf zonasi (SBP 90–110)
  else if (hasSBP && sbp < 110) {
    vitalScore = Math.max(vitalScore, 45);
    vitalRules.push({
      id: 'VIT-SBP2', name: 'Gipotenziya xavf zonasi',
      protocol: 'VITAL', riskLevel: 'medium',
      description: `SBP ${sbp} mmHg — xavfli zona (90–110). Maqsad >= 110 mmHg (ACS TBI 2024, BTF yoshga bog'liq chegara)`,
      weight: 0.45
    });
    xaiEntries.push({
      fact:   `SBP = ${sbp} mmHg (xavf zonasi: 90–110)`,
      effect: 'Nisbiy gipotenziya → serebral avtoregulyatsiya chegarasida → CPP pasayishi xavfi',
      impact: 'Secondary brain injury ehtimoli oshadi. Maqsad SBP >= 110 mmHg (ACS TBI 2024). Darhol monitoring zarur',
      source: 'ACS TBI 2024, BTF 2023, IMPACT model'
    });
  }

  // K_V4: Kritik gipoksiya (SpO2 < 90%)
  if (hasSpO2 && spO2 < 90) {
    vitalScore    = Math.max(vitalScore, 90);
    vitalOverride = vitalOverride ?? 'urgent';
    surgicalUrgencyDelta = surgicalUrgencyDelta === 'not_required' ? 'urgent' : surgicalUrgencyDelta;
    vitalRules.push({
      id: 'VIT-HYP1', name: 'Kritik gipoksiya',
      protocol: 'VITAL', riskLevel: 'high',
      description: `SpO2 ${spO2}% < 90% — KRITIK ikkilamchi TBI jarohati. OR o'lim 3.86 (EPIC Study 2021)`,
      weight: 0.90
    });
    xaiEntries.push({
      fact:   `SpO2 = ${spO2}% (chegara: 90%)`,
      effect: 'Gipoksiya → miya kislorod etishmovchiligi → neyronlar zararlanishi',
      impact: `Bitta epizod OR o'lim 3.86. Maqsad SpO2 >= 94% (BTF 2023)`,
      source: 'EPIC Study 2021, BTF 2023, ENLS 6.0'
    });
  }
  // K_V5: Gipoksiya xavf zonasi (SpO2 90–94%)
  else if (hasSpO2 && spO2 < 94) {
    vitalScore = Math.max(vitalScore, 40);
    vitalRules.push({
      id: 'VIT-HYP2', name: 'Gipoksiya xavf zonasi',
      protocol: 'VITAL', riskLevel: 'medium',
      description: `SpO2 ${spO2}% — xavf zonasi (90–94%). Maqsad >= 94% (BTF 2023). O2 terapiya boshlansin`,
      weight: 0.40
    });
  }

  // K_V6: Ko'krak og'rig'i + SpO2 < 94% → airway priority (WSES 2019)
  if (params.chestPain && hasSpO2 && spO2 < 94) {
    vitalScore = Math.max(vitalScore, 75);
    vitalOverride = vitalOverride ?? 'urgent';
    vitalRules.push({
      id: 'VIT-THOR', name: "Ko'krak + gipoksiya",
      protocol: 'WSES', riskLevel: 'high',
      description: `Ko'krak og'rig'i + SpO2 ${spO2}% — Airway priority. Ko'krak jarohati TBI DAN OLDIN davolansin (WSES 2019)`,
      weight: 0.75
    });
    xaiEntries.push({
      fact:   `Ko'krak og'rig'i + SpO2 = ${spO2}%`,
      effect: "Ko'krak jarohati (pnevmotoraks?) → gipoksiya → ikkilamchi TBI",
      impact: "cABCDE: Airway/Breathing birinchi. Ko'krak trubkasi ko'rsatmasi bo'lishi mumkin",
      source: 'WSES 2019, ATLS 10th Ed.'
    });
  }

  // K_V7: Qorin og'rig'i + SBP < 90 → qorin qon ketishi + TBI (WSES 2020)
  if (params.abdominalPain && hasSBP && sbp < 90) {
    vitalScore = Math.max(vitalScore, 85);
    vitalOverride = vitalOverride ?? 'urgent';
    surgicalUrgencyDelta = 'urgent';
    vitalRules.push({
      id: 'VIT-ABD', name: 'Qorin + gipotenziya',
      protocol: 'WSES', riskLevel: 'high',
      description: `Qorin og'rig'i + SBP ${sbp} mmHg < 90 — qorin ichki qon ketishi + TBI. Ikkala jarroh darhol chaqirilsin (WSES 2020)`,
      weight: 0.85
    });
    xaiEntries.push({
      fact:   `Qorin og'rig'i + SBP = ${sbp} mmHg`,
      effect: 'Qorin jarohati (jigar/taloq?) → gipotenziya → TBI ikkilamchi zararlanishi',
      impact: 'FAST tekshiruvi zarur. Umumiy jarroh + neyrojarroh birgalikda maslahat zarur',
      source: 'WSES 2020, CRASH model, ACS TQIP 2023'
    });
  }

  // K_V8: Anormal nafas tezligi (RTS component) — Boyd 1987
  if (hasRR && (rr < 10 || rr > 29)) {
    vitalScore = Math.max(vitalScore, 65);
    const rrStatus = rr < 10 ? `${rr} — bradipnoe` : `${rr} — taxipnoe`;
    vitalRules.push({
      id: 'VIT-RR', name: 'Anormal nafas',
      protocol: 'VITAL', riskLevel: 'high',
      description: `Nafas tezligi ${rrStatus}. RTS pasaygan — ko'krak/CNS jarohati (RTS Boyd 1987)`,
      weight: 0.65
    });
  }

  // RTS hisoblash (faqat SBP va RR bo'lsa)
  let rtsScore: number | undefined;
  if (hasSBP && hasRR) {
    rtsScore = Math.round(
      (0.9368 * rtsCode_GCS(gcsTotal) +
       0.7326 * rtsCode_SBP(sbp) +
       0.2908 * rtsCode_RR(rr)) * 100
    ) / 100;
    if (rtsScore < 5) {
      vitalScore = Math.max(vitalScore, 70);
      vitalOverride = vitalOverride ?? 'urgent';
      surgicalUrgencyDelta = 'urgent';
      xaiEntries.push({
        fact:   `RTS = ${rtsScore} (norma: 7.84)`,
        effect: "Past RTS → og'ir qo'shimcha jarohat va fiziologik beqarorlik belgisi",
        impact: `Travma markazi aktivatsiyasi ko'rsatmasi (Boyd 1987). Mortality xavfi sezilarli oshgan.`,
        source: 'RTS Boyd 1987, TRISS'
      });
    } else if (rtsScore < 7) {
      xaiEntries.push({
        fact:   `RTS = ${rtsScore} (norma: 7.84)`,
        effect: "O'rtacha pasaygan RTS — fiziologik zaxira kamaygan",
        impact: "Yaqin monitoring zarur. Yomonlashish belgisi sifatida kuzating.",
        source: 'RTS Boyd 1987, TRISS'
      });
    }
  }

  return { vitalScore, vitalOverride, surgicalUrgencyDelta, vitalRules, xaiEntries, rtsScore };
}
