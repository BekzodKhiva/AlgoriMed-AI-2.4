// api/sheets/route.ts — AlgoriMed Google Sheets integratsiyasi
// Apps Script webhook orqali — token shart emas

import { NextRequest, NextResponse } from 'next/server';

const APPS_SCRIPT_URL =
  process.env.GOOGLE_SHEETS_WEBHOOK_URL ??
  'https://script.google.com/macros/s/AKfycbyydQg8FuxzjdWWst4QBjtG_CU7s9dVVAJkUvDvswU6rfy0kLKO0qP7zYVjQzhUWJCL/exec';

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

// POST — result sahifasidan chaqiriladi
export async function POST(req: NextRequest) {
  try {
    const { result, input, doctorName, decisionTimeSeconds } = await req.json();

    const now    = new Date();
    const sana   = `${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.${now.getFullYear()}`;
    const gcsStr = `${result.gcsTotal} (${input.gcs.eye}+${input.gcs.verbal}+${input.gcs.motor})`;
    const triggerCount =
      (result.breakdown.cchr.rules.length    ?? 0) +
      (result.breakdown.gcs.rules.length     ?? 0) +
      (result.breakdown.btf.rules.length     ?? 0) +
      (result.breakdown.nice.rules.length    ?? 0) +
      (result.breakdown.alcohol.rules.length ?? 0);

    const payload: Record<string, unknown> = {
      shifokor_ismi:      doctorName        ?? 'Nomalum',
      sana,
      yosh:               input.age,
      jins:               input.sex === 'male' ? 'Erkak' : 'Ayol',
      mexanizm:           mechanismLabel(input.traumaMechanism),
      gcs:                gcsStr,
      kt_natijasi:        ctLabel(input.ctResult),
      gematoma_ml:        input.hematomaVolume ?? '',
      siljish_mm:         input.midlineShift   ?? '',
      antikoagulyant:     input.anticoagulant ? 'Ha' : "Yo'q",
      algorimed_xulosasi: urgencyLabel(result.urgency),
      trigger_soni:       triggerCount,
      qaror_vaqti_sek:    decisionTimeSeconds ?? '',
      izoh:               '',
    };

    // GET orqali yuborish — Apps Script bilan ishonchli usul
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      params.append(key, String(value ?? ''));
    }
    const url = `${APPS_SCRIPT_URL}?${params.toString()}`;
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });

    if (!res.ok) {
      console.error('Apps Script error:', res.status);
      return NextResponse.json({ error: "Sheets ga yozib bo'lmadi" }, { status: 500 });
    }

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: true, caseId: data.caseId ?? '' });

  } catch (err) {
    console.error('Sheets route error:', err);
    return NextResponse.json({ error: 'Server xatosi' }, { status: 500 });
  }
}

// GET — Apps Script dan callback uchun (ixtiyoriy)
export async function GET() {
  return NextResponse.json({ status: 'ok', url: APPS_SCRIPT_URL });
}
