// types.ts — AlgoriMed Engine v2.3
// Manbalar: BTF 2016/2023, CCHR Lancet 2001, NICE CG176 2023,
//           ACEP 2023, ACS TQIP 2023/2024, ENLS 6.0, EPIC Study 2021,
//           IMPACT model, WSES 2019/2020, RTS (Boyd 1987),
//           CRASH model, NINDS 2024, Helsinki/Stockholm CT Score

export interface ClinicalInput {
  age: number;
  sex: 'male' | 'female';
  pregnancy: boolean;
  traumaMechanism: 'fall_height' | 'road_accident' | 'direct_blow' | 'sports' | 'other';
  alcoholIntoxication: boolean;
  anticoagulant: boolean;

  // ── VITAL SIGNS (RTS + IMPACT + BTF 2023 + ACS TBI 2024) ──────────────
  // Ixtiyoriy — kiritilmasa confidence pasayadi (penalty tizimi)
  sbp?: number;             // Sistolik qon bosim mmHg
  spO2?: number;            // Oksigen saturatsiyasi %
  respiratoryRate?: number; // Nafas tezligi (nafas/daqiqa)

  // ── SHIKOYATLAR ────────────────────────────────────────────────────────
  complaints: {
    headache: boolean;
    dizziness: boolean;
    nausea: boolean;
    vomiting: 'none' | 'once' | 'repeated';
    seizure: boolean;
    weakness: boolean;
    nystagmus: boolean;
    // Qo'shimcha jarohatlar shikoyatlari (WSES 2019/2020, CRASH model)
    chestPain: boolean;      // Ko'krak og'rig'i / nafas qiyinligi
    abdominalPain: boolean;  // Qorin og'rig'i / sezgirligi
    limbPain: boolean;       // Qo'l/oyoq og'rig'i / deformatsiyasi
    backPain: boolean;       // Bel / umurtqa og'rig'i
  };

  gcs: { eye: number; verbal: number; motor: number };
  anisocoria: 'none' | 'right' | 'left';

  cranialNerves: {
    cn1: 'N' | 'P'; cn2: 'N' | 'P'; cn3: 'N' | 'P';
    cn4: 'N' | 'P'; cn5: 'N' | 'P'; cn6: 'N' | 'P';
    cn7: 'N' | 'P'; cn8: 'N' | 'P'; cn9: 'N' | 'P';
    cn10: 'N' | 'P'; cn11: 'N' | 'P'; cn12: 'N' | 'P';
  };

  meningealSigns: { neckStiffness: boolean; kernig: boolean; brudzinski: boolean };

  cchrAdditional: {
    gcsLessThan15at2hrs: boolean;
    suspectedOpenFracture: boolean;
    basalSkullFracture: boolean;
  };

  // ── KT NATIJASI (multi-select) ────────────────────────────────────────
  // ctStatus: KT bajarilganmi va umumiy holat
  // ctFindings: bir vaqtda bir nechta topilma belgilash mumkin (neyroxirurg tavsiyasi)
  ctStatus: 'not_done' | 'normal';   // Bajarilmagan yoki normal — hech narsa yo'q
  ctFindings: Array<'hematoma' | 'contusion' | 'fracture' | 'other'>;  // Anormal topilmalar (multi-select)
  hematomaType?: 'epidural' | 'subdural' | 'intracerebral' | 'subarachnoid';
  hematomaVolume?: number;
  hematomaThickness?: number;
  midlineShift?: number;

  diabetes: boolean;
  hypertensionHistory: boolean;
  comorbidities: string[];
}

// ── TRIGGERED RULE ────────────────────────────────────────────────────────
export interface TriggeredRule {
  id: string;
  name: string;
  protocol: 'CCHR' | 'BTF' | 'NICE' | 'GCS' | 'VITAL' | 'WSES';
  riskLevel: 'high' | 'medium';
  description: string;
  weight: number;
}

// ── XAI — TUSHUNTIRISH TUZILMASI ─────────────────────────────────────────
// Hujjat tavsiyasi: har natijada FACT + EFFECT + IMPACT + WHY_NOT
export interface XaiEntry {
  fact: string;        // "SBP = 85 mmHg"
  effect: string;      // "Gipotenziya → serebral perfuziya pasayadi"
  impact: string;      // "O'lim xavfi OR 4.36 (BTF 2016)"
  source: string;      // "BTF 2016, WSES 2019"
}

// ── QAROR TURLARI ─────────────────────────────────────────────────────────
export type Decision =
  | 'NO_CT_REQUIRED'
  | 'CT_RECOMMENDED'
  | 'CT_REQUIRED'
  | 'IMMEDIATE_CT'
  | 'SURGICAL_EVALUATION';

export type Urgency  = 'LOW' | 'MODERATE' | 'HIGH' | 'EMERGENCY';
export type Severity = 'mild' | 'moderate' | 'severe' | 'critical';

// ── PROTOKOL SKOR ─────────────────────────────────────────────────────────
export interface ProtocolScore {
  score: number;
  weight: number;
  contribution: number;
  rules: TriggeredRule[];
}

// ── TAHLIL NATIJASI ───────────────────────────────────────────────────────
export interface AnalysisResult {
  decision: Decision;
  urgency: Urgency;
  confidence: number;
  confidencePenalties: string[];   // Nima sababdan confidence pasaydi
  score: number;
  severity: Severity;
  gcsTotal: number;

  // Qo'shimcha skorlar
  rtsScore?: number;               // Revised Trauma Score (Boyd 1987) — ixtiyoriy
  hasPolytrauma: boolean;
  polytravmaZones: string[];

  // XAI — tushuntirish (hujjat tavsiyasi)
  xaiEntries: XaiEntry[];

  reasons: string[];
  sources: string[];
  summary: string;
  decisionLayer: string;           // Qaror qaysi qatlamdan keldi: VITAL / NEURO / CT / PROTOCOL

  breakdown: {
    gcs:     ProtocolScore;
    cchr:    ProtocolScore;
    btf:     ProtocolScore;
    nice:    ProtocolScore;
    alcohol: ProtocolScore;
    vital:   ProtocolScore;        // Yangi — vital signs protokoli
  };

  treatmentTactics: string[];
  surgicalUrgency: 'not_required' | 'monitor' | 'urgent' | 'emergency';
  hematomaSurgery: null | 'observe' | 'repeat_ct' | 'surgery_required';

  pubmedQuery: string;
  pubmedQueries: string[];
  disclaimer: string;

  patientInfo?: {
    age: number;
    sex: string;
    traumaMechanism: string;
    ctFindings?: string[];
  };

  analyzedAt?: string;
}
