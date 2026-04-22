// api/analyze/route.ts — AlgoriMed v2.5
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

    const result = analyze(input);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Server xatosi' }, { status: 500 });
  }
}
