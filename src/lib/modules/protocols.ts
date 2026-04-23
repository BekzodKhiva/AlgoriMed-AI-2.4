// protocols.ts — AlgoriMed Engine v2.7
// ════════════════════════════════════════════════════════════════════
// PROTOKOLLAR moduli: CCHR + NICE + BTF priority qoidalari
// FIX 7: engine.ts dan ajratilgan
// FIX 5: Protocol conflict resolution — BTF > CCHR > NICE
// ════════════════════════════════════════════════════════════════════

// FIX 5: RULE CONFLICT MANAGEMENT
// Bitta bemorda bir nechta protokol ziddiyatli tavsiya berishi mumkin.
// Masalan: CCHR → CT kerak, NICE → observation
// Hal qilish: BTF > CCHR > NICE prioritet tartibida
export const PROTOCOL_PRIORITY: Record<string, number> = {
  'BTF':   3,  // Eng yuqori — klinik topilma asosida (CT/hematoma/contusion)
  'WSES':  3,  // BTF bilan teng — politravma uchun
  'GCS':   3,  // Klinik o'lchov — to'g'ridan-to'g'ri
  'CCHR':  2,  // O'rta — xavf mezoni asosida (Lancet 2001)
  'NICE':  1,  // Pastroq — qo'shimcha omillar (CG176 2023)
  'VITAL': 4,  // Hamma narsadan ustun (physiology.ts orqali)
};

// Conflict resolution: Bir xil urgency level tavsiyalar ichida
// eng yuqori prioritetli protokol ustun bo'ladi
export interface ProtocolVote {
  protocol: string;
  urgency: 'emergency' | 'urgent' | 'ct_mandatory' | 'monitor' | 'not_required';
  reason: string;
}

export function resolveConflict(votes: ProtocolVote[]): ProtocolVote | null {
  if (votes.length === 0) return null;
  return votes.reduce((best, current) => {
    const bestPriority    = PROTOCOL_PRIORITY[best.protocol]    ?? 0;
    const currentPriority = PROTOCOL_PRIORITY[current.protocol] ?? 0;
    return currentPriority > bestPriority ? current : best;
  });
}

// Urgency numeric rank (worst wins comparison uchun)
export const URGENCY_RANK: Record<string, number> = {
  'not_required': 0,
  'monitor':      1,
  'ct_mandatory': 2,
  'urgent':       3,
  'emergency':    4,
};
