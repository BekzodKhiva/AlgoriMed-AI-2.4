import { NextRequest, NextResponse } from 'next/server';
import { analyze } from '@/lib/engine';
import { ClinicalInput } from '@/lib/types';

const SHEETS_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL ?? '';

const TRAUMA_UZ: Record<string, string> = {
  fall_height:   'Balandlikdan yiqilish',
  road_accident: "Yo'l halokati (YTH)",
  direct_blow:   "To'g'ridan-to'g'ri zarba",
  sports:        'Sport jarohati',
  other:         'Boshqa',
};

const DECISION_UZ: Record<string, string> = {
  NO_CT_REQUIRED:      'Past xavf',
  CT_RECOMMENDED:      "O'rta xavf",
  CT_REQUIRED:         'Yuqori xavf',
  IMMEDIATE_CT:        'KRITIK',
  SURGICAL_EVALUATION: 'KRITIK',
};

const HEMATOMA_UZ: Record<string, string> = {
  epidural:      'epidural',
  subdural:      'subdural',
  intracerebral: 'intraserebral',
  subarachnoid:  'subaraknoidal',
};

async function sendToSheets(payload: Record<string, unknown>) {
  if (!SHEETS_URL) return;
  try {
    // URL parametrlar orqali yuborish (GET) — Google Apps Script bilan 100% ishlaydi
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      params.append(key, String(value ?? ''));
    }
    const url = `${SHEETS_URL}?${params.toString()}`;
    await fetch(url, { method: 'GET' });
  } catch (err) {
    console.error('Google Sheets webhook xatosi:', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input: ClinicalInput & {
      otherMechanismLabel?: string;
      doctorName?: string;
      doctorRole?: string;
      hospital?:   string;
    } = body;

    if (!input.age || !input.sex || !input.gcs) {
      return NextResponse.json({ error: "Majburiy maydonlar to'ldirilmagan" }, { status: 400 });
    }
    if (
      input.gcs.eye    < 1 || input.gcs.eye    > 4 ||
      input.gcs.verbal < 1 || input.gcs.verbal  > 5 ||
      input.gcs.motor  < 1 || input.gcs.motor   > 6
    ) {
      return NextResponse.json({ error: "GCS qiymatlari noto'g'ri" }, { status: 400 });
    }
    if (input.sex === 'male') input.pregnancy = false;

    const startMs = Date.now();
    const result  = analyze(input);
    const elapsed = Math.round((Date.now() - startMs) / 1000);

    const hematomaType = input.hematomaType
      ? (HEMATOMA_UZ[input.hematomaType] ?? input.hematomaType)
      : '';

    sendToSheets({
      shifokor_ismi:      input.doctorName ?? '',
      yosh:               input.age,
      jins:               input.sex === 'male' ? 'Erkak' : 'Ayol',
      mexanizm:           TRAUMA_UZ[input.traumaMechanism] ?? input.traumaMechanism,
      gcs_eye:            input.gcs.eye,
      gcs_verbal:         input.gcs.verbal,
      gcs_motor:          input.gcs.motor,
      sbp_mmhg:           input.sbp ?? '',
      spo2_foiz:          input.spO2 ?? '',
      nafas_tezligi:      input.respiratoryRate ?? '',
      rts_ball:           result.rtsScore ?? '',
      politravma:         result.hasPolytrauma ? (result.polytravmaZones?.join(', ') ?? 'Ha') : 'Yoq',
      kt_natijasi:        input.ctResult ?? 'not_done',
      hematoma_type:      hematomaType,
      gematoma_ml:        input.hematomaVolume ?? '',
      siljish_mm:         input.midlineShift   ?? '',
      antikoagulyant:     input.anticoagulant ? 'Ha' : 'Yoq',
      algorimed_xulosasi: DECISION_UZ[result.decision] ?? result.decision,
      trigger_soni:       result.reasons?.length ?? 0,
      xavf_darajasi:      DECISION_UZ[result.decision] ?? result.decision,
      qaror_vaqti_sek:    elapsed > 0 ? elapsed : '',
      izoh:               '',
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Server xatosi' }, { status: 500 });
  }
}
