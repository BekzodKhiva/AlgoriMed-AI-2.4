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
// Bu vaznlar faqat TBI protokollari uchun — vital signs va politravma
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
function worstSurgical(
  a: AnalysisResult['surgicalUrgency'],
  b: AnalysisResult['surgicalUrgency']
): AnalysisResult['surgicalUrgency'] {
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
  const ctDone       = input.ctResult !== 'not_done';

  // Vital signs mavjudligi
  const hasSBP  = input.sbp  !== undefined && input.sbp  > 0;
  const hasRR   = input.respiratoryRate !== undefined && input.respiratoryRate > 0;
  const hasSpO2 = input.spO2 !== undefined;
  const sbp     = input.sbp  ?? 0;
  const spO2    = input.spO2 ?? 100;
  const rr      = input.respiratoryRate ?? 0;

  // Politravma sohalari
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
        impact: 'Secondary brain injury xavfi oshadi. Maqsad SBP >= 110 mmHg (ACS TBI 2024). Monitoring zarur',
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
      description: `Qorin og'rig'i + SBP ${sbp} mmHg < 90 — qorin ichki qon ketishi + TBI. Ikki jarroh zarur (WSES 2020)`,
      weight: 0.85
    });
    xaiEntries.push({
      fact:   `Qorin og'rig'i + SBP = ${sbp} mmHg`,
      effect: 'Qorin jarohati (jigar/taloq?) → gipotenziya → TBI ikkilamchi zararlanishi',
      impact: 'FAST tekshiruvi DARHOL. Umumiy jarroh + neyrojarroh birgalikda zarur',
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
      xaiEntries.push({
        fact:   `RTS = ${rtsScore} (norma: 7.84)`,
        effect: "Past RTS → og'ir politravma belgisi",
        impact: 'Travma markazi aktivatsiyasi ko\'rsatmasi (Boyd 1987)',
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
    gcsScore = 50;
    gcsRules.push({ id: 'GCS-3', name: "O'rta TBI",  protocol: 'GCS', riskLevel: 'medium',
      description: `GCS ${gcsTotal} — o'rta og'irlikdagi TBI (9–12)`, weight: 0.50 });
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

  if (input.ctResult === 'hematoma' && input.hematomaVolume !== undefined) {
    const vol       = input.hematomaVolume;
    const shift     = input.midlineShift ?? 0;
    const thickness = input.hematomaThickness ?? 0;
    const type      = input.hematomaType;
    const epiduralBigThick = type === 'epidural' && thickness >= 15;

    if (vol < 10 && !epiduralBigThick) {
      btfScore = 35; hematomaSurgery = 'observe';
      btfRules.push({ id: 'BTF-H1', name: 'BTF < 10ml', protocol: 'BTF', riskLevel: 'medium',
        description: `Gematoma ${vol}ml — konservativ, dinamik kuzatish`, weight: 0.35 });
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
          description: `Gematoma ${vol}ml — neyrojarroh bilan maslahat zarur`, weight: 0.75 });
      } else {
        btfScore = 90; surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
        btfRules.push({ id: 'BTF-H3b', name: 'BTF Jarrohlik+GCS', protocol: 'BTF', riskLevel: 'high',
          description: `Gematoma ${vol}ml + GCS ${gcsTotal} — jarrohlik tavsiya etiladi (BTF 2016)`, weight: 0.90 });
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

  if (input.age >= 65) { niceScore += 25; }
  if (input.anticoagulant) {
    niceScore += 25;
    niceRules.push({ id: 'NICE-1', name: 'NICE Antikoagulyant', protocol: 'NICE', riskLevel: 'high', description: "Antikoagulyant terapiya — qon ketish xavfi yuqori (EFNS, Cohen 2006)", weight: 0.25 });
  }
  if (input.meningealSigns.kernig || input.meningealSigns.brudzinski || input.meningealSigns.neckStiffness) {
    niceScore += 30;
    niceRules.push({ id: 'NICE-2', name: 'NICE Meningeal', protocol: 'NICE', riskLevel: 'high', description: "Meningeal belgilar — meningit / SAQ istisno qilinsin (NICE CG176)", weight: 0.30 });
  }
  if (input.sex === 'female' && input.pregnancy) {
    niceScore += 20;
    niceRules.push({ id: 'NICE-P1', name: 'NICE Homiladorlik', protocol: 'NICE', riskLevel: 'high', description: "Homilador bemor: KT — qorin himoyasi zarur; MRI afzal (NICE CG176)", weight: 0.20 });
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
      description: "Alkogol: GCS ishonchsiz → CT majburiy; hushyor bo'lganda GCS qayta baholansin (Sperry 2006)", weight: 0.70 });
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
      description: "Ko'z qorachig'i asimmetriyasi — transtentorial herniatsiya ehtimoli. FAVQULODDA neyrojarrohlik baholash + shoshilinch KT zarur (BTF 2016)", weight: 1.0 });
    overrideReasons.push("Anizokoria — transtentorial herniatsiya belgisi");
    xaiEntries.push({
      fact:   `Anizokoria: ${input.anisocoria} tomonda kengaygan qorachiq`,
      effect: "CN III siqilishi → transtentorial herniatsiya ehtimoli — miya o'qi pastga siljiydi",
      impact: 'FAVQULODDA neyrojarrohlik BAHOLASH zarur. Shoshilinch KT (agar bajarilmagan bo\'lsa) — KT natijasiga qarab jarrohlik qaror qilinadi (BTF 2016)',
      source: 'BTF 2016, EMCrit, ENLS 6.0'
    });
  }

  // K25: CN III patologik (anizokoria yo'q bo'lsa)
  if (input.cranialNerves?.cn3 === 'P' && input.anisocoria === 'none') {
    hierarchyOverride = 'emergency';
    btfScore = 100;
    surgicalUrgency = worstSurgical(surgicalUrgency, 'emergency');
    btfRules.push({ id: 'BTF-CN3', name: 'CN III Patologik', protocol: 'BTF', riskLevel: 'high',
      description: "CN III falaji — herniatsiya ehtimoli. FAVQULODDA neyrojarrohlik baholash + shoshilinch KT (BTF 2016)", weight: 1.0 });
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

  // K4: Antikoagulyant + har qanday TBI (Cohen 2006, EFNS)
  if (input.anticoagulant && hierarchyOverride === null) {
    hierarchyOverride = 'ct_mandatory';
    overrideReasons.push("Antikoagulyant + TBI → CT majburiy (Cohen 2006)");
  }

  // K17: GCS <= 8 (BTF 2016)
  if (gcsTotal <= 8 && hierarchyOverride === null) {
    hierarchyOverride = 'urgent';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    overrideReasons.push(`GCS ${gcsTotal} <= 8 — og'ir TBI, shoshilinch CT zarur`);
  }

  // K12: 65+ yosh + antikoagulyant (NICE 2023)
  if (input.age >= 65 && input.anticoagulant && hierarchyOverride === null) {
    hierarchyOverride = 'ct_mandatory';
    overrideReasons.push("65+ yosh + antikoagulyant → CT + 24 soat yotqizish (NICE 2023)");
  }

  // K26: Koagulopatiya + TBI (ACS TQIP 2023)
  if (comorbidities.includes('coagulopathy') && hierarchyOverride === null) {
    hierarchyOverride = 'ct_mandatory';
    overrideReasons.push("Koagulopatiya + TBI → CT majburiy (ACS TQIP 2023)");
  }

  // K10: Meningeal belgilar + gematoma (BTF + NICE)
  if ((input.meningealSigns.kernig || input.meningealSigns.brudzinski || input.meningealSigns.neckStiffness)
      && input.ctResult === 'hematoma' && hierarchyOverride === null) {
    hierarchyOverride = 'urgent';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    overrideReasons.push("Meningeal belgilar + gematoma → neyrojarroh DARHOL (NICE 2023, BTF 2016)");
  }

  // K6: Alkogol + GCS <= 12 (Sperry 2006, NICE 2023)
  if (input.alcoholIntoxication && gcsTotal <= 12 && hierarchyOverride === null) {
    hierarchyOverride = 'ct_mandatory';
    overrideReasons.push(`Alkogol + GCS ${gcsTotal} <= 12 → CT majburiy, GCS ishonchsiz (Sperry 2006)`);
  }

  // K18: Alkogol + GCS <= 8 (BTF + CCHR)
  if (input.alcoholIntoxication && gcsTotal <= 8 && hierarchyOverride !== 'emergency') {
    hierarchyOverride = 'urgent';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    overrideReasons.push(`Alkogol + GCS ${gcsTotal} <= 8 → shoshilinch CT, GCS ishonchsiz`);
  }

  // K36: Koagulopatiya + gematoma (ACS TQIP 2023)
  if (comorbidities.includes('coagulopathy') && input.ctResult === 'hematoma' && hierarchyOverride !== 'emergency') {
    hierarchyOverride = 'urgent';
    surgicalUrgency = worstSurgical(surgicalUrgency, 'urgent');
    overrideReasons.push("Koagulopatiya + gematoma → reversal terapiya + shoshilinch jarrohlik (ACS TQIP 2023)");
  }

  // ── DARAJA 3: O'RTA XAVF ─────────────────────────────────────────────

  if (input.anticoagulant && input.ctResult === 'normal' && hierarchyOverride === null) {
    overrideReasons.push("Antikoagulyant + CT normal → 24 soat yotqizish MAJBURIY (Cohen 2006)");
  }
  if (cchrScore >= 30 && input.ctResult === 'normal') {
    overrideReasons.push("CCHR yuqori xavf + CT normal → kuzatish zarur (NICE 2023)");
  }
  if ((input.meningealSigns.kernig || input.meningealSigns.brudzinski || input.meningealSigns.neckStiffness) && input.ctResult === 'normal') {
    overrideReasons.push("Meningeal belgilar + CT normal → LP ko'rsatmasi (SAQ istisno qilinsin)");
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
    overrideReasons.push("Tutqanoq + GCS <= 12 → CT darhol bajarilsin (BTF 2016)");
  }
  if (gcsTotal <= 8 && input.ctResult === 'normal') {
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
  const score = Math.min(100, Math.round(rawScore + cchrGcsCorr + btfGcsCorr));

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

  // Mutlaq favqulodda
  if (hierarchyOverride === 'emergency' || surgicalUrgency === 'emergency') {
    decision = 'SURGICAL_EVALUATION';
  } else if (ctDone) {
    if (surgicalUrgency === 'urgent' || surgicalUrgency === 'monitor') {
      decision = 'SURGICAL_EVALUATION';
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
  else if (hierarchyOverride === 'urgent'    || surgicalUrgency === 'urgent' || score >= 70) urgency = 'HIGH';
  else if (hierarchyOverride === 'ct_mandatory' || surgicalUrgency === 'monitor' || score >= 35) urgency = 'MODERATE';
  else urgency = 'LOW';

  // ════════════════════════════════════════════════════════════════════
  // DAVOLASH TAKTIKASI — "Consider..." formati (hujjat tavsiyasi)
  // Buyruq emas — tavsiya. Klinik qaror doim shifokorga tegishli.
  // ════════════════════════════════════════════════════════════════════
  let treatmentTactics: string[] = [];

  if (surgicalUrgency === 'emergency') {
    treatmentTactics = [
      "FAVQULODDA: Neyrojarroh bilan DARHOL maslahat zarur",
      "Shoshilinch KT (agar bajarilmagan) — KT natijasiga qarab jarrohlik qaror qilinadi",
      "ICP oshishi gumon qilinsa — IV mannitol ko'rib chiqish mumkin (1 g/kg)",
      "Bosh 30 daraja ko'tarilgan holda ushlab turish ko'rib chiqilsin",
      "GCS har 15 daqiqada baholang",
      "MAP 80 mmHg va undan yuqori ushlab turish maqsadini ko'rib chiqing",
      "Bemor NPO (bo'sh qorin) holatida saqlash tavsiya etiladi",
    ];
  } else if (surgicalUrgency === 'urgent') {
    treatmentTactics = [
      "Neyrojarroh bilan shoshilinch maslahatni ko'rib chiqing",
      "Neyrojarrohlik bo'limiga yotqizish tavsiya etiladi",
      "6-12 soatdan keyin KT takrorlashni ko'rib chiqing",
      "Har soatda nevrologik monitoring tavsiya etiladi",
      "Bemor NPO holatida saqlash tavsiya etiladi",
    ];
  } else if (surgicalUrgency === 'monitor') {
    treatmentTactics = [
      "Neyrojarroh bilan maslahat tavsiya etiladi",
      "6-12 soatdan keyin KT takrorlashni ko'rib chiqing",
      "Neyrojarrohlik bo'limiga yotqizish ko'rib chiqilsin",
      "Har soatda nevrologik monitoring tavsiya etiladi",
    ];
  } else if (decision === 'IMMEDIATE_CT' || decision === 'CT_REQUIRED') {
    treatmentTactics = [
      "KT skanini shoshilinch bajarishni ko'rib chiqing",
      "KT natijasi ma'lum bo'lgunicha bemorni kuzatib boring",
      "Venoz kirish yo'li ta'minlanishini ko'rib chiqing",
      "GCS har 30 daqiqada baholang",
      "Nevrologik o'zgarishlarni kuzatib boring",
    ];
  } else if (decision === 'CT_RECOMMENDED') {
    treatmentTactics = [
      "KT bajarishni ko'rib chiqish tavsiya etiladi",
      "Kuzatish uchun yotqizish ko'rib chiqilsin",
      "Muntazam nevrologik tekshiruvlar o'tkazing",
    ];
  } else {
    treatmentTactics = [
      "Kuzatish uchun yotqizish ko'rib chiqilsin",
      "Yomonlashish belgilarini kuzatib boring",
      "Kerak bo'lsa neyrojarroh bilan maslahat ko'rib chiqilsin",
    ];
  }

  // ── VITAL SIGNS TAKTIKASI — PRIORITET: AIRWAY > CIRCULATION > NEURO ──
  // cABCDE: Airway/Breathing muammolari har doim birinchi
  const vitalTactics: string[] = [];

  if (hasSBP && sbp < 90 && hasSpO2 && spO2 < 90) {
    // Ikkalasi kritik — bitta birlashgan tavsiya, birinchi qo'yiladi
    vitalTactics.push(
      `KRITIK: SpO2 ${spO2}% + SBP ${sbp} mmHg — oksigenatsiya VA qon bosimni BIRGALIKDA tiklash zarur (EPIC Study 2021, OR 6.1)`
    );
  } else {
    // SpO2 birinchi — Airway/Breathing (A va B ABCDE bo'yicha)
    if (hasSpO2 && spO2 < 90) {
      vitalTactics.push(
        `SpO2 ${spO2}% (kritik) — yuqori oqimli O2 yoki intubatsiya ko'rsatmasini baholang. Maqsad SpO2 94% va undan yuqori (BTF 2023)`
      );
    } else if (hasSpO2 && spO2 < 94) {
      vitalTactics.push(
        `SpO2 ${spO2}% — O2 terapiyasini ko'rib chiqing (non-rebreather mask). Maqsad 94% va undan yuqori (BTF 2023)`
      );
    }
    // SBP ikkinchi — Circulation (C)
    if (hasSBP && sbp < 90) {
      vitalTactics.push(
        `SBP ${sbp} mmHg (kritik) — MAP 80 mmHg va undan yuqori tiklashni ko'rib chiqing: suyuqlik va vazopresorlar ko'rsatmasini baholang (BTF 2016/2023)`
      );
    } else if (hasSBP && sbp < 110) {
      vitalTactics.push(
        `SBP ${sbp} mmHg — xavfli zona (maqsad 110 mmHg va undan yuqori): suyuqlik optimizatsiyasi va monitoring (ACS TBI 2024)`
      );
    }
  }
  // Vital taktikalarni ro'yxat BOSHIGA qo'shish (cABCDE prioriteti)
  treatmentTactics = [...vitalTactics, ...treatmentTactics];

  // ── POLITRAVMA TAKTIKASI ──────────────────────────────────────────────
  if (hasPolytrauma) {
    treatmentTactics.push(
      `Politravma (${polytravmaZones.join(', ')}) — cABCDE Primary Survey to'liq bajarilishini ko'rib chiqing (WSES 2019)`
    );
  }
  if (input.complaints?.chestPain && hasSpO2 && spO2 < 94) {
    treatmentTactics.push(
      `Ko'krak og'rig'i + SpO2 ${spO2}% — ko'krak X-ray / FAST tekshiruvi ko'rib chiqilsin; pnevmotoraks istisno qilinsin (WSES 2019)`
    );
  }
  if (input.complaints?.abdominalPain && hasSBP && sbp < 90) {
    treatmentTactics.push(
      `Qorin og'rig'i + gipotenziya — FAST USS darhol ko'rib chiqilsin; FAST(+) + beqarorlik bo'lsa laparotomiya ko'rsatmasini baholang (WSES 2020)`
    );
  }
  if (rtsScore !== undefined && rtsScore < 5) {
    treatmentTactics.push(
      `RTS ${rtsScore} (norma 7.84) — travma markazi aktivatsiyasi ko'rsatmasini baholang (Boyd 1987)`
    );
  }

  // ── KOMBINATSIYALARGA ASOSLANGAN TAKTIKALAR ───────────────────────────
  if (input.alcoholIntoxication)
    treatmentTactics.push("Alkogol: hushyor bo'lganda GCS qayta baholansin; 4–6 soat ichida klinik qayta ko'rish tavsiya etiladi (NICE 2023)");
  if (input.sex === 'female' && input.pregnancy)
    treatmentTactics.push("Homilador: akusher-ginekolog bilan koordinatsiya; KT bajarilsa qorin sohasini qo'rg'oshin ekran bilan himoya qilish tavsiya etiladi");
  if (input.anticoagulant && input.ctResult === 'normal')
    treatmentTactics.push("Antikoagulyant + CT normal: 24 soat yotqizish ko'rib chiqilsin — kechikkan qon ketish xavfi (Cohen 2006)");
  if (input.anticoagulant && input.ctResult === 'hematoma')
    treatmentTactics.push("Antikoagulyant + gematoma: reversal terapiya ko'rib chiqilsin (warfarin → 4F-PCC; DOAC → idarucizumab/andexanet)");
  if (gcsTotal <= 8 && input.ctResult === 'normal')
    treatmentTactics.push("GCS <= 8 + CT normal: Diffuz Aksonal Jarohat (DAJ) ehtimoli — MRI buyurishni ko'rib chiqing (ACS TQIP 2023)");
  if ((input.meningealSigns.kernig || input.meningealSigns.brudzinski || input.meningealSigns.neckStiffness) && input.ctResult === 'normal')
    treatmentTactics.push("Meningeal belgilar + CT normal: LP (lyumbar punksiya) ko'rsatmasini ko'rib chiqing — SAQ istisno qilinsin");
  if (comorbidities.includes('coagulopathy'))
    treatmentTactics.push("Koagulopatiya: INR tekshiruvi va reversal terapiya (4F-PCC) ko'rsatmasini baholang (ACS TQIP 2023)");
  if (comorbidities.includes('epilepsy'))
    treatmentTactics.push("Epilepsiya tarixi: profilaktik antiepileptik ko'rib chiqilsin (Levetiracetam / Fenitoin 7 kun) — BTF 2016");
  if (comorbidities.includes('stroke'))
    treatmentTactics.push("Insult tarixi: antitrombotik dorilar bor bo'lsa reversal ko'rsatmasini baholang; bazal GCS ni aniqlash muhim");
  if (comorbidities.includes('dementia'))
    treatmentTactics.push("Demensiya: bazal GCS ma'lum bo'lsa shu bilan taqqoshlang; oila / parvarish xodimidan ma'lumot oling");
  if (comorbidities.includes('heart_failure'))
    treatmentTactics.push("Yurak yetishmovchiligi: MAP monitoring tavsiya etiladi; suyuqlik yuklashda ehtiyotkorlik zarur");
  if (comorbidities.includes('copd'))
    treatmentTactics.push("COPD: SpO2 bazal darajasi past bo'lishi mumkin — maqsad 94–96% (92% emas)");
  if (comorbidities.includes('cancer'))
    treatmentTactics.push("Onkologik kasallik: metastaz ehtimoli — MRI ko'rsatmasini ko'rib chiqing");
  if (comorbidities.includes('renal'))
    treatmentTactics.push("Buyrak yetishmovchiligi: kontrastli KT da ehtiyotkorlik; dori dozalarini moslashtiring");
  if (comorbidities.includes('immunosuppression'))
    treatmentTactics.push("Immunosupressiya: infeksiya xavfi yuqori — isitma bo'lsa LP ko'rsatmasini ko'rib chiqing");

  // ════════════════════════════════════════════════════════════════════
  // PUBMED — YANGILANGAN KEYWORDS (politravma qo'shildi)
  // ════════════════════════════════════════════════════════════════════
  const pubmedTerms = ['"Brain Injuries, Traumatic"[MeSH Terms]'];
  if (severity === 'mild')                              pubmedTerms.push('"mild traumatic brain injury"[Title/Abstract]');
  if (severity === 'severe' || severity === 'critical') pubmedTerms.push('"severe traumatic brain injury"[Title/Abstract]');
  if (input.alcoholIntoxication)                        pubmedTerms.push('"alcohol intoxication traumatic brain injury"[Title/Abstract]');
  if (input.anticoagulant)                              pubmedTerms.push('"anticoagulant traumatic brain injury"[Title/Abstract]');
  if (input.sex === 'female' && input.pregnancy)        pubmedTerms.push('"traumatic brain injury pregnancy"[Title/Abstract]');
  // Yangi — politravma keywords (ilmiy tadqiqot tavsiyasi)
  if (hasPolytrauma)                                    pubmedTerms.push('"polytrauma" AND "traumatic brain injury"[Title/Abstract]');
  if (hasSBP && sbp < 90)                              pubmedTerms.push('"hypotension traumatic brain injury secondary insults"[Title/Abstract]');
  if (hasSpO2 && spO2 < 90)                            pubmedTerms.push('"hypoxia traumatic brain injury outcome"[Title/Abstract]');

  // ════════════════════════════════════════════════════════════════════
  // REASONS VA SOURCES
  // ════════════════════════════════════════════════════════════════════
  const allRules = [...gcsRules, ...cchrRules, ...btfRules, ...niceRules, ...alcoholRules, ...vitalRules];
  const ruleReasons = [...new Set(allRules.map(r => r.description))];
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

  return {
    decision, urgency, confidence, confidencePenalties, score, severity,
    gcsTotal, rtsScore, hasPolytrauma, polytravmaZones,
    xaiEntries,
    reasons: allReasons,
    sources: [...sources],
    summary: `Qaror asosi: ${[...sources].join(', ')}`,
    breakdown: {
      cchr:    { score: cchrScore,    weight: WEIGHTS.cchr,    contribution: Math.round(cchrScore    * WEIGHTS.cchr),    rules: cchrRules },
      gcs:     { score: gcsScore,     weight: WEIGHTS.gcs,     contribution: Math.round(gcsScore     * WEIGHTS.gcs),     rules: gcsRules },
      btf:     { score: btfScore,     weight: WEIGHTS.btf,     contribution: Math.round(btfScore     * WEIGHTS.btf),     rules: btfRules },
      nice:    { score: niceScore,    weight: WEIGHTS.nice,    contribution: Math.round(niceScore    * WEIGHTS.nice),    rules: niceRules },
      alcohol: { score: alcoholScore, weight: WEIGHTS.alcohol, contribution: Math.round(alcoholScore * WEIGHTS.alcohol), rules: alcoholRules },
      vital:   { score: vitalScore,   weight: 0,               contribution: 0,                                          rules: vitalRules },
    },
    treatmentTactics, surgicalUrgency, hematomaSurgery,
    pubmedQuery: pubmedTerms.slice(0, 3).join(' AND '),
    disclaimer: "Bu tizim klinik qaror qabul qilishni qo'llab-quvvatlash uchun mo'ljallangan. Har bir tavsiya klinik kontekst va shifokor hukmiga bog'liq. Yakuniy qaror doimo shifokorga tegishli.",
    patientInfo: {
      age:             input.age,
      sex:             input.sex === 'male' ? 'Erkak' : 'Ayol',
      traumaMechanism: mechanismLabels[input.traumaMechanism] ?? input.traumaMechanism,
      ctResult:        input.ctResult,
    },
    analyzedAt: new Date().toISOString(),
  };
}
