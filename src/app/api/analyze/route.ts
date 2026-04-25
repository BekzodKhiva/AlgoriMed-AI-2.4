// api/analyze/route.ts — AlgoriMed v2.8
// Faqat engine ni ishga tushiradi va natijani qaytaradi.
// Sheets ga yozish: result sahifasidagi /api/sheets route orqali (bir marta, duplicate yo'q)

import { NextRequest, NextResponse } from 'next/server';
import { analyze } from '@/lib/engine';
import { ClinicalInput } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input: ClinicalInput & {
      otherMechanismLabel?: string;
      doctorName?:          string;
      doctorRole?:          string;
      hospital?:            string;
    } = body;

    // ── MAJBURIY MAYDONLAR ────────────────────────────────────────────
    if (!input.age || !input.sex || !input.gcs) {
      return NextResponse.json({ error: "Majburiy maydonlar to'ldirilmagan" }, { status: 400 });
    }

    // ── YOSH VALIDATSIYA ──────────────────────────────────────────────
    if (!Number.isFinite(input.age) || input.age < 0 || input.age > 120) {
      return NextResponse.json({ error: "Yosh noto'g'ri (0–120 oralig'ida bo'lishi kerak)" }, { status: 400 });
    }

    // ── GCS VALIDATSIYA ───────────────────────────────────────────────
    if (
      !Number.isInteger(input.gcs.eye)    || input.gcs.eye    < 1 || input.gcs.eye    > 4 ||
      !Number.isInteger(input.gcs.verbal) || input.gcs.verbal < 1 || input.gcs.verbal > 5 ||
      !Number.isInteger(input.gcs.motor)  || input.gcs.motor  < 1 || input.gcs.motor  > 6
    ) {
      return NextResponse.json({ error: "GCS qiymatlari noto'g'ri (E:1-4, V:1-5, M:1-6)" }, { status: 400 });
    }

    // ── VITAL SIGNS VALIDATSIYA (ixtiyoriy, lekin kiritilsa to'g'ri bo'lishi shart) ──
    if (input.sbp !== undefined && input.sbp !== null) {
      if (!Number.isFinite(input.sbp) || input.sbp < 0 || input.sbp > 300) {
        return NextResponse.json({ error: "SBP noto'g'ri (0–300 mmHg)" }, { status: 400 });
      }
    }
    if (input.spO2 !== undefined && input.spO2 !== null) {
      if (!Number.isFinite(input.spO2) || input.spO2 < 0 || input.spO2 > 100) {
        return NextResponse.json({ error: "SpO2 noto'g'ri (0–100%)" }, { status: 400 });
      }
    }
    if (input.respiratoryRate !== undefined && input.respiratoryRate !== null) {
      if (!Number.isFinite(input.respiratoryRate) || input.respiratoryRate < 0 || input.respiratoryRate > 60) {
        return NextResponse.json({ error: "Nafas tezligi noto'g'ri (0–60 nafas/daqiqa)" }, { status: 400 });
      }
    }

    // ── CT HAJM VALIDATSIYA ───────────────────────────────────────────
    if (input.hematomaVolume !== undefined && input.hematomaVolume !== null) {
      if (!Number.isFinite(input.hematomaVolume) || input.hematomaVolume < 0 || input.hematomaVolume > 200) {
        return NextResponse.json({ error: "Gematoma hajmi noto'g'ri (0–200 ml)" }, { status: 400 });
      }
    }
    if (input.contusionVolume !== undefined && input.contusionVolume !== null) {
      if (!Number.isFinite(input.contusionVolume) || input.contusionVolume < 0 || input.contusionVolume > 200) {
        return NextResponse.json({ error: "Kontuziya hajmi noto'g'ri (0–200 ml)" }, { status: 400 });
      }
    }
    if (input.midlineShift !== undefined && input.midlineShift !== null) {
      if (!Number.isFinite(input.midlineShift) || input.midlineShift < 0 || input.midlineShift > 30) {
        return NextResponse.json({ error: "O'rta chiziq siljishi noto'g'ri (0–30 mm)" }, { status: 400 });
      }
    }
    if (input.hematomaThickness !== undefined && input.hematomaThickness !== null) {
      if (!Number.isFinite(input.hematomaThickness) || input.hematomaThickness < 0 || input.hematomaThickness > 50) {
        return NextResponse.json({ error: "Gematoma qalinligi noto'g'ri (0–50 mm)" }, { status: 400 });
      }
    }

    // ── SEX + HOMILADORLIK MANTIQ ─────────────────────────────────────
    if (input.sex === 'male') input.pregnancy = false;

    const result = analyze(input);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Server xatosi' }, { status: 500 });
  }
}
