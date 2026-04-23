// engine.ts — AlgoriMed v2.3
// ════════════════════════════════════════════════════════════════════
// ARXITEKTURA: Threshold + Override + Context (score-based emas)
// PRINTSIP:    Worst wins — eng yomon parametr yakuniy qarorni belgilaydi
//
// QATLAM TARTIBI (prioritet bo'yicha):
//   1. PHYSIOLOGY  — SBP / SpO2 (hamma narsani override qiladi)
//   2. NEURO       — GCS + Ko'z qorachig'i
//   3. CT          — Gematoma, siljish, kontuziya
//   4. PROTOKOLLAR — CCHR, NICE, BTF (xavfni oshiradi, qaror bermaydi)
//
// MANBALAR:
//   BTF 2016/2023, CCHR Lancet 2001, NICE CG176 2023,
//   ACEP 2023, ACS TQIP 2023/2024, ENLS 6.0, EPIC Study 2021,
//   IMPACT model, WSES 2019/2020, RTS (Boyd 1987),
//   CRASH model, NINDS 2024, Helsinki CT Score 2022
// ════════════════════════════════════════════════════════════════════

import {
  ClinicalInput, AnalysisResult, TriggeredRule,
  Decision, Urgency, Severity, XaiEntry
} from './types';

// ── PROTOKOL VAZNLARI (ilmiy asoslangan) ─────────────────────────────────
// Bu vaznlar faqat TBI protokollari uchun — vital signs va qo'shimcha jarohatlar
// alohida ierarxik override tizimida ishlaydi (weighted sum emas)
const WEIGHTS = {
  cchr:    0.35,  // Lancet 2001 — sensitivlik 100%, spetsifiklik 76%
  gcs:     0.30,  // ACS TQIP, BTF 2016 — eng kuchli bashoratlovchi
  btf:     0.20,  // BTF 2016/2023 — jarrohlik ko'rsatmalari
  nice:    0.10,  // NICE CG176 2023 — qo'shimcha xavf omillari
  alcohol: 0.05,  // Sperry 2006 — GCS ishonchsizligi modifikatori
};

// ── RTS KODLASH (Boyd et al. 1987, ilmiy validatsiya qilingan) ───────────
function rtsCode_GCS(gcs: number): number {
  if (gcs >= 13) return 4;
  if (gcs >= 9)  return 3;
  if (gcs >= 6)  return 2;
  if (gcs >= 4)  return 1;
  return 0;
}
function rtsCode_SBP(sbp: number): number {
  if (sbp > 89) return 4;
  if (sbp > 75) return 3;
  if (sbp > 49) return 2;
  if (sbp > 0)  return 1;
  return 0;
}
function rtsCode_RR(rr: number): number {
  if (rr >= 10 && rr <= 29) return 4;
  if (rr > 29)              return 3;
  if (rr >= 6)              return 2;
  if (rr >= 1)              return 1;
  return 0;
}

// ── URGENCY SOLISHTIRISH (worst wins uchun) ──────────────────────────────
const URGENCY_RANK: Record<string, number> = {
  'not_required': 0, 'monitor': 1, 'urgent': 2, 'emergency': 3
};
// confidence: 'high' = BTF/VITAL dan — directan o'lchanadigan klinik topilma
//             'medium' = CCHR/NICE dan — xavf omili, topilma emas
// Faqat 'high' confidence trigger 'emergency' ga override qila oladi
function worstSurgical(
  a: AnalysisResult['surgicalUrgency'],
  b: AnalysisResult['surgicalUrgency'],
  triggerConfidence: 'high' | 'medium' = 'high'
): AnalysisResult['surgicalUrgency'] {
  // Medium confidence trigger faqat 'urgent' gacha chiqishi mumkin, 'emergency' ga emas
  if (triggerConfidence === 'medium' && b === 'emergency') {
    b = 'urgent';
  }
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

// ════════════════════════════════════════════════════════════════════
// ASOSIY FUNKSIYA
// ════════════════════════════════════════════════════════════════════
export function analyze(
  input: ClinicalInput & { otherMechanismLabel?: string }
): AnalysisResult {

  const gcsTotal     = input.gcs.eye + input.gcs.verbal + input.gcs.motor;
  const comorbidities = input.comorbidities ?? [];
  // ── CT HOLATI (multi-select logikasi) ──────────────────────────────────
  const ctFindings   = input.ctFindings ?? [];
  const hasHematoma  = ctFindings.includes('hematoma');
  const hasContusion = ctFindings.includes('contusion');
  const hasFracture  = ctFindings.includes('fracture');
  const ctDone       = (input.ctStatus === 'normal') || ctFindings.length > 0;
  const ctNormal     = input.ctStatus === 'normal' && ctFindings.length === 0;

  // Vital signs mavjudligi
  const hasSBP  = input.sbp  !== undefined && input.sbp  > 0;
  const hasRR   = input.respiratoryRate !== undefined && input.respiratoryRate > 0;
  const hasSpO2 = input.spO2 !== undefined;
  const sbp     = input.sbp  ?? 0;
  const spO2    = input.spO2 ?? 100;
  const rr      = input.respiratoryRate ?? 0;

  // Qo'shimcha jarohat sohalari
  const polytravmaZones: string[] = [];
  if (input.complaints?.chestPain)     polytravmaZones.push("Ko'krak");
  if (input.complaints?.abdominalPain) polytravmaZones.push("Qorin");
  if (input.complaints?.limbPain)      polytravmaZones.push("Qo'l/oyoq");
  if (input.complaints?.backPain)      polytravmaZones.push("Bel/umurtqa");
  const hasPolytrauma = polytravmaZones.length > 0;

  // TBI og'irlik darajasi
  let severity: Severity;
  if      (gcsTotal >= 13) severity = 'mild';
  else if (gcsTotal >= 9)  severity = 'moderate';
  else if (gcsTotal >= 6)  severity = 'severe';
  else                     severity = 'critical';

  // XAI yozuvlari
  const xaiEntries: XaiEntry[] = [];

  // ════════════════════════════════════════════════════════════════════
  // QATLAM 1: FIZIOLOGIYA (SBP / SpO2 / RR)
  // Eng yuqori prioritet — hamma narsani override qiladi
  // Manba: IMPACT model, BTF 2016/2023, EPIC Study 2021, ACS TBI 2024
  // ════════════════════════════════════════════════════════════════════
  const vitalRules: TriggeredRule[] = [];
  let   vitalScore   = 0;
  let   vitalOverride: 'emergency' | 'urgent' | null = null;
  let   surgicalUrgency: AnalysisResult['surgicalUrgency'] = 'not_required';

  // K_V1: Gipoksiya + Gipotenziya birgalikda — ENG YOMON KOMBINATSIYA
  // EPIC Study 2021: adjusted OR 6.1 (individual effektlar yig'indisidan ko'p)
  if (hasSBP && sbp < 90 && hasSpO2 && spO2 < 90) {
    vitalScore    = 100;
    vitalOverride = 'emergency';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'emergency');
    vitalRules.push({
      id: 'VIT-COMB', name: 'Gipoksiya + Gipotenziya',
      protocol: 'VITAL', riskLevel: 'high',
      description: `SpO2 ${spO2}% + SBP ${sbp} mmHg — SINERGISTIK ikkilamchi TBI jarohati (EPIC Study 2021, OR 6.1, 14x o'lim xavfi)`,
      weight: 1.0
    });
    xaiEntries.push({
      fact:   `SpO2 = ${spO2}%, SBP = ${sbp} mmHg`,
      effect: 'Gipoksiya + gipotenziya birgalikda — miya qon ta\'minoti ikki tomondan buziladi',
      impact: `O'lim xavfi ~14 baravar oshadi (adjusted OR 6.1, EPIC Study 2021)`,
      source: 'EPIC Study 2021, BTF 2016, WSES 2019'
    });
  } else {
    // K_V2: Kritik gipotenziya (SBP < 90) — BTF 2016 klassik chegara
    // OR o'lim: prehospital 1.8, hospital 2.61, ikkalasi 4.36
    if (hasSBP && sbp < 90) {
      vitalScore    = Math.max(vitalScore, 90);
      vitalOverride = vitalOverride ?? 'urgent';
      surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
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
    }
    // K_V3: Gipotenziya xavf zonasi (SBP 90–110) — ACS TBI 2024 yangilanishi
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
        impact: 'Secondary brain injury ehtimoli oshadi. Maqsad SBP >= 110 mmHg (ACS TBI 2024). Monitoring tavsiya etiladi',
        source: 'ACS TBI 2024, BTF 2023, IMPACT model'
      });
    }

    // K_V4: Kritik gipoksiya (SpO2 < 90%) — EPIC Study 2021
    // Bitta desaturatsiya epizodi: OR o'lim 3.86
    if (hasSpO2 && spO2 < 90) {
      vitalScore    = Math.max(vitalScore, 90);
      vitalOverride = vitalOverride ?? 'urgent';
      surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
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
  }

  // K_V6: Ko'krak og'rig'i + SpO2 < 94% → airway priority (WSES 2019)
  if (input.complaints?.chestPain && hasSpO2 && spO2 < 94) {
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
  if (input.complaints?.abdominalPain && hasSBP && sbp < 90) {
    vitalScore = Math.max(vitalScore, 85);
    vitalOverride = vitalOverride ?? 'urgent';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    vitalRules.push({
      id: 'VIT-ABD', name: 'Qorin + gipotenziya',
      protocol: 'WSES', riskLevel: 'high',
      description: `Qorin og'rig'i + SBP ${sbp} mmHg < 90 — qorin ichki qon ketishi + TBI. Ikkala jarroh darhol chaqirilsin (WSES 2020)`,
      weight: 0.85
    });
    xaiEntries.push({
      fact:   `Qorin og'rig'i + SBP = ${sbp} mmHg`,
      effect: 'Qorin jarohati (jigar/taloq?) → gipotenziya → TBI ikkilamchi zararlanishi',
      impact: 'FAST tekshiruvi tavsiya etiladi. Umumiy jarroh + neyrojarroh birgalikda maslahat tavsiya etiladi',
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
      // RTS < 5 → klinik og'ir holat, urgency oshiriladi
      vitalScore = Math.max(vitalScore, 70);
      vitalOverride = vitalOverride ?? 'urgent';
      surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
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
        impact: "Yaqin monitoring tavsiya etiladi. Yomonlashish belgisi sifatida kuzating.",
        source: 'RTS Boyd 1987, TRISS'
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // QATLAM 2: NEURO (GCS + Ko'z qorachig'i)
  // ════════════════════════════════════════════════════════════════════
  const gcsRules: TriggeredRule[] = [];
  let   gcsScore = 0;

  if      (gcsTotal <= 5)  {
    gcsScore = 100;
    gcsRules.push({ id: 'GCS-1', name: 'Kritik TBI',  protocol: 'GCS', riskLevel: 'high',
      description: `GCS ${gcsTotal} — kritik holat (3–5)`, weight: 1.0 });
  } else if (gcsTotal <= 8)  {
    gcsScore = 85;
    gcsRules.push({ id: 'GCS-2', name: "Og'ir TBI",  protocol: 'GCS', riskLevel: 'high',
      description: `GCS ${gcsTotal} — og'ir TBI (6–8)`, weight: 0.85 });
  } else if (gcsTotal <= 12) {
    gcsScore = 60;  // 50 → 60: NICE CG176 GCS<13 = darhol CT, bu "medium" emas
    gcsRules.push({ id: 'GCS-3', name: "O'rta TBI",  protocol: 'GCS', riskLevel: 'medium',
      description: `GCS ${gcsTotal} — o'rta og'irlikdagi TBI (9–12). NICE CG176: <13 = darhol CT ko'rsatmasi`, weight: 0.60 });
  } else if (gcsTotal <= 14) {
    gcsScore = 20;
    gcsRules.push({ id: 'GCS-4', name: 'Yengil TBI', protocol: 'GCS', riskLevel: 'medium',
      description: `GCS ${gcsTotal} — yengil TBI (13–14)`, weight: 0.20 });
  }

  // ════════════════════════════════════════════════════════════════════
  // QATLAM 3: KT (BTF protokoli — gematoma, siljish)
  // ════════════════════════════════════════════════════════════════════
  const btfRules: TriggeredRule[] = [];
  let   btfScore = 0;
  let   hematomaSurgery: AnalysisResult['hematomaSurgery'] = null;

  if (hasHematoma && input.hematomaVolume !== undefined) {
    const vol       = input.hematomaVolume;
    const shift     = input.midlineShift ?? 0;
    const thickness = input.hematomaThickness ?? 0;
    const type      = input.hematomaType;
    const epiduralBigThick = type === 'epidural' && thickness >= 15;

    if (vol < 10 && !epiduralBigThick) {
      btfScore = 35; hematomaSurgery = 'observe';
      surgicalUrgency = worstSurgical(surgicalUrgency, 'monitor');
      btfRules.push({ id: 'BTF-H1', name: 'BTF < 10ml', protocol: 'BTF', riskLevel: 'medium',
        description: `Gematoma ${vol}ml — konservativ, dinamik kuzatish tavsiya etiladi`, weight: 0.35 });
    } else if (vol >= 10 && vol < 30 && shift <= 5 && !epiduralBigThick) {
      if (type === 'subdural' && gcsTotal <= 8) {
        // K13: Subdural + GCS <= 8 → jarrohlik (BTF 2016)
        btfScore = 80; hematomaSurgery = 'surgery_required';
        surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
        btfRules.push({ id: 'BTF-H2b', name: 'Subdural + GCS<=8', protocol: 'BTF', riskLevel: 'high',
          description: `Subdural gematoma ${vol}ml + GCS ${gcsTotal} <= 8 — jarrohlik ko'rsatmasi (BTF 2016)`, weight: 0.80 });
      } else {
        btfScore = 50; hematomaSurgery = 'repeat_ct';
        surgicalUrgency = worstSurgical(surgicalUrgency, 'monitor');
        btfRules.push({ id: 'BTF-H2', name: 'BTF 10–30ml', protocol: 'BTF', riskLevel: 'medium',
          description: `Gematoma ${vol}ml — 6–12 soatdan keyin KT takrorlash`, weight: 0.50 });
      }
    } else if (vol >= 30 || epiduralBigThick || (type === 'subdural' && shift > 5)) {
      hematomaSurgery = 'surgery_required';
      if (gcsTotal >= 9) {
        btfScore = 75; surgicalUrgency = worstSurgical(surgicalUrgency, 'monitor');
        btfRules.push({ id: 'BTF-H3', name: 'BTF Jarrohlik', protocol: 'BTF', riskLevel: 'high',
          description: `Gematoma ${vol}ml — neyrojarroh maslahat zarur`, weight: 0.75 });
      } else {
        btfScore = 90; surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
        btfRules.push({ id: 'BTF-H3b', name: 'BTF Jarrohlik+GCS', protocol: 'BTF', riskLevel: 'high',
          description: `Gematoma ${vol}ml + GCS ${gcsTotal} — jarrohlik ko'rsatiladi (BTF 2016)`, weight: 0.90 });
      }
    }

    // K2 / K3: Gematoma >=30ml + GCS <=12 YOKI siljish >5mm + GCS <=12 → FAVQULODDA
    if ((vol >= 30 || shift > 5) && gcsTotal <= 12) {
      btfScore = 100;
      surgicalUrgency = worstSurgical(surgicalUrgency, 'emergency');
      hematomaSurgery = 'surgery_required';
      btfRules.push({ id: 'BTF-EM', name: 'BTF FAVQULODDA', protocol: 'BTF', riskLevel: 'high',
        description: `Gematoma >=30ml / siljish >5mm + GCS <=12 — FAVQULODDA neyrojarrohlik (BTF 2016)`, weight: 1.0 });
    }
  }

  // ── KONTUZIYA (BTF 2016) ──────────────────────────────────────────────
  if (hasContusion) {
    btfScore = Math.max(btfScore, 50);
    hematomaSurgery = hematomaSurgery ?? 'repeat_ct';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'monitor');
    btfRules.push({
      id: 'BTF-CONT', name: 'Miya kontuziyasi', protocol: 'BTF', riskLevel: 'medium',
      description: "Miya kontuziyasi — 6–12 soatdan keyin KT takrorlansin (BTF 2016)",
      weight: 0.50
    });
    xaiEntries.push({
      fact:   "KT natijasi: Miya kontuziyasi",
      effect: "Birlamchi miya to'qimasi zararlangan — ikkilamchi shish va qon ketish xavfi mavjud",
      impact: "6–12 soatdan keyin KT takrorlash tavsiya etiladi; o'lcham oshishi yoki klinik yomonlashish bo'lsa neyrojarroh maslahat tavsiya etiladi",
      source: "BTF 2016, ACS TQIP 2023"
    });
    // Kombinatsiya: Kontuziya + GCS <= 8 → jarrohlik baholash tavsiya etiladi
    if (gcsTotal <= 8) {
      btfScore = Math.max(btfScore, 85);
      hematomaSurgery = 'surgery_required';
      surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
      btfRules.push({
        id: 'BTF-CONT-GCS', name: 'Kontuziya + GCS ≤ 8', protocol: 'BTF', riskLevel: 'high',
        description: `Miya kontuziyasi + GCS ${gcsTotal} ≤ 8 — neyrojarroh maslahat zarur (BTF 2016)`,
        weight: 0.85
      });
    }
    // Kombinatsiya: Kontuziya + antikoagulyant → kechikkan qon ketish xavfi
    if (input.anticoagulant) {
      btfScore = Math.max(btfScore, 70);
      surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
      btfRules.push({
        id: 'BTF-CONT-AC', name: 'Kontuziya + Antikoagulyant', protocol: 'BTF', riskLevel: 'high',
        description: "Miya kontuziyasi + antikoagulyant — kechikkan qon ketish ehtimoli yuqori, reversal terapiya baholansin (BTF 2016)",
        weight: 0.70
      });
    }
  }

  // ── SUYAK SINISHI (BTF 2016) ──────────────────────────────────────────
  if (hasFracture) {
    btfScore = Math.max(btfScore, 40);
    surgicalUrgency = worstSurgical(surgicalUrgency, 'monitor');
    btfRules.push({
      id: 'BTF-FRAC', name: 'Bosh suyagi sinishi', protocol: 'BTF', riskLevel: 'medium',
      description: "Bosh suyagi sinishi KT da — neyrojarroh konsultatsiyasi zarur (BTF 2016)",
      weight: 0.40
    });
    xaiEntries.push({
      fact:   "KT natijasi: Bosh suyagi sinishi",
      effect: "Mexanik buzilish — ostidagi miya to'qimasi va qon tomirlari zararlangan bo'lishi mumkin",
      impact: "Neyrojarroh maslahat tavsiya etiladi; asos suyagi sinishi belgilari bo'lsa — tezkor baholash tavsiya etiladi",
      source: "BTF 2016, CCHR Lancet 2001"
    });
    // Kombinatsiya: Suyak sinishi + asos suyagi belgilari (basalSkullFracture)
    if (input.cchrAdditional.basalSkullFracture) {
      btfScore = Math.max(btfScore, 65);
      surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
      btfRules.push({
        id: 'BTF-FRAC-BASE', name: 'Asos suyagi sinishi', protocol: 'BTF', riskLevel: 'high',
        description: "Asos suyagi sinishi (Battle belgisi / Raccoon eyes / CSF oqishi) — neyrojarroh maslahat zarur (BTF 2016)",
        weight: 0.65
      });
    }
  }

  // ── MULTI-SELECT KOMBINATSIYALAR (neyroxirurg tavsiyasi) ────────────────
  // Bir vaqtda bir nechta KT topilma → yanada og'ir klinik holat

  // Gematoma + Kontuziya → ikkilamchi zararlanish xavfi, KRITIK baholash
  if (hasHematoma && hasContusion) {
    btfScore = Math.max(btfScore, 85);
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    hematomaSurgery = 'surgery_required';
    btfRules.push({
      id: 'BTF-MC-HC', name: 'Gematoma + Kontuziya', protocol: 'BTF', riskLevel: 'high',
      description: "Gematoma + Miya kontuziyasi — ikkilamchi zararlanish ehtimoli yuqori, neyrojarroh maslahat zarur (BTF 2016)",
      weight: 0.85
    });
    xaiEntries.push({
      fact:   "KT: Gematoma VA Kontuziya birgalikda",
      effect: "Qon yig'ilishi + to'qima zarari → shish va ICP oshishi xavfi kuchayadi",
      impact: "Neyrojarroh maslahat tavsiya etiladi; dinamik KT monitoring tavsiya etiladi",
      source: "BTF 2016, ACS TQIP 2023"
    });
  }

  // Gematoma + Suyak sinishi → epidural gematoma ehtimoli yuqori
  if (hasHematoma && hasFracture) {
    btfScore = Math.max(btfScore, 80);
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    hematomaSurgery = 'surgery_required';
    btfRules.push({
      id: 'BTF-MC-HF', name: 'Gematoma + Suyak sinishi', protocol: 'BTF', riskLevel: 'high',
      description: "Gematoma + Suyak sinishi — epidural gematoma ehtimoli yuqori, BTF bo'yicha jarrohlik baholash (BTF 2016)",
      weight: 0.80
    });
  }

  // Kontuziya + Suyak sinishi → mexanik + to'qima jarohat
  if (hasContusion && hasFracture) {
    btfScore = Math.max(btfScore, 65);
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    btfRules.push({
      id: 'BTF-MC-CF', name: 'Kontuziya + Suyak sinishi', protocol: 'BTF', riskLevel: 'high',
      description: "Miya kontuziyasi + Suyak sinishi — kombinatsiyalangan jarohat, neyrojarroh maslahat zarur (BTF 2016)",
      weight: 0.65
    });
  }

  // Gematoma + Kontuziya + Suyak sinishi → og'ir kombinatsiyali TBI, FAVQULODDA
  if (hasHematoma && hasContusion && hasFracture) {
    btfScore = 100;
    surgicalUrgency = worstSurgical(surgicalUrgency, 'emergency');
    hematomaSurgery = 'surgery_required';
    btfRules.push({
      id: 'BTF-MC-ALL', name: 'Uch topilma — FAVQULODDA', protocol: 'BTF', riskLevel: 'high',
      description: "Gematoma + Kontuziya + Suyak sinishi — og'ir TBI, FAVQULODDA neyrojarrohlik (BTF 2016)",
      weight: 1.0
    });
    xaiEntries.push({
      fact:   "KT: Gematoma + Kontuziya + Suyak sinishi — uchala topilma birgalikda",
      effect: "Eng og'ir TBI kombinatsiyasi — qon ketish, to'qima zarari va mexanik buzilish",
      impact: "Neyrojarrohlik baholash tavsiya etiladi; hayot uchun xavfli holat ehtimoli yuqori",
      source: "BTF 2016, ENLS 6.0, ACS TQIP 2023"
    });
  }

  // ── QOLGAN MISSING KOMBINATSIYALAR (hujjat 40 kombinatsiya) ─────────

  // K_POL_GCS: Qo'shimcha jarohatlar + GCS ≤ 8 — cABCDE va neyro parallel
  if (hasPolytrauma && gcsTotal <= 8) {
    btfScore = Math.max(btfScore, 80);
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    btfRules.push({
      id: 'BTF-POL-GCS', name: "Qo'shimcha jarohat + GCS≤8", protocol: 'BTF', riskLevel: 'high',
      description: `Qo'shimcha jarohatlar + GCS ${gcsTotal} ≤ 8 — cABCDE parallel va neyrojarroh maslahat zarur (WSES 2019, BTF 2016)`,
      weight: 0.80
    });
  }

  // K_ALK_HEM: Alkogol + gematoma — alkogol GCS ni yashiradi
  if (input.alcoholIntoxication && hasHematoma) {
    btfScore = Math.max(btfScore, 75);
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    btfRules.push({
      id: 'BTF-ALK-HEM', name: "Alkogol + Gematoma", protocol: 'BTF', riskLevel: 'high',
      description: "Alkogol intoksikatsiyasi + gematoma — GCS ishonchsiz bo'lishi mumkin, haqiqiy holat og'irroq ehtimoli. Neyrojarroh maslahat zarur",
      weight: 0.75
    });
  }

  // K_EPI_SEI: Epilepsiya tarixi + jarohatdan keyin tutqanoq
  if (comorbidities.includes('epilepsy') && input.complaints.seizure) {
    btfScore = Math.max(btfScore, 60);
    btfRules.push({
      id: 'BTF-EPI-SEI', name: "Epilepsiya + Tutqanoq", protocol: 'BTF', riskLevel: 'high',
      description: "Epilepsiya tarixi + jarohatdan keyin tutqanoq — profilaktik antiepileptik va KT zarur (BTF 2016)",
      weight: 0.60
    });
  }

  // K_AGE_HEM: Yosh ≥65 + gematoma (hajmidan qat'iy nazar)
  if (input.age >= 65 && hasHematoma) {
    btfScore = Math.max(btfScore, 70);
    surgicalUrgency = worstSurgical(surgicalUrgency, 'monitor');
    btfRules.push({
      id: 'BTF-AGE-HEM', name: "65+ yosh + Gematoma", protocol: 'BTF', riskLevel: 'high',
      description: "Yosh ≥65 + gematoma — keksa yoshda klinik yomonlashish tez bo'lishi mumkin, neyrojarroh maslahat zarur (BTF 2016)",
      weight: 0.70
    });
  }


  // CN IV / VI — ko'z harakat buzilishi → ICP oshishi (K24)
  if (input.cranialNerves?.cn4 === 'P' || input.cranialNerves?.cn6 === 'P') {
    btfScore = Math.max(btfScore, 70);
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    btfRules.push({ id: 'BTF-CN46', name: 'CN IV/VI Patologik', protocol: 'BTF', riskLevel: 'high',
      description: "CN IV/VI falaji — ICP oshishi / beyin o'qi jarohati, shoshilinch CT (BTF 2016)", weight: 0.70 });
  }

  // ════════════════════════════════════════════════════════════════════
  // QATLAM 4: PROTOKOLLAR (CCHR, NICE, Alkogol)
  // Bu qatlam qaror bermaydi — faqat xavfni oshiradi
  // ════════════════════════════════════════════════════════════════════

  // ── CCHR ─────────────────────────────────────────────────────────────
  const cchrRules: TriggeredRule[] = [];
  let   cchrScore = 0;

  if (input.cchrAdditional.gcsLessThan15at2hrs)  { cchrScore += 35; cchrRules.push({ id: 'CCHR-H1', name: 'CCHR Yuqori #1', protocol: 'CCHR', riskLevel: 'high',   description: "Jarohatdan 2 soat o'tgach GCS < 15", weight: 0.35 }); }
  if (input.cchrAdditional.suspectedOpenFracture) { cchrScore += 35; cchrRules.push({ id: 'CCHR-H2', name: 'CCHR Yuqori #2', protocol: 'CCHR', riskLevel: 'high',   description: "Ochiq yoki botiq bosh suyagi sinishi gumonlandi", weight: 0.35 }); }
  if (input.cchrAdditional.basalSkullFracture)    { cchrScore += 35; cchrRules.push({ id: 'CCHR-H3', name: 'CCHR Yuqori #3', protocol: 'CCHR', riskLevel: 'high',   description: "Asos suyagi sinishi (Battle, Raccoon eyes, CSF oqishi)", weight: 0.35 }); }
  if (input.complaints.vomiting === 'repeated')   { cchrScore += 30; cchrRules.push({ id: 'CCHR-H4', name: 'CCHR Yuqori #4', protocol: 'CCHR', riskLevel: 'high',   description: "Qayta-qayta qusish (2 martadan ortiq)", weight: 0.30 }); }
  if (input.age >= 65)                            { cchrScore += 30; cchrRules.push({ id: 'CCHR-H5', name: 'CCHR Yuqori #5', protocol: 'CCHR', riskLevel: 'high',   description: "Bemor yoshi 65 va undan katta — CCHR yuqori xavf", weight: 0.30 }); }
  if (input.complaints.seizure)                   { cchrScore += 25; cchrRules.push({ id: 'CCHR-M1', name: "CCHR O'rta #1", protocol: 'CCHR', riskLevel: 'medium', description: "Jarohatdan keyin tutqanoq", weight: 0.25 }); }
  if (input.anticoagulant)                        { cchrScore += 20; cchrRules.push({ id: 'CCHR-M2', name: "CCHR O'rta #2", protocol: 'CCHR', riskLevel: 'medium', description: "Bemor antikoagulyant terapiyasida", weight: 0.20 }); }
  if (input.traumaMechanism === 'fall_height' || input.traumaMechanism === 'road_accident') {
    cchrScore += 15;
    cchrRules.push({ id: 'CCHR-M3', name: "CCHR O'rta #3", protocol: 'CCHR', riskLevel: 'medium', description: "Xavfli travma mexanizmi (balandlikdan / YTH)", weight: 0.15 });
  }
  if (input.complaints.nystagmus) {
    cchrScore += 20;
    cchrRules.push({ id: 'CCHR-M4', name: 'Nistagm', protocol: 'CCHR', riskLevel: 'medium', description: "Nistagm — temporal suyak / vestibulyar jarohat, CT ko'rsatmasi", weight: 0.20 });
  }
  if (input.cranialNerves?.cn7 === 'P') {
    cchrScore += 35;
    cchrRules.push({ id: 'CCHR-CN7', name: 'CN VII (Yuz falaji)', protocol: 'CCHR', riskLevel: 'high', description: "CN VII falaji — asos suyagi sinishi belgisi (CCHR H3 aktivatsiyasi)", weight: 0.35 });
  }
  if (input.cranialNerves?.cn8 === 'P') {
    cchrScore += 20;
    cchrRules.push({ id: 'CCHR-CN8', name: 'CN VIII Patologik', protocol: 'CCHR', riskLevel: 'medium', description: "CN VIII — eshitish/muvozanat buzilishi, temporal suyak sinishi ehtimoli", weight: 0.20 });
  }
  cchrScore = Math.min(100, cchrScore);

  // ── NICE ─────────────────────────────────────────────────────────────
  const niceRules: TriggeredRule[] = [];
  let   niceScore = 0;

  if (input.age >= 65) {
    niceScore += 25;
    niceRules.push({
      id: 'NICE-AGE', name: 'Yosh 65+', protocol: 'NICE', riskLevel: 'high',
      description: "Bemor yoshi 65 va undan katta — NICE CG176: KT zarur",
      weight: 0.25
    });
  }
  if (input.anticoagulant) {
    niceScore += 25;
    niceRules.push({ id: 'NICE-1', name: 'NICE Antikoagulyant', protocol: 'NICE', riskLevel: 'high', description: "Antikoagulyant terapiya — qon ketish xavfi yuqori (EFNS, Cohen 2006)", weight: 0.25 });
  }
  if (input.meningealSigns.kernig || input.meningealSigns.brudzinski || input.meningealSigns.neckStiffness) {
    niceScore += 30;
    niceRules.push({ id: 'NICE-2', name: 'NICE Meningeal', protocol: 'NICE', riskLevel: 'high',
      // LP faqat CT normal bo'lsa ko'rsatiladi — bu note overrideReasons da chiqadi
      description: "Meningeal belgilar — avval KT zarur (ICP istisno qilish), keyin LP ko'rib chiqilsin (NICE CG176)",
      weight: 0.30 });
  }
  if (input.sex === 'female' && input.pregnancy) {
    niceScore += 20;
    niceRules.push({ id: 'NICE-P1', name: 'NICE Homiladorlik', protocol: 'NICE', riskLevel: 'high', description: "Homilador bemor: KT bajarilsa qorin himoyasi tavsiya etiladi; MRI afzal (NICE CG176)", weight: 0.20 });
  }
  if (input.complaints.vomiting === 'once') {
    niceScore += 10;
    niceRules.push({ id: 'NICE-3', name: 'NICE Qusish', protocol: 'NICE', riskLevel: 'medium', description: "Bir marta qusish — NICE bo'yicha xavf omili", weight: 0.10 });
  }
  if (comorbidities.includes('coagulopathy'))      { niceScore += 25; niceRules.push({ id: 'NICE-C1', name: 'Koagulopatiya',          protocol: 'NICE', riskLevel: 'high',   description: "Koagulopatiya / jigar sirrozi — INR oshishi, qon ketish xavfi (ACS TQIP 2023)", weight: 0.25 }); }
  if (comorbidities.includes('epilepsy'))          { niceScore += 15; niceRules.push({ id: 'NICE-C2', name: 'Epilepsiya tarixi',      protocol: 'NICE', riskLevel: 'medium', description: "Epilepsiya tarixi — tutqanoq xavfi yuqori, profilaktika ko'rib chiqilsin (BTF 2016)", weight: 0.15 }); }
  if (comorbidities.includes('stroke'))            { niceScore += 20; niceRules.push({ id: 'NICE-C3', name: "Insult / TIA tarixi",    protocol: 'NICE', riskLevel: 'high',   description: "Insult / TIA tarixi — antikoagulyant bo'lishi mumkin, GCS bazali past (PMC 2019)", weight: 0.20 }); }
  if (comorbidities.includes('dementia'))          { niceScore += 15; niceRules.push({ id: 'NICE-C4', name: 'Demensiya',              protocol: 'NICE', riskLevel: 'medium', description: "Demensiya — GCS bazal darajasi noaniq (PMC 2021)", weight: 0.15 }); }
  if (comorbidities.includes('heart_failure'))     { niceScore += 10; niceRules.push({ id: 'NICE-C5', name: 'Yurak yetishmovchiligi', protocol: 'NICE', riskLevel: 'medium', description: "Yurak yetishmovchiligi — gipotenziya xavfi, serebral perfuziya pasayishi", weight: 0.10 }); }
  if (comorbidities.includes('copd'))              { niceScore += 10; niceRules.push({ id: 'NICE-C6', name: "Surunkali o'pka",        protocol: 'NICE', riskLevel: 'medium', description: "COPD — SpO2 bazali past, gipoksiya xavfi (EPIC Study 2021)", weight: 0.10 }); }
  niceScore = Math.min(100, niceScore);

  // ── ALKOGOL ───────────────────────────────────────────────────────────
  const alcoholRules: TriggeredRule[] = [];
  let   alcoholScore = 0;
  if (input.alcoholIntoxication) {
    alcoholScore = 70;
    alcoholRules.push({ id: 'ALC-1', name: 'Alkogol intoksikatsiyasi', protocol: 'CCHR', riskLevel: 'medium',
      description: "Alkogol: GCS ishonchsiz bo'lishi mumkin → CT tavsiya etiladi; hushyor bo'lganda GCS qayta baholansin (Sperry 2006)", weight: 0.70 });
  }

  // ════════════════════════════════════════════════════════════════════
  // HIERARCHICAL OVERRIDE QOIDALARI
  // WORST WINS: eng yomon parametr yakuniy qarorni belgilaydi
  // ════════════════════════════════════════════════════════════════════
  type HierarchyLevel = 'emergency' | 'urgent' | 'ct_mandatory' | 'monitor' | null;
  let hierarchyOverride: HierarchyLevel = null;
  const overrideReasons: string[] = [];

  // ── DARAJA 1: MUTLAQ FAVQULODDA ──────────────────────────────────────

  // K1: Anizokoria — transtentorial herniatsiya (BTF 2016, EMCrit)
  if (input.anisocoria !== 'none') {
    hierarchyOverride = 'emergency';
    btfScore = 100;
    surgicalUrgency = worstSurgical(surgicalUrgency, 'emergency');
    btfRules.push({ id: 'BTF-N1', name: 'Anizokoria — FAVQULODDA', protocol: 'BTF', riskLevel: 'high',
      description: "Ko'z qorachig'i asimmetriyasi — transtentorial herniatsiya ehtimoli. Neyrojarroh DARHOL chaqirilsin, shoshilinch KT bajarilsin (BTF 2016)", weight: 1.0 });
    overrideReasons.push("Anizokoria — transtentorial herniatsiya belgisi");
    xaiEntries.push({
      fact:   `Anizokoria: ${input.anisocoria} tomonda kengaygan qorachiq`,
      effect: "CN III siqilishi → transtentorial herniatsiya ehtimoli — miya o'qi pastga siljiydi",
      impact: 'Neyrojarrohlik baholash tavsiya etiladi. Shoshilinch KT (agar bajarilmagan bo\'lsa) — KT natijasiga qarab jarrohlik masalasi ko\'rib chiqiladi (BTF 2016)',
      source: 'BTF 2016, EMCrit, ENLS 6.0'
    });
  }

  // K25: CN III patologik (anizokoria yo'q bo'lsa)
  if (input.cranialNerves?.cn3 === 'P' && input.anisocoria === 'none') {
    hierarchyOverride = 'emergency';
    btfScore = 100;
    surgicalUrgency = worstSurgical(surgicalUrgency, 'emergency');
    btfRules.push({ id: 'BTF-CN3', name: 'CN III Patologik', protocol: 'BTF', riskLevel: 'high',
      description: "CN III falaji — herniatsiya ehtimoli. Neyrojarroh DARHOL chaqirilsin, shoshilinch KT bajarilsin (BTF 2016)", weight: 1.0 });
    overrideReasons.push("CN III falaji — herniatsiya belgisi");
  }

  // Vital signs emergency (fiziologiya qatlami natijasi)
  if (vitalOverride === 'emergency' && hierarchyOverride !== 'emergency') {
    hierarchyOverride = 'emergency';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'emergency');
  }

  // ── DARAJA 2: SHOSHILINCH ─────────────────────────────────────────────

  // Vital signs urgent
  if (vitalOverride === 'urgent' && hierarchyOverride === null) {
    hierarchyOverride = 'urgent';
  }

  // K_GCS13: GCS < 13 — NICE CG176 to'g'ridan-to'g'ri CT qaror beruvchi (decision maker)
  // NICE CG176 2023: GCS <13 = immediate CT. Bu protokol "support" emas, "decision" qatlami.
  if (gcsTotal < 13 && hierarchyOverride === null) {
    hierarchyOverride = 'urgent';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    overrideReasons.push(`GCS ${gcsTotal} < 13 — NICE CG176: darhol CT tavsiya etiladi`);
  }

  // K4: Antikoagulyant + har qanday TBI (Cohen 2006, EFNS)
  if (input.anticoagulant && hierarchyOverride === null) {
    hierarchyOverride = 'ct_mandatory';
    overrideReasons.push("Antikoagulyant + TBI → CT tavsiya etiladi (Cohen 2006)");
  }

  // K4b: Antikoagulyant + GCS < 15 → urgent (Cohen 2006 + EFNS)
  if (input.anticoagulant && gcsTotal < 15 && hierarchyOverride !== 'emergency' && hierarchyOverride !== 'urgent') {
    hierarchyOverride = 'urgent';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    overrideReasons.push(`Antikoagulyant + GCS ${gcsTotal} < 15 — shoshilinch CT tavsiya etiladi (Cohen 2006, EFNS)`);
  }

  // K17: GCS <= 8 (BTF 2016)
  if (gcsTotal <= 8 && (hierarchyOverride === null || hierarchyOverride === 'ct_mandatory')) {
    hierarchyOverride = 'urgent';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    overrideReasons.push(`GCS ${gcsTotal} <= 8 — og'ir TBI, darhol CT va neyrojarroh maslahat tavsiya etiladi`);
  }

  // K12: 65+ yosh + antikoagulyant (NICE 2023)
  if (input.age >= 65 && input.anticoagulant && hierarchyOverride === null) {
    hierarchyOverride = 'ct_mandatory';
    overrideReasons.push("65+ yosh + antikoagulyant → CT + 24 soat yotqizish (NICE 2023)");
  }

  // K26: Koagulopatiya + TBI (ACS TQIP 2023)
  if (comorbidities.includes('coagulopathy') && hierarchyOverride === null) {
    hierarchyOverride = 'ct_mandatory';
    overrideReasons.push("Koagulopatiya + TBI → CT tavsiya etiladi (ACS TQIP 2023)");
  }

  // K10: Meningeal belgilar + gematoma (BTF + NICE)
  if ((input.meningealSigns.kernig || input.meningealSigns.brudzinski || input.meningealSigns.neckStiffness)
      && hasHematoma && hierarchyOverride === null) {
    hierarchyOverride = 'urgent';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    overrideReasons.push("Meningeal belgilar + gematoma → neyrojarroh maslahat tavsiya etiladi (NICE 2023, BTF 2016)");
  }

  // K6: Alkogol + GCS <= 12 (Sperry 2006, NICE 2023)
  if (input.alcoholIntoxication && gcsTotal <= 12 && hierarchyOverride === null) {
    hierarchyOverride = 'ct_mandatory';
    overrideReasons.push(`Alkogol + GCS ${gcsTotal} <= 12 → CT tavsiya etiladi, GCS ishonchsiz bo'lishi mumkin (Sperry 2006)`);
  }

  // K18: Alkogol + GCS <= 8 (BTF + CCHR)
  if (input.alcoholIntoxication && gcsTotal <= 8 && hierarchyOverride !== 'emergency') {
    hierarchyOverride = 'urgent';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    overrideReasons.push(`Alkogol + GCS ${gcsTotal} <= 8 → shoshilinch CT, GCS ishonchsiz`);
  }

  // K36: Koagulopatiya + gematoma (ACS TQIP 2023)
  if (comorbidities.includes('coagulopathy') && hasHematoma && hierarchyOverride !== 'emergency') {
    hierarchyOverride = 'urgent';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    overrideReasons.push("Koagulopatiya + gematoma → reversal terapiya va neyrojarroh maslahat tavsiya etiladi (ACS TQIP 2023)");
  }

  // ── DARAJA 3: O'RTA XAVF ─────────────────────────────────────────────

  if (input.anticoagulant && ctNormal && hierarchyOverride === null) {
    overrideReasons.push("Antikoagulyant + CT normal → 24 soat yotqizish tavsiya etiladi (Cohen 2006)");
  }
  if (cchrScore >= 30 && ctNormal) {
    overrideReasons.push("CCHR yuqori xavf + CT normal → kuzatish tavsiya etiladi (NICE 2023)");
  }
  if ((input.meningealSigns.kernig || input.meningealSigns.brudzinski || input.meningealSigns.neckStiffness) && ctNormal) {
    overrideReasons.push("Meningeal belgilar + CT normal → LP ko'rib chiqilishi tavsiya etiladi (SAQ ehtimolini istisno qilish)");
  }
  if (input.sex === 'female' && input.pregnancy) {
    overrideReasons.push("Homilador bemor: CT bajarilsa qorin himoyasi + akusher koordinatsiya");
  }
  if (input.age >= 65 && gcsTotal >= 13) {
    overrideReasons.push("65+ yosh + GCS 13–15 → CCHR yuqori xavf, CT tavsiya etiladi");
  }
  if (comorbidities.includes('hypertension') || input.hypertensionHistory) {
    overrideReasons.push("Gipertenziya tarixi: MAP >= 90 mmHg maqsad (nisbiy gipotenziya xavfi)");
  }
  if (input.complaints.seizure && gcsTotal <= 12) {
    overrideReasons.push("Tutqanoq + GCS <= 12 → CT shoshilinch bajarilishi tavsiya etiladi (BTF 2016)");
  }
  if (gcsTotal <= 8 && ctNormal) {
    overrideReasons.push("GCS <= 8 + CT normal → Diffuz Aksonal Jarohat (DAJ) ehtimoli, MRI ko'rsatmasi");
  }

  // ════════════════════════════════════════════════════════════════════
  // WEIGHTED SCORE (faqat TBI protokollari)
  // Vital signs bu formulaga kirmaydi — ular override orqali ishlaydi
  // ════════════════════════════════════════════════════════════════════
  const rawScore =
    cchrScore    * WEIGHTS.cchr +
    gcsScore     * WEIGHTS.gcs  +
    btfScore     * WEIGHTS.btf  +
    niceScore    * WEIGHTS.nice +
    alcoholScore * WEIGHTS.alcohol;

  const cchrGcsCorr = (cchrScore > 50 && gcsScore > 50) ? 5 : 0;
  const btfGcsCorr  = (btfScore  > 70 && gcsScore > 70) ? 5 : 0;

  // Minimum score floor — klinik jihatdan muhim kombinatsiyalar uchun
  // GCS < 13 yoki antikoagulyant + har qanday xavf → kamida 45
  const gcs13Floor        = gcsTotal < 13 ? 45 : 0;
  // Antikoagulyant + GCS < 15 → kamida 40
  const anticoagGcsFloor  = (input.anticoagulant && gcsTotal < 15) ? 40 : 0;
  // Xavfli mexanizm + GCS < 13 → kamida 50
  const mechGcsFloor      = ((input.traumaMechanism === 'fall_height' || input.traumaMechanism === 'road_accident') && gcsTotal < 13) ? 50 : 0;
  // GCS < 13 + antikoagulyant + xavfli mexanizm → kamida 65 (BTF high risk combination)
  const tripleComboFloor  = (gcsTotal < 13 && input.anticoagulant && (input.traumaMechanism === 'fall_height' || input.traumaMechanism === 'road_accident')) ? 65 : 0;

  const minFloor = Math.max(gcs13Floor, anticoagGcsFloor, mechGcsFloor, tripleComboFloor);
  const score = Math.min(100, Math.max(minFloor, Math.round(rawScore + cchrGcsCorr + btfGcsCorr)));

  // ════════════════════════════════════════════════════════════════════
  // CONFIDENCE — penalty tizimi bilan (hujjat tavsiyasi)
  // ════════════════════════════════════════════════════════════════════
  const activeProtocols = [cchrScore, gcsScore, btfScore, niceScore, alcoholScore].filter(s => s > 0).length;
  const protocolScores  = [cchrScore, gcsScore, btfScore].filter(s => s > 0);
  const avgActive       = protocolScores.length > 0 ? protocolScores.reduce((a, b) => a + b, 0) / protocolScores.length : 0;
  const variance        = protocolScores.length > 1
    ? protocolScores.reduce((acc, s) => acc + Math.pow(s - avgActive, 2), 0) / protocolScores.length : 0;
  const agreementBonus  = Math.max(0, 1 - variance / 2500);
  const overrideBonus   = hierarchyOverride ? 0.05 : 0;

  // Penalty tizimi — ma'lumot yetishmasa confidence pasayadi
  const confidencePenalties: string[] = [];
  let   penaltyTotal = 0;
  if (!hasSBP) {
    penaltyTotal -= 0.08;
    confidencePenalties.push("SBP kiritilmagan (−8%)");
  }
  if (!hasSpO2) {
    penaltyTotal -= 0.07;
    confidencePenalties.push("SpO2 kiritilmagan (−7%)");
  }
  if (!ctDone) {
    penaltyTotal -= 0.10;
    confidencePenalties.push("KT bajarilmagan (−10%)");
  }

  const confidence = Math.round(
    Math.min(0.82, Math.max(0.35,
      0.35 + (activeProtocols / 5) * 0.25 +
      agreementBonus * 0.15 +
      (score / 100) * 0.08 +
      overrideBonus +
      penaltyTotal
    )) * 100
  ) / 100;

  // ════════════════════════════════════════════════════════════════════
  // YAKUNIY QAROR — WORST WINS
  // Eng yomon parametr g'alaba qiladi
  // ════════════════════════════════════════════════════════════════════
  let decision: Decision;

  // KT qilinmagan holda hematomaSurgery null bo'lishi kerak
  // Chunki KT natijasisiz jarrohlik ko'rsatmasini aniqlash mumkin emas
  if (!ctDone && hematomaSurgery !== null) {
    hematomaSurgery = null;
  }

  // Mutlaq favqulodda
  if (hierarchyOverride === 'emergency' || surgicalUrgency === 'emergency') {
    decision = 'SURGICAL_EVALUATION';
  } else if (ctDone) {
    if (surgicalUrgency === 'urgent') {
      decision = 'SURGICAL_EVALUATION';
    } else if (surgicalUrgency === 'monitor') {
      // Monitor = takroriy CT, neyrojarroh maslahat — SURGICAL_EVALUATION emas
      decision = 'CT_REQUIRED';
    } else if (hierarchyOverride === 'urgent' || hierarchyOverride === 'ct_mandatory') {
      decision = 'CT_REQUIRED';
    } else if (score >= 35) {
      decision = 'CT_REQUIRED';
    } else {
      decision = 'NO_CT_REQUIRED';
    }
  } else {
    if (hierarchyOverride === 'urgent' || surgicalUrgency === 'urgent') {
      decision = 'IMMEDIATE_CT';
    } else if (hierarchyOverride === 'ct_mandatory') {
      decision = 'CT_REQUIRED';
    } else if (score >= 75) {
      decision = 'IMMEDIATE_CT';
    } else if (score >= 45 || cchrScore >= 20 || alcoholScore > 0) {
      decision = 'CT_REQUIRED';
    } else if (score >= 20 || niceScore > 0) {
      decision = 'CT_RECOMMENDED';
    } else {
      decision = 'NO_CT_REQUIRED';
    }
  }

  // Urgency — worst wins to'liq amalga oshirilgan
  let urgency: Urgency;
  if      (hierarchyOverride === 'emergency' || surgicalUrgency === 'emergency') urgency = 'EMERGENCY';
  else if (hierarchyOverride === 'urgent'    || surgicalUrgency === 'urgent' || score >= 65) urgency = 'HIGH';
  else if (hierarchyOverride === 'ct_mandatory' || surgicalUrgency === 'monitor' || score >= 35) urgency = 'MODERATE';
  else urgency = 'LOW';

  // ════════════════════════════════════════════════════════════════════
  // DAVOLASH TAKTIKASI — "Consider..." formati (hujjat tavsiyasi)
  // Buyruq emas — tavsiya. Klinik qaror doim shifokorga tegishli.
  // ════════════════════════════════════════════════════════════════════
  let treatmentTactics: string[] = [];

  if (surgicalUrgency === 'emergency') {
    // FAVQULODDA — protokol bo'yicha aniq ko'rsatma, "tavsiya" yo'q
    treatmentTactics = [
      "Neyrojarroh DARHOL chaqirilsin",
      "Shoshilinch KT bajarilsin (agar bajarilmagan) — natijaga qarab jarrohlik hal qilinadi",
      "ICP oshishi bo'lsa — IV mannitol yuborilsin (1 g/kg, BTF 2016)",
      "Bosh 30 daraja ko'tarilgan holda ushlab turilsin",
      "GCS har 15 daqiqada baholansin",
      "MAP 80 mmHg va undan yuqori ushlab turilsin",
      "Bemor NPO (bo'sh qorin) holatida saqlash zarur",
    ];
  } else if (surgicalUrgency === 'urgent') {
    // SHOSHILINCH — aniq ko'rsatma
    treatmentTactics = [
      "Neyrojarroh bilan shoshilinch maslahat o'tkazilsin",
      "Neyrojarrohlik bo'limiga yotqizish zarur",
      "6–12 soatdan keyin KT takrorlansin",
      "Har soatda nevrologik monitoring o'tkazilsin",
      "Bemor NPO holatida saqlash zarur",
    ];
  } else if (surgicalUrgency === 'monitor') {
    // MONITOR — neyrojarroh maslahat kerak, lekin darhol emas
    treatmentTactics = [
      "Neyrojarroh bilan maslahat o'tkazilsin",
      "6–12 soatdan keyin KT takrorlansin",
      "Neyrojarrohlik bo'limiga yotqizish ko'rib chiqilsin",
      "Har soatda nevrologik monitoring o'tkazilsin",
    ];
  } else if (decision === 'IMMEDIATE_CT') {
    // DARHOL KT — kechiktirish mumkin emas
    treatmentTactics = [
      "KT darhol bajarilsin — kechiktirish mumkin emas",
      "Venoz kirish yo'li ta'minlansin",
      "GCS har 15 daqiqada baholansin",
      "KT natijasi kelgunicha bemor kuzatilsin",
    ];
  } else if (decision === 'CT_REQUIRED') {
    // KT ZARUR
    treatmentTactics = [
      "KT bajarilsin",
      "Venoz kirish yo'li ta'minlansin",
      "GCS har 30 daqiqada baholansin",
      "Nevrologik o'zgarishlar kuzatilsin",
    ];
  } else if (decision === 'CT_RECOMMENDED') {
    // PAST XAVF — tavsiya etiladi tili to'g'ri
    treatmentTactics = [
      "KT bajarishni ko'rib chiqish tavsiya etiladi",
      "Kuzatish uchun yotqizish ko'rib chiqilsin",
      "Muntazam nevrologik tekshiruvlar o'tkazilsin",
    ];
  } else {
    treatmentTactics = [
      "Kuzatish uchun yotqizish ko'rib chiqilsin",
      "Yomonlashish belgilari kuzatilsin",
      "Zarur bo'lsa neyrojarroh bilan maslahat ko'rib chiqilsin",
    ];
  }

  // ── VITAL SIGNS TAKTIKASI — PRIORITET: AIRWAY > CIRCULATION > NEURO ──
  // cABCDE: Airway/Breathing muammolari har doim birinchi
  const vitalTactics: string[] = [];

  if (hasSBP && sbp < 90 && hasSpO2 && spO2 < 90) {
    vitalTactics.push(
      `KRITIK: SpO2 ${spO2}% + SBP ${sbp} mmHg — oksigenatsiya VA qon bosim DARHOL tiklansin (EPIC Study 2021, OR 6.1)`
    );
  } else {
    if (hasSpO2 && spO2 < 90) {
      vitalTactics.push(
        `SpO2 ${spO2}% (kritik) — yuqori oqimli O2 yoki intubatsiya DARHOL baholansin. Maqsad SpO2 ≥94% (BTF 2023)`
      );
    } else if (hasSpO2 && spO2 < 94) {
      vitalTactics.push(
        `SpO2 ${spO2}% — O2 terapiyasi boshlansin (non-rebreather mask). Maqsad ≥94% (BTF 2023)`
      );
    }
    if (hasSBP && sbp < 90) {
      vitalTactics.push(
        `SBP ${sbp} mmHg (kritik) — MAP ≥80 mmHg tiklash zarur: suyuqlik va vazopresorlar baholansin (BTF 2016/2023)`
      );
    } else if (hasSBP && sbp < 110) {
      vitalTactics.push(
        `SBP ${sbp} mmHg — xavfli zona (maqsad ≥110 mmHg): suyuqlik optimizatsiyasi va monitoring zarur (ACS TBI 2024)`
      );
    }
  }
  // Vital taktikalarni ro'yxat BOSHIGA qo'shish (cABCDE prioriteti)
  treatmentTactics = [...vitalTactics, ...treatmentTactics];

  // ── POLITRAVMA TAKTIKASI ──────────────────────────────────────────────
  const isHighUrgency = urgency === 'EMERGENCY' || urgency === 'HIGH';

  if (hasPolytrauma) {
    treatmentTactics.push(
      isHighUrgency
        ? `Qo'shimcha jarohatlar (${polytravmaZones.join(', ')}) — cABCDE Primary Survey DARHOL bajarilsin (WSES 2019)`
        : `Qo'shimcha jarohatlar (${polytravmaZones.join(', ')}) — cABCDE Primary Survey bajarilsin (WSES 2019)`
    );
  }
  if (input.complaints?.chestPain && hasSpO2 && spO2 < 94) {
    treatmentTactics.push(
      isHighUrgency
        ? `Ko'krak og'rig'i + SpO2 ${spO2}% — ko'krak X-ray / FAST bajarilsin; pnevmotoraks istisno qilinsin (WSES 2019)`
        : `Ko'krak og'rig'i + SpO2 ${spO2}% — ko'krak X-ray / FAST o'tkazilsin; pnevmotoraks istisno qilinsin (WSES 2019)`
    );
  }
  if (input.complaints?.abdominalPain && hasSBP && sbp < 90) {
    treatmentTactics.push(
      `Qorin og'rig'i + gipotenziya — FAST USS bajarilsin; FAST(+) + beqarorlik bo'lsa laparotomiya ko'rsatmasi baholansin (WSES 2020)`
    );
  }
  if (rtsScore !== undefined && rtsScore < 5) {
    treatmentTactics.push(
      isHighUrgency
        ? `RTS ${rtsScore} (norma 7.84) — travma markazi aktivatsiyasi zarur (Boyd 1987)`
        : `RTS ${rtsScore} (norma 7.84) — travma markazi aktivatsiyasi ko'rib chiqilsin (Boyd 1987)`
    );
  }

  // ── KOMBINATSIYALARGA ASOSLANGAN TAKTIKALAR ───────────────────────────
  if (input.alcoholIntoxication)
    treatmentTactics.push("Alkogol: hushyor bo'lganda GCS qayta baholanishi tavsiya etiladi; 4–6 soat ichida klinik qayta ko'rish tavsiya etiladi (NICE 2023)");
  if (input.sex === 'female' && input.pregnancy)
    treatmentTactics.push("Homilador: akusher-ginekolog bilan koordinatsiya; KT bajarilsa qorin sohasini qo'rg'oshin ekran bilan himoya qilish tavsiya etiladi");
  if (input.anticoagulant && ctNormal)
    treatmentTactics.push("Antikoagulyant + CT normal: 24 soat yotqizish zarur — kechikkan qon ketish xavfi (Cohen 2006)");
  if (input.anticoagulant && hasHematoma)
    treatmentTactics.push("Antikoagulyant + gematoma: reversal terapiya baholansin (warfarin → 4F-PCC; DOAC → idarucizumab/andexanet)");
  if (input.anticoagulant && hasContusion)
    treatmentTactics.push("Antikoagulyant + kontuziya: reversal terapiya zarur — kechikkan qon ketish xavfi (BTF 2016, Cohen 2006)");
  if (hasContusion)
    treatmentTactics.push("Miya kontuziyasi: 6–12 soatdan keyin KT takrorlansin — o'lcham oshishi kuzatilsin (BTF 2016)");
  if (hasFracture)
    treatmentTactics.push("Bosh suyagi sinishi: neyrojarroh maslahat zarur; asos suyagi sinishi belgilari bo'lsa — tezkor baholash zarur (BTF 2016)");
  if (gcsTotal <= 8 && ctNormal)
    treatmentTactics.push("GCS ≤8 + CT normal: Diffuz Aksonal Jarohat (DAJ) ehtimoli — MRI bajarilsin (ACS TQIP 2023)");
  if ((input.meningealSigns.kernig || input.meningealSigns.brudzinski || input.meningealSigns.neckStiffness) && ctNormal)
    treatmentTactics.push("Meningeal belgilar + CT normal: LP (lyumbar punksiya) ko'rib chiqilishi tavsiya etiladi — SAQ ehtimolini istisno qilish");
  if (comorbidities.includes('coagulopathy'))
    treatmentTactics.push("Koagulopatiya: INR tekshiruvi va reversal terapiya (4F-PCC) baholansin (ACS TQIP 2023)");
  if (comorbidities.includes('epilepsy'))
    treatmentTactics.push("Epilepsiya tarixi: profilaktik antiepileptik ko'rib chiqilsin (Levetiracetam / Fenitoin 7 kun) — BTF 2016");
  if (comorbidities.includes('stroke'))
    treatmentTactics.push("Insult tarixi: antitrombotik dorilar mavjud bo'lsa reversal ko'rib chiqilishi tavsiya etiladi; bazal GCS ni aniqlash tavsiya etiladi");
  if (comorbidities.includes('dementia'))
    treatmentTactics.push("Demensiya: bazal GCS ma'lum bo'lsa shu bilan taqqoslash tavsiya etiladi; oila / parvarish xodimidan ma'lumot olish tavsiya etiladi");
  if (comorbidities.includes('heart_failure'))
    treatmentTactics.push("Yurak yetishmovchiligi: MAP monitoring tavsiya etiladi; suyuqlik yuklashda ehtiyotkorlik tavsiya etiladi");
  if (comorbidities.includes('copd'))
    treatmentTactics.push("COPD: SpO2 bazal darajasi past bo'lishi mumkin — maqsad 94–96% (92% emas)");
  if (comorbidities.includes('cancer'))
    treatmentTactics.push("Onkologik kasallik: metastaz ehtimoli — MRI tavsiya etiladi");
  if (comorbidities.includes('renal'))
    treatmentTactics.push("Buyrak yetishmovchiligi: kontrastli KT da ehtiyotkorlik tavsiya etiladi; dori dozalarini moslashtirish tavsiya etiladi");
  if (comorbidities.includes('immunosuppression'))
    treatmentTactics.push("Immunosupressiya: infeksiya ehtimoli yuqori — isitma bo'lsa LP ko'rib chiqilishi tavsiya etiladi");

  // ════════════════════════════════════════════════════════════════════
  // XAI KENGAYTIRISH — GCS, CCHR, BTF, NICE, Alkogol, Yosh
  // Vital signs XAI yuqorida qatlam 1 da allaqachon qo'shilgan
  // ════════════════════════════════════════════════════════════════════

  // GCS
  if (gcsTotal <= 5) {
    xaiEntries.push({
      fact:   `GCS jami: ${gcsTotal} (E${input.gcs.eye}+V${input.gcs.verbal}+M${input.gcs.motor})`,
      effect: "Kritik darajadagi ong buzilishi — beyin o'zagi funksiyasi xavf ostida",
      impact: "GCS ≤5 = kritik holat. BTF 2016: GCS ≤8 neyrojarroh maslahat ko'rsatmasi. Tezkor baholash tavsiya etiladi",
      source: 'Teasdale & Jennett 1974, BTF 4th Ed. 2016'
    });
  } else if (gcsTotal <= 8) {
    xaiEntries.push({
      fact:   `GCS jami: ${gcsTotal} (E${input.gcs.eye}+V${input.gcs.verbal}+M${input.gcs.motor})`,
      effect: "Og'ir TBI — himoya reflekslari buzilishi, aspiratsiya va ikkilamchi miya jarohati ehtimoli oshadi",
      impact: "BTF 2016: GCS ≤8 = intubatsiya chegarasi. Shoshilinch KT va neyrojarroh maslahat tavsiya etiladi. IMPACT model: OR o'lim 3.2x",
      source: 'BTF 4th Ed. 2016, IMPACT model, ACS TQIP 2023'
    });
  } else if (gcsTotal <= 12) {
    xaiEntries.push({
      fact:   `GCS jami: ${gcsTotal} (E${input.gcs.eye}+V${input.gcs.verbal}+M${input.gcs.motor})`,
      effect: "O'rta og'irlikdagi TBI — nevrologik yomonlashish ehtimoli mavjud",
      impact: "NICE CG176: GCS <13 = KT ko'rsatmasi. Dinamik kuzatish va neyrojarroh maslahat tavsiya etiladi",
      source: 'NICE CG176 2023, BTF 2016, CCHR Lancet 2001'
    });
  } else if (gcsTotal <= 14) {
    xaiEntries.push({
      fact:   `GCS jami: ${gcsTotal} (E${input.gcs.eye}+V${input.gcs.verbal}+M${input.gcs.motor})`,
      effect: 'Yengil TBI — GCS 13–14 CCHR yuqori xavf zonasida',
      impact: "CCHR (Stiell 2001): GCS <15 jarohatdan 2 soat o'tgach = yuqori xavf mezoni. Kuzatish tavsiya etiladi",
      source: 'CCHR Lancet 2001, NICE CG176 2023'
    });
  }

  // CCHR
  if (cchrScore >= 35) {
    const activeHighRisk = [
      input.cchrAdditional.gcsLessThan15at2hrs  && "GCS < 15 (2 soatdan keyin)",
      input.cchrAdditional.suspectedOpenFracture && "Ochiq/botiq suyak sinishi",
      input.cchrAdditional.basalSkullFracture    && "Asos suyagi sinishi (Battle, Raccoon eyes)",
      input.complaints.vomiting === 'repeated'   && "Qayta qusish",
      input.age >= 65                            && "Yosh ≥65",
    ].filter(Boolean).join('; ');
    xaiEntries.push({
      fact:   `CCHR yuqori xavf: ${activeHighRisk}`,
      effect: 'Yuqori xavf mezonlari intrakranial jarohat ehtimolini sezilarli oshiradi',
      impact: "CCHR sezgirligi 99–100% (Stiell 2001, n=3121). Yuqori xavf + KT yo'q = patologiya o'tkazib yuborilish ehtimoli oshadi",
      source: 'Stiell IG et al. Lancet 2001;357:1391. PMID: 11356436'
    });
  } else if (cchrScore >= 15) {
    xaiEntries.push({
      fact:   `CCHR o'rta xavf: ${cchrScore}/100`,
      effect: "Bir yoki bir necha CCHR o'rta xavf omillari aniqlandi",
      impact: "CCHR: o'rta xavf = KT tavsiya etiladi, ayniqsa yosh ≥65 yoki antikoagulyant bo'lsa",
      source: 'CCHR Lancet 2001, Foks et al. BMJ 2018'
    });
  }

  // BTF — gematoma
  if (hasHematoma && input.hematomaVolume !== undefined && input.hematomaVolume > 0) {
    const vol   = input.hematomaVolume;
    const shift = input.midlineShift ?? 0;
    xaiEntries.push({
      fact:   `Gematoma: ${vol}ml${shift > 0 ? `, siljish ${shift}mm` : ''}${input.hematomaType ? ` (${input.hematomaType})` : ''}`,
      effect: input.hematomaType === 'subdural'
        ? "Subdural gematoma — venoz qon ketishi, kech ko'rinish, keksa bemorlarda xavf yuqori"
        : input.hematomaType === 'epidural'
        ? "Epidural gematoma — arterial qon ketishi, tez kengayish, 'yorug' interval' ehtimoli"
        : "Intrakranial qon to'planishi — ICP oshishi va miya to'qimasini siqish ehtimoli",
      impact: `BTF 2016: subdural >10mm yoki siljish >5mm; epidural qalinlik ≥15mm yoki siljish >5mm — jarrohlik mezonlari. Hozir: ${vol >= 30 || shift > 5 ? "jarrohlik ko'rsatmasi ehtimoli yuqori" : vol >= 10 ? "kuzatish + takror KT tavsiya etiladi" : "konservativ boshqaruv tavsiya etiladi"}`,
      source: 'Bullock MR et al. Neurosurgery 2006. BTF 4th Ed. 2016'
    });
  }

  // Antikoagulyant
  if (input.anticoagulant) {
    xaiEntries.push({
      fact:   'Antikoagulyant terapiya mavjud',
      effect: "Antikoagulyant → qon ivish tizimi buzilishi → minor travmada ham intrakranial qon ketish ehtimoli oshadi",
      impact: "Cohen 2006 (n=20): dastlab normal KT bo'lgan bemorlarning 90% qayta qabul, jiddiy qon ketish rivojlangan. EFNS: antikoagulyant = mustaqil KT ko'rsatmasi, GCS dan qat'iy nazar. KT normal bo'lsa ham 24 soat yotqizish tavsiya etiladi",
      source: 'Cohen DB et al. J Trauma 2006. Kavalci C et al. Front Med 2024 PMC11063395'
    });
  }

  // Meningeal belgilar
  if (input.meningealSigns.kernig || input.meningealSigns.brudzinski || input.meningealSigns.neckStiffness) {
    const mSigns = [
      input.meningealSigns.neckStiffness && "bo'yin qattiqligi",
      input.meningealSigns.kernig        && 'Kernig belgisi',
      input.meningealSigns.brudzinski    && 'Brudzinskiy belgisi',
    ].filter(Boolean).join(', ');
    xaiEntries.push({
      fact:   `Meningeal belgilar: ${mSigns}`,
      effect: "Meningeal irritatsiya — subaraxnoid qon ketish (SAQ) yoki meningit ehtimolini ko'rsatadi",
      impact: "NICE CG176: meningeal belgilar = KT va LP ko'rsatmasi. LP faqat KT dan keyin — intrakranial bosimni avval istisno qilish tavsiya etiladi",
      source: 'NICE CG176 2023 Rec. 1.4.10'
    });
  }

  // Alkogol
  if (input.alcoholIntoxication) {
    xaiEntries.push({
      fact:   'Alkogol intoksikatsiyasi mavjud',
      effect: "Alkogol GCS ni sun'iy ravishda pasaytirishi mumkin → haqiqiy nevrologik holat noaniq bo'ladi",
      impact: "Sperry 2006 (n=55,732): alkogol GCS ni o'rtacha 0.8 ball pasaytiradi. NICE 2023: alkogol metabolizmlanguncha (4–6 soat) qayta baholash tavsiya etiladi",
      source: 'Sperry JL et al. J Trauma 2006 PMID:17014346. NICE CG176 2023'
    });
  }

  // Yosh ≥65
  if (input.age >= 65) {
    xaiEntries.push({
      fact:   `Bemor yoshi: ${input.age}`,
      effect: "Keksa yoshda serebral atrofiya → subdural gematoma uchun kengroq bo'shliq, kech klinik ko'rinish; antikoagulyant ehtimoli yuqori",
      impact: "CCHR: yosh ≥65 = yuqori xavf mezoni. NICE CG176: 65+ + antikoagulyant = KT tavsiya etiladi. BTF: yosh ≥60 jarrohlik xavfini oshiradi",
      source: 'Stiell IG Lancet 2001. NICE CG176 2023. BTF 4th Ed. 2016'
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // PUBMED — AQLLI SO'ROV TIZIMI v2
  // Har bir klinik holat uchun alohida, sodda va samarali query
  // MeSH / [Title/Abstract] filtrsiz — kengroq natija
  // ════════════════════════════════════════════════════════════════════
  const pubmedQueries: string[] = [];

  if (severity === 'critical' || severity === 'severe') {
    pubmedQueries.push('severe traumatic brain injury management guidelines');
  } else if (severity === 'moderate') {
    pubmedQueries.push('moderate traumatic brain injury CT management');
  } else {
    pubmedQueries.push('mild traumatic brain injury CT decision Canadian rule');
  }

  if (hasHematoma) {
    if (input.hematomaType === 'subdural')         pubmedQueries.push('acute subdural hematoma surgery criteria outcomes');
    else if (input.hematomaType === 'epidural')    pubmedQueries.push('epidural hematoma surgical treatment outcomes');
    else if (input.hematomaType === 'subarachnoid') pubmedQueries.push('traumatic subarachnoid hemorrhage management prognosis');
    else                                           pubmedQueries.push('intracranial hematoma traumatic brain injury surgery');
  }
  if (hasContusion)                               pubmedQueries.push('cerebral contusion traumatic brain injury management progression');
  if (hasFracture)                                pubmedQueries.push('skull fracture traumatic brain injury management');
  if (input.anticoagulant)                        pubmedQueries.push('anticoagulant therapy traumatic brain injury hemorrhage reversal');
  if (input.alcoholIntoxication)                  pubmedQueries.push('alcohol intoxication traumatic brain injury GCS reliability');
  if (input.anisocoria !== 'none')                pubmedQueries.push('anisocoria transtentorial herniation traumatic brain injury');
  if (input.age >= 65)                            pubmedQueries.push('elderly traumatic brain injury outcomes management');
  if (hasSBP && sbp < 90)                         pubmedQueries.push('hypotension traumatic brain injury secondary insult outcome');
  if (hasSpO2 && spO2 < 90)                       pubmedQueries.push('hypoxia traumatic brain injury secondary brain injury');
  if (hasPolytrauma)                              pubmedQueries.push('polytrauma traumatic brain injury combined management');
  if (input.sex === 'female' && input.pregnancy)  pubmedQueries.push('traumatic brain injury pregnancy management outcomes');
  if (input.meningealSigns.kernig || input.meningealSigns.brudzinski || input.meningealSigns.neckStiffness)
                                                  pubmedQueries.push('traumatic subarachnoid hemorrhage meningeal signs lumbar puncture');
  if (input.cchrAdditional.basalSkullFracture)    pubmedQueries.push('basal skull fracture traumatic brain injury CSF leak');
  if (gcsTotal <= 8 && ctNormal)                  pubmedQueries.push('diffuse axonal injury MRI traumatic brain injury normal CT');

  const pubmedQuery = pubmedQueries[0] ?? 'traumatic brain injury management guidelines';

  // ════════════════════════════════════════════════════════════════════
  // REASONS VA SOURCES
  // ════════════════════════════════════════════════════════════════════
  const allRules = [...gcsRules, ...cchrRules, ...btfRules, ...niceRules, ...alcoholRules, ...vitalRules];
  // Deduplication by rule ID — bir xil ID ikki marta ko'rinmasin
  const seenIds = new Set<string>();
  const dedupedRules = allRules.filter(r => {
    if (seenIds.has(r.id)) return false;
    seenIds.add(r.id);
    return true;
  });
  const ruleReasons = [...new Set(dedupedRules.map(r => r.description))];
  const allReasons  = [...new Set([...overrideReasons, ...ruleReasons])].slice(0, 10);

  const sources = new Set<string>();
  if (gcsRules.length > 0)      sources.add('GCS');
  if (cchrRules.length > 0)     sources.add('CCHR');
  if (btfRules.length > 0)      sources.add('BTF');
  if (niceRules.length > 0)     sources.add('NICE');
  if (alcoholRules.length > 0)  sources.add('CCHR');
  if (vitalRules.length > 0)    sources.add('IMPACT/RTS');
  if (hasPolytrauma)            sources.add('WSES');
  if (overrideReasons.length > 0) sources.add('BTF');
  if (score > 30)               sources.add('PubMed');

  // ════════════════════════════════════════════════════════════════════
  // RETURN
  // ════════════════════════════════════════════════════════════════════
  const mechanismLabels: Record<string, string> = {
    fall_height:   'Balandlikdan yiqilish',
    road_accident: "Yo'l-transport hodisasi",
    direct_blow:   "To'g'ridan-to'g'ri zarba",
    sports:        'Sport jarohati',
    other:         input.otherMechanismLabel ? `Boshqa: ${input.otherMechanismLabel}` : 'Boshqa',
  };

  // Qaror qaysi qatlamdan keldi — shifokorga tushuntirish uchun
  let decisionLayer: string;
  if (hierarchyOverride === 'emergency' || surgicalUrgency === 'emergency') {
    decisionLayer = vitalOverride === 'emergency'
      ? 'VITAL (SBP/SpO2 kritik)'
      : 'NEURO (anizokoria / CN III / GCS kritik)';
  } else if (hierarchyOverride === 'urgent') {
    if (vitalOverride === 'urgent') decisionLayer = 'VITAL (SBP/SpO2)';
    else if (gcsTotal < 13)        decisionLayer = 'NEURO (GCS < 13)';
    else if (gcsTotal <= 8)        decisionLayer = 'NEURO (GCS ≤ 8)';
    else if (input.anticoagulant)  decisionLayer = 'PROTOKOL (Antikoagulyant + GCS < 15)';
    else                           decisionLayer = 'PROTOKOL (kombinatsiya)';
  } else if (hierarchyOverride === 'ct_mandatory') {
    if (input.anticoagulant)       decisionLayer = 'PROTOKOL (Antikoagulyant)';
    else if (comorbidities.includes('coagulopathy')) decisionLayer = 'PROTOKOL (Koagulopatiya)';
    else                           decisionLayer = 'PROTOKOL';
  } else if (btfScore >= 50) {
    decisionLayer = 'CT natijasi (BTF protokoli)';
  } else if (cchrScore >= 35) {
    decisionLayer = 'CCHR yuqori xavf';
  } else if (score >= 35) {
    decisionLayer = 'Weighted score (CCHR+GCS+BTF+NICE)';
  } else {
    decisionLayer = 'PROTOKOL (past xavf)';
  }

  return {
    decision, urgency, confidence, confidencePenalties, score, severity,
    gcsTotal, rtsScore, hasPolytrauma, polytravmaZones,
    xaiEntries,
    reasons: allReasons,
    sources: [...sources],
    summary: `Qaror asosi: ${[...sources].join(', ')}`,
    decisionLayer,
    breakdown: {
      cchr:    { score: cchrScore,    weight: WEIGHTS.cchr,    contribution: Math.round(cchrScore    * WEIGHTS.cchr),    rules: cchrRules },
      gcs:     { score: gcsScore,     weight: WEIGHTS.gcs,     contribution: Math.round(gcsScore     * WEIGHTS.gcs),     rules: gcsRules },
      btf:     { score: btfScore,     weight: WEIGHTS.btf,     contribution: Math.round(btfScore     * WEIGHTS.btf),     rules: btfRules },
      nice:    { score: niceScore,    weight: WEIGHTS.nice,    contribution: Math.round(niceScore    * WEIGHTS.nice),    rules: niceRules },
      alcohol: { score: alcoholScore, weight: WEIGHTS.alcohol, contribution: Math.round(alcoholScore * WEIGHTS.alcohol), rules: alcoholRules },
      vital:   { score: vitalScore,   weight: 0,               contribution: 0,                                          rules: vitalRules },
    },
    treatmentTactics, surgicalUrgency, hematomaSurgery,
    pubmedQuery,
    pubmedQueries,
    disclaimer: "Bu tizim klinik qaror qabul qilishni qo'llab-quvvatlash uchun mo'ljallangan. Har bir tavsiya klinik kontekst va shifokor hukmiga bog'liq. Yakuniy qaror doimo shifokorga tegishli.",
    patientInfo: {
      age:             input.age,
      sex:             input.sex === 'male' ? 'Erkak' : 'Ayol',
      traumaMechanism: mechanismLabels[input.traumaMechanism] ?? input.traumaMechanism,
      ctFindings:      input.ctFindings ?? [],
    },
    analyzedAt: new Date().toISOString(),
  };
}
