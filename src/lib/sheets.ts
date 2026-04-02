import { google } from 'googleapis';

const SHEET_ID = '1SGhDyKCbi-mPphOiihzKfe3IE0zVRBchtM_Ke9VC8R8';
const SHEET_NAME = 'Case Log';

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Barcha case'larni o'qish
export async function getAllCases() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A4:S`,
  });

  const rows = res.data.values || [];
  return rows.map((row) => ({
    caseId:        row[0]  || '',
    sana:          row[1]  || '',
    shifokor:      row[2]  || '',
    yosh:          row[3]  || '',
    jins:          row[4]  || '',
    mexanizm:      row[5]  || '',
    gcs:           row[6]  || '',
    gcsStimuli:    row[7]  || '',
    ktNatijasi:    row[8]  || '',
    gematoma:      row[9]  || '',
    siljish:       row[10] || '',
    antikoagulyant:row[11] || '',
    xulosasi:      row[12] || '',
    triggerQoida:  row[13] || '',
    shifokorQarori:row[14] || '',
    mosKeldi:      row[15] || '',
    mosKelmaslik:  row[16] || '',
    qarorVaqt:     row[17] || '',
    izoh:          row[18] || '',
  }));
}

// Yangi case qo'shish
export async function appendCase(data: {
  caseId: string;
  sana: string;
  shifokor: string;
  yosh: string | number;
  jins: string;
  mexanizm: string;
  gcs: string;
  gcsStimuli: string;
  ktNatijasi: string;
  gematoma?: string;
  siljish?: string;
  antikoagulyant: string;
  xulosasi: string;
  triggerQoida?: string;
  shifokorQarori?: string;
  mosKeldi?: string;
  mosKelmaslik?: string;
  qarorVaqt?: string;
  izoh?: string;
}) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A4`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        data.caseId,
        data.sana,
        data.shifokor,
        data.yosh,
        data.jins,
        data.mexanizm,
        data.gcs,
        data.gcsStimuli,
        data.ktNatijasi,
        data.gematoma    || '',
        data.siljish     || '',
        data.antikoagulyant,
        data.xulosasi,
        data.triggerQoida   || '',
        data.shifokorQarori || '',
        data.mosKeldi       || '',
        data.mosKelmaslik   || '',
        data.qarorVaqt      || '',
        data.izoh           || '',
      ]],
    },
  });
}

// Case ID bo'yicha yangilash
export async function updateCaseByRow(rowIndex: number, updates: Partial<ReturnType<typeof getAllCases extends Promise<infer T> ? T : never>>) {
  const sheets = await getSheetsClient();
  const cases = await getAllCases();
  const existing = cases[rowIndex];
  const merged = { ...existing, ...updates };

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A${rowIndex + 4}:S${rowIndex + 4}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        merged.caseId, merged.sana, merged.shifokor, merged.yosh,
        merged.jins, merged.mexanizm, merged.gcs, merged.gcsStimuli,
        merged.ktNatijasi, merged.gematoma, merged.siljish,
        merged.antikoagulyant, merged.xulosasi, merged.triggerQoida,
        merged.shifokorQarori, merged.mosKeldi, merged.mosKelmaslik,
        merged.qarorVaqt, merged.izoh,
      ]],
    },
  });
}