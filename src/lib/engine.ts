// ================= TYPES =================

type SurgicalDecision = 'none' | 'observe' | 'urgent' | 'emergency';
type ConservativeDecision = 'none' | 'observe' | 'admit';

interface Input {
  gcsEye?: number;
  gcsVerbal?: number;
  gcsMotor?: number;

  systolicBP?: number;
  spO2?: number;
  respiratoryRate?: number;

  ctStatus?: 'normal' | 'abnormal';
  ctFindings?: string[];

  polytraumaZones?: string[];
}

// ================= HELPERS =================

function worstSurgical(a: SurgicalDecision, b: SurgicalDecision): SurgicalDecision {
  const order = ['none', 'observe', 'urgent', 'emergency'];
  return order.indexOf(b) > order.indexOf(a) ? b : a;
}

function worstConservative(a: ConservativeDecision, b: ConservativeDecision): ConservativeDecision {
  const order = ['none', 'observe', 'admit'];
  return order.indexOf(b) > order.indexOf(a) ? b : a;
}

// ================= ENGINE =================

export function runEngine(input: Input) {

  // ===== GCS =====
  const gcsEye = input.gcsEye ?? 0;
  const gcsVerbal = input.gcsVerbal ?? 0;
  const gcsMotor = input.gcsMotor ?? 0;

  const gcsTotal = gcsEye + gcsVerbal + gcsMotor;

  let severity: 'mild' | 'moderate' | 'severe';

  if (gcsTotal >= 13) severity = 'mild';
  else if (gcsTotal >= 9) severity = 'moderate';
  else severity = 'severe';

  // ===== VITALS =====
  const sbp = input.systolicBP ?? 0;
  const spO2 = input.spO2 ?? 0;
  const rr = input.respiratoryRate ?? 0;

  const hasSpO2 = spO2 > 0;
  const hasHypotension = sbp > 0 && sbp < 90;

  // ===== CT =====
  const ctFindings = input.ctFindings ?? [];

  const hasHematoma  = ctFindings.includes('hematoma');
  const hasContusion = ctFindings.includes('contusion');
  const hasFracture  = ctFindings.includes('fracture');

  const ctDone = input.ctStatus !== undefined;

  // ===== POLYTRAUMA =====
  const hasPolytrauma = (input.polytraumaZones ?? []).length > 0;

  // ===== DECISIONS =====
  let surgicalDecision: SurgicalDecision = 'none';
  let conservativeDecision: ConservativeDecision = 'none';

  // ================= CORE LOGIC =================

  // GCS asosida
  if (severity === 'severe') {
    surgicalDecision = worstSurgical(surgicalDecision, 'emergency');
  } else if (severity === 'moderate') {
    conservativeDecision = worstConservative(conservativeDecision, 'admit');
  } else {
    conservativeDecision = worstConservative(conservativeDecision, 'observe');
  }

  // ================= CT LOGIC =================

  if (hasHematoma) {
    surgicalDecision = worstSurgical(surgicalDecision, 'emergency');
  }

  if (hasFracture) {
    surgicalDecision = worstSurgical(surgicalDecision, 'urgent');
  }

  if (hasContusion) {
    conservativeDecision = worstConservative(conservativeDecision, 'observe');
  }

  // ================= VITAL OVERRIDES =================

  if (hasHypotension) {
    surgicalDecision = worstSurgical(surgicalDecision, 'emergency');
  }

  if (hasSpO2 && spO2 < 90) {
    surgicalDecision = worstSurgical(surgicalDecision, 'emergency');
  }

  if (rr > 0 && (rr < 10 || rr > 30)) {
    surgicalDecision = worstSurgical(surgicalDecision, 'emergency');
  }

  // ================= POLYTRAUMA =================

  if (hasPolytrauma) {
    surgicalDecision = worstSurgical(surgicalDecision, 'urgent');
  }

  // ================= CT NOT DONE SAFETY =================

  if (!ctDone && severity !== 'mild') {
    conservativeDecision = worstConservative(conservativeDecision, 'admit');
  }

  // ================= FINAL =================

  return {
    gcsTotal,
    severity,
    surgicalDecision,
    conservativeDecision
  };
}