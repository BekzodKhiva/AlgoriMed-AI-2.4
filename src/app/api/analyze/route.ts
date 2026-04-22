import { NextRequest, NextResponse } from 'next/server';
import { analyze } from '@/lib/engine';
import { ClinicalInput } from '@/lib/types';

// ✅ Yangi Google Apps Script URL
const APPS_SCRIPT_URL =
  process.env.GOOGLE_SHEETS_WEBHOOK_URL ??
  'https://script.google.com/macros/s/AKfycbyydQg8FuxzjdWWst4QBjtG_CU7s9dVVAJkUvDvswU6rfy0kLKO0qP7zYVjQzhUWJCL/exec';

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

const CT_UZ: Record<string, string> = {
  not_done:  'Bajarilmagan',
  normal:    'Normal',
  hematoma:  'Gematoma',
  contusion: 'Kontuziya',
  fracture:  'Suyak sinishi',
  other:     'Boshqa',
};

const HEMATOMA_UZ: Record<string, string> = {
  epidural:      'epidural',
  subdural:      'subdural',
  intracerebral: 'intraserebral',
  subarachnoid:  'subaraknoidal',
};

async function sendToSheets(payload: Record<string, unknown>) {
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      params.append(key, String(value ?? ''));
    }
    const url = `${APPS_SCRIPT_URL}?${params.toString()}`;
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    if (!res.ok) {
      console.error('Google Sheets webhook xatosi:', res.status, await res.text());
    }
  } catch (err) {
    console.error('Google Sheets webhook xatosi:', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input: ClinicalInput & {
      otherMechanismLabel?: string;
      doctorName?:          string;
      doctorRole?:          string;
      hospital?:            string;
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

    const now    = new Date();
    const sana   = `${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.${now.getFullYear()}`;
    const gcsStr = `${result.gcsTotal} (${input.gcs.eye}+${input.gcs.verbal}+${input.gcs.motor})`;
    const hematomaType = input.hematomaType
      ? (HEMATOMA_UZ[input.hematomaType] ?? input.hematomaType)
      : '';
    const triggerCount =
      (result.breakdown.cchr.rules.length    ?? 0) +
      (result.breakdown.gcs.rules.length     ?? 0) +
      (result.breakdown.btf.rules.length     ?? 0) +
      (result.breakdown.nice.rules.length    ?? 0) +
      (result.breakdown.alcohol.rules.length ?? 0);

    // Google Sheets ga yuborish (background, non-blocking)
    sendToSheets({
      shifokor_ismi:      input.doctorName      ?? '',
      shifokor_roli:      input.doctorRole      ?? '',
      shifoxona:          input.hospital        ?? '',
      sana,
      yosh:               input.age,
      jins:               input.sex === 'male' ? 'Erkak' : 'Ayol',
      mexanizm:           TRAUMA_UZ[input.traumaMechanism] ?? input.traumaMechanism,
      gcs:                gcsStr,
      gcs_eye:            input.gcs.eye,
      gcs_verbal:         input.gcs.verbal,
      gcs_motor:          input.gcs.motor,
      sbp_mmhg:           input.sbp              ?? '',
      spo2_foiz:          input.spO2             ?? '',
      nafas_tezligi:      input.respiratoryRate  ?? '',
      rts_ball:           result.rtsScore        ?? '',
      kt_natijasi:        (input.ctFindings && input.ctFindings.length > 0)
                            ? input.ctFindings.map((f: string) => CT_UZ[f] ?? f).join(' + ')
                            : (input.ctStatus === 'normal' ? 'Normal' : 'Bajarilmagan'),
      hematoma_turi:      hematomaType,
      gematoma_ml:        input.hematomaVolume   ?? '',
      gematoma_qalinligi: input.hematomaThickness ?? '',
      siljish_mm:         input.midlineShift     ?? '',
      antikoagulyant:     input.anticoagulant      ? 'Ha' : "Yo'q",
      alkogol:            input.alcoholIntoxication ? 'Ha' : "Yo'q",
      qoshimcha_jarohat:  result.hasPolytrauma
                            ? (result.polytravmaZones?.join(', ') ?? 'Ha')
                            : "Yo'q",
      algorimed_xulosasi: DECISION_UZ[result.decision] ?? result.decision,
      xavf_darajasi:      DECISION_UZ[result.decision] ?? result.decision,
      xavf_bali:          result.score,
      ishonch_darajasi:   result.confidence,
      trigger_soni:       triggerCount,
      qaror_vaqti_sek:    elapsed > 0 ? elapsed : '',
      izoh:               '',
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Server xatosi' }, { status: 500 });
  }
}
