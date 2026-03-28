// api/sheets/route.ts — AlgoriMed Google Sheets integratsiyasi
// Apps Script webhook orqali — token shart emas

import { NextRequest, NextResponse } from 'next/server';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxuMngvawWzftQBShfOfyGOYENzFL6mniMz2kMVWDTg15kqPfr6Smth3lJ1odiu8-v7/exec';

function mechanismLabel(mechanism: string): string {
  const map: Record<string, string> = {
    fall_height:   'Balandlikdan yiqilish',
    road_accident: "Yo'l-transport hodisasi",
    direct_blow:   "To'g'ridan-to'g'ri zarba",
    sports:        'Sport jarohati',
    other:         'Boshqa',
  };
  return map[mechanism] ?? mechanism;
}

function urgencyLabel(urgency: string): string {
  if (urgency === 'EMERGENCY') return 'KRITIK';
  if (urgency === 'HIGH')      return 'Yuqori xavf';
  if (urgency === 'MODERATE')  return "O'rta xavf";
  return 'Past xavf';
}

function ctLabel(ct: string): string {
  const map: Record<string, string> = {
    not_done:  'Bajarilmagan',
    normal:    'Normal',
    hematoma:  'Gematoma',
    contusion: 'Kontuziya',
    fracture:  'Suyak sinishi',
    other:     'Boshqa',
  };
  return map[ct] ?? ct;
}

export async function POST(req: NextRequest) {
  try {
    const { result, input, doctorName, decisionTimeSeconds } = await req.json();

    const now = new Date();
    const sana = `${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.${now.getFullYear()}`;
    const gcsStr = `${result.gcsTotal} (${input.gcs.eye}+${input.gcs.verbal}+${input.gcs.motor})`;
    const triggerCount =
      (result.breakdown.cchr.rules.length    ?? 0) +
      (result.breakdown.gcs.rules.length     ?? 0) +
      (result.breakdown.btf.rules.length     ?? 0) +
      (result.breakdown.nice.rules.length    ?? 0) +
      (result.breakdown.alcohol.rules.length ?? 0);

    const row = [
      '',
      sana,
      doctorName ?? 'Nomalum',
      input.age,
      input.sex === 'male' ? 'Erkak' : 'Ayol',
      mechanismLabel(input.traumaMechanism),
      gcsStr,
      'Supraorbital bosish',
      ctLabel(input.ctResult),
      input.hematomaVolume ?? '',
      input.midlineShift   ?? '',
      input.anticoagulant ? 'Ha' : "Yo'q",
      urgencyLabel(result.urgency),
      triggerCount,
      '', '', '', decisionTimeSeconds ?? '', '',
    ];

    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row }),
      redirect: 'follow',
    });

    if (!res.ok) {
      console.error('Apps Script error:', res.status);
      return NextResponse.json({ error: "Sheets ga yozib bo'lmadi" }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, caseId: data.caseId ?? '' });

  } catch (err) {
    console.error('Sheets route error:', err);
    return NextResponse.json({ error: 'Server xatosi' }, { status: 500 });
  }
}
