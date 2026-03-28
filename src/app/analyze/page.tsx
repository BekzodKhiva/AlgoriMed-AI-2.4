'use client';
import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { ClinicalInput } from '@/lib/types';
import styles from './analyze.module.css';

interface UserData { id: string; name: string; role: string; hospital: string; }

const defaultInput = (): ClinicalInput => ({
  age: 30, sex: 'male', pregnancy: false,
  traumaMechanism: 'direct_blow',
  alcoholIntoxication: false, anticoagulant: false,
  sbp: undefined, spO2: undefined, respiratoryRate: undefined,
  complaints: { headache: false, dizziness: false, nausea: false, vomiting: 'none', seizure: false, weakness: false, nystagmus: false, chestPain: false, abdominalPain: false, limbPain: false, backPain: false },
  gcs: { eye: 4, verbal: 5, motor: 6 },
  anisocoria: 'none',
  cranialNerves: { cn3: 'N', cn4: 'N', cn5: 'N', cn6: 'N', cn7: 'N', cn8: 'N', cn9: 'N', cn10: 'N', cn11: 'N', cn12: 'N', cn1: 'N', cn2: 'N' },
  meningealSigns: { neckStiffness: false, kernig: false, brudzinski: false },
  cchrAdditional: { gcsLessThan15at2hrs: false, suspectedOpenFracture: false, basalSkullFracture: false },
  ctResult: 'not_done',
  hematomaType: undefined, hematomaVolume: undefined, hematomaThickness: undefined, midlineShift: undefined,
  diabetes: false, hypertensionHistory: false,
  comorbidities: [],
});

// ── GCS MA'LUMOTLARI ──────────────────────────────────────────────────────────
const EYE_OPTIONS = [
  { val: 1, label: "Ko'z ochilmaydi", sub: "Hech qanday stimulga javob yo'q" },
  { val: 2, label: "Og'riqqa ochiladi", sub: "Faqat og'riq stimulida" },
  { val: 3, label: "So'zga ochiladi", sub: "Ovozli buyruqqa javoban" },
  { val: 4, label: "O'z-o'zidan ochiq", sub: "Spontan, buyruqsiz" },
];
const VERBAL_OPTIONS = [
  { val: 1, label: "Javob yo'q", sub: "Tovush chiqarmaydi" },
  { val: 2, label: "Tushunarsiz tovushlar", sub: "So'z emas, ovoz" },
  { val: 3, label: "Alohida so'zlar", sub: "So'z aytadi, gap emas" },
  { val: 4, label: "Chalkash nutq", sub: "Gap aytadi, lekin to'liq emas" },
  { val: 5, label: "To'liq, aniq javob", sub: "Orientatsiya to'liq" },
];
const MOTOR_OPTIONS = [
  { val: 1, label: "Harakat yo'q", sub: "Hech qanday javob yo'q" },
  { val: 2, label: "Uzayish (dezertsiatsiya)", sub: "Patologik uzayish" },
  { val: 3, label: "Bukish (dekortikatsiya)", sub: "Patologik bukish" },
  { val: 4, label: "Tortishish (withdrawal)", sub: "Og'riqdan qochish" },
  { val: 5, label: "Lokalizatsiya", sub: "Og'riq joyiga qarab" },
  { val: 6, label: "Buyruqqa bo'ysunadi", sub: "To'liq harakat" },
];

// ── 12 KRANIAL NERV ───────────────────────────────────────────────────────────
const CRANIAL_NERVES = [
  { id: 'cn1',  num: 'I',    name: 'Hid sezish',              latin: 'N. olfactorius',        urgency: 'monitor',   desc: 'Frontal qism jarohati' },
  { id: 'cn2',  num: 'II',   name: "Ko'rish",                 latin: 'N. opticus',            urgency: 'moderate',  desc: 'Optik jarohat → oftalmolog' },
  { id: 'cn3',  num: 'III',  name: "Qorachiq / ko'z harakat", latin: 'N. oculomotorius',      urgency: 'emergency', desc: 'Herniatsiya belgisi → FAVQULODDA' },
  { id: 'cn4',  num: 'IV',   name: "Ko'z (pastga)",           latin: 'N. trochlearis',        urgency: 'high',      desc: "Beyin o'qi jarohati → CT" },
  { id: 'cn5',  num: 'V',    name: 'Yuz sezgisi / chaynash',  latin: 'N. trigeminus',         urgency: 'monitor',   desc: 'Suyak sinishi → kuzatish' },
  { id: 'cn6',  num: 'VI',   name: "Ko'z (lateral)",          latin: 'N. abducens',           urgency: 'high',      desc: 'ICP oshishi belgisi → CT' },
  { id: 'cn7',  num: 'VII',  name: 'Yuz mushaklari',          latin: 'N. facialis',           urgency: 'high',      desc: 'Asos suyagi sinishi → CCHR H3' },
  { id: 'cn8',  num: 'VIII', name: 'Eshitish / muvozanat',    latin: 'N. vestibulocochlearis', urgency: 'moderate', desc: 'Temporal suyak → CT' },
  { id: 'cn9',  num: 'IX',   name: "Yutish / ta'm",           latin: 'N. glossopharyngeus',   urgency: 'monitor',   desc: "Posterior fossa → kuzatish" },
  { id: 'cn10', num: 'X',    name: 'Ovoz / vagus',            latin: 'N. vagus',              urgency: 'monitor',   desc: "Posterior fossa → kuzatish" },
  { id: 'cn11', num: 'XI',   name: "Bo'yin / yelka",          latin: 'N. accessorius',        urgency: 'monitor',   desc: "Posterior fossa → kuzatish" },
  { id: 'cn12', num: 'XII',  name: 'Til harakati',            latin: 'N. hypoglossus',        urgency: 'monitor',   desc: "Posterior fossa → kuzatish" },
];

const CN_URGENCY_COLOR: Record<string, { color: string; bg: string; label: string }> = {
  emergency: { color: '#A32D2D', bg: '#FCEBEB', label: 'FAVQULODDA' },
  high:      { color: '#993C1D', bg: '#FAECE7', label: 'YUQORI' },
  moderate:  { color: '#854F0B', bg: '#FAEEDA', label: "O'RTACHA" },
  monitor:   { color: '#185FA5', bg: '#E6F1FB', label: 'KUZATISH' },
};

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={styles.checkbox}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className={styles.checkmark} />
      <span className={styles.checkLabel}>{label}</span>
    </label>
  );
}

function GcsCard({ options, value, onChange, title }: {
  options: { val: number; label: string; sub: string }[];
  value: number;
  onChange: (v: number) => void;
  title: string;
}) {
  return (
    <div className={styles.gcsCardGroup}>
      <div className={styles.gcsCardTitle}>{title}</div>
      <div className={styles.gcsCardList}>
        {options.map(o => (
          <button
            key={o.val}
            type="button"
            className={`${styles.gcsCard} ${value === o.val ? styles.gcsCardActive : ''}`}
            onClick={() => onChange(o.val)}
          >
            <div className={styles.gcsCardNum}>{o.val}</div>
            <div className={styles.gcsCardBody}>
              <div className={styles.gcsCardLabel}>{o.label}</div>
              <div className={styles.gcsCardSub}>{o.sub}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AnalyzePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [form, setForm] = useState<ClinicalInput>(defaultInput());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);
  const [otherMechanism, setOtherMechanism] = useState('');
  const TOTAL_STEPS = 5;

  useEffect(() => {
    const cookie = document.cookie.split(';').find(c => c.trim().startsWith('algorimed_user='));
    if (!cookie) { router.replace('/login'); return; }
    try { setUser(JSON.parse(decodeURIComponent(cookie.split('=').slice(1).join('=')))); }
    catch { router.replace('/login'); }
  }, [router]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  function set<K extends keyof ClinicalInput>(key: K, val: ClinicalInput[K]) {
    setForm(f => ({ ...f, [key]: val }));
  }
  function setComplaints<K extends keyof ClinicalInput['complaints']>(key: K, val: ClinicalInput['complaints'][K]) {
    setForm(f => ({ ...f, complaints: { ...f.complaints, [key]: val } }));
  }
  function setGcs<K extends keyof ClinicalInput['gcs']>(key: K, val: number) {
    setForm(f => ({ ...f, gcs: { ...f.gcs, [key]: val } }));
  }
  function setMeningeal<K extends keyof ClinicalInput['meningealSigns']>(key: K, val: boolean) {
    setForm(f => ({ ...f, meningealSigns: { ...f.meningealSigns, [key]: val } }));
  }
  function setCchr<K extends keyof ClinicalInput['cchrAdditional']>(key: K, val: boolean) {
    setForm(f => ({ ...f, cchrAdditional: { ...f.cchrAdditional, [key]: val } }));
  }
  function setCn(key: string, val: 'N' | 'P') {
    setForm(f => ({ ...f, cranialNerves: { ...f.cranialNerves, [key]: val } }));
  }
  function setVital<K extends 'sbp' | 'spO2' | 'respiratoryRate'>(key: K, val: number | undefined) {
    setForm(f => ({ ...f, [key]: val }));
  }

  const gcsTotal = form.gcs.eye + form.gcs.verbal + form.gcs.motor;
  const gcsSeverity =
    gcsTotal >= 13 ? { label: 'Yengil', color: '#27ae60' } :
    gcsTotal >= 9  ? { label: "O'rta",  color: '#e67e22' } :
    gcsTotal >= 6  ? { label: "Og'ir",  color: '#c0392b' } :
                     { label: 'Kritik', color: '#8e0000' };

  // Patologik kranial nervlar
  const pathoCN = CRANIAL_NERVES.filter(n => form.cranialNerves[n.id as keyof typeof form.cranialNerves] === 'P');
  const hasCNEmergency = pathoCN.some(n => n.urgency === 'emergency');
  const hasCNHigh = pathoCN.some(n => n.urgency === 'high');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          otherMechanismLabel: form.traumaMechanism === 'other' ? otherMechanism : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Xato yuz berdi'); setLoading(false); return; }
      sessionStorage.setItem('algorimed_result', JSON.stringify(data));
      const raw = sessionStorage.getItem('algorimed_history');
      const hist = raw ? JSON.parse(raw) : [];
      hist.push({ id: Date.now().toString(), ...data });
      sessionStorage.setItem('algorimed_history', JSON.stringify(hist));
      router.push('/result');
    } catch {
      setError("Tarmoq xatosi. Iltimos qayta urinib ko'ring.");
      setLoading(false);
    }
  }

  if (!user) return null;

  return (
    <div className={styles.page}>
      <Navbar doctorName={user.name} doctorRole={user.role} active="analyze" />

      <main className={styles.main}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Yangi TBI Tahlili</h1>
            <p className={styles.sub}>Barcha maydonlarni to&apos;ldiring — tizim avtomatik hisoblaydi</p>
          </div>
          <div className={styles.stepIndicator}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <button key={i} type="button"
                className={`${styles.stepDot} ${step === i+1 ? styles.stepDotActive : ''} ${step > i+1 ? styles.stepDotDone : ''}`}
                onClick={() => setStep(i+1)}>
                {step > i+1 ? '✓' : i+1}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>

          {/* ── QADAM 1: BEMOR MA'LUMOTLARI ── */}
          {step === 1 && (
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>1-qadam: Bemor ma&apos;lumotlari</div>

              {/* Asosiy */}
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Asosiy ma&apos;lumotlar</h3>
                <div className={styles.row2}>
                  <div className={styles.field}>
                    <label className={styles.label}>Yosh</label>
                    <input type="number" className={styles.input} min={0} max={120}
                      value={form.age} onChange={e => set('age', parseInt(e.target.value) || 0)} />
                    {form.age >= 65 && <span className={styles.hint}>⚠️ 65+ yosh — CCHR yuqori xavf</span>}
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Jins</label>
                    <div className={styles.segmented}>
                      {(['male','female'] as const).map(s => (
                        <button key={s} type="button"
                          className={`${styles.seg} ${form.sex === s ? styles.segActive : ''}`}
                          onClick={() => set('sex', s)}>
                          {s === 'male' ? '♂ Erkak' : '♀ Ayol'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {form.sex === 'female' && (
                  <div style={{ marginTop: 12 }}>
                    <Checkbox label="Homiladorlik" checked={form.pregnancy} onChange={v => set('pregnancy', v)} />
                  </div>
                )}
              </div>

              {/* Travma mexanizmi */}
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Travma mexanizmi</h3>
                <div className={styles.mechGrid}>
                  {([
                    ['fall_height',   '🪜', 'Balandlikdan yiqilish'],
                    ['road_accident', '🚗', "Yo'l-transport hodisasi"],
                    ['direct_blow',   '👊', "To'g'ridan-to'g'ri zarba"],
                    ['sports',        '⚽', 'Sport jarohati'],
                    ['other',         '❓', 'Boshqa'],
                  ] as const).map(([val, icon, name]) => (
                    <button key={val} type="button"
                      className={`${styles.mechBtn} ${form.traumaMechanism === val ? styles.mechBtnActive : ''}`}
                      onClick={() => set('traumaMechanism', val)}>
                      <span className={styles.mechIcon}>{icon}</span>
                      <span className={styles.mechName}>{name}</span>
                    </button>
                  ))}
                </div>
                {form.traumaMechanism === 'other' && (
                  <div className={styles.field} style={{ marginTop: 14 }}>
                    <label className={styles.label}>Travma mexanizmini aniqlashtiring</label>
                    <input type="text" className={styles.input}
                      placeholder="Masalan: qurol yarasi, portlash, siqilish..."
                      value={otherMechanism} onChange={e => setOtherMechanism(e.target.value)} autoFocus />
                  </div>
                )}
              </div>

              {/* Tibbiy anamnez */}
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Tibbiy anamnez</h3>
                <div className={styles.checkGrid} style={{ marginBottom: 16 }}>
                  <Checkbox label="Antikoagulyant terapiya" checked={form.anticoagulant} onChange={v => set('anticoagulant', v)} />
                  <Checkbox label="Alkogol intoksikatsiyasi" checked={form.alcoholIntoxication} onChange={v => set('alcoholIntoxication', v)} />
                </div>

                <label className={styles.label} style={{ marginBottom: 8, display: 'block' }}>
                  Surunkali kasalliklar <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(bir nechtasini tanlash mumkin)</span>
                </label>
                <div className={styles.comorbGrid}>
                  {([
                    // Klinik qarorga ta'sir qiladiganlar
                    { id: 'diabetes',          label: 'Qandli diabet',                  group: 'clinical', hint: '' },
                    { id: 'hypertension',      label: 'Gipertenziya',                   group: 'clinical', hint: '' },
                    { id: 'coagulopathy',      label: 'Koagulopatiya / jigar sirrozi',  group: 'clinical', hint: '⚠️ Qon ketish xavfi' },
                    { id: 'epilepsy',          label: 'Epilepsiya tarixi',              group: 'clinical', hint: '⚠️ Tutqanoq xavfi' },
                    { id: 'stroke',            label: "Insult / TIA tarixi",            group: 'clinical', hint: '⚠️ GCS bazali past bo\'lishi mumkin' },
                    { id: 'dementia',          label: 'Demensiya',                      group: 'clinical', hint: '⚠️ GCS bazali noaniq' },
                    { id: 'heart_failure',     label: 'Yurak yetishmovchiligi',         group: 'clinical', hint: '⚠️ Gipotenziya xavfi' },
                    { id: 'copd',              label: "Surunkali o'pka kasalligi (COPD)", group: 'clinical', hint: '⚠️ Gipoksiya xavfi' },
                    // Faqat ma'lumot uchun
                    { id: 'cancer',            label: 'Onkologik kasallik',             group: 'info', hint: '' },
                    { id: 'renal',             label: 'Buyrak yetishmovchiligi',        group: 'info', hint: '' },
                    { id: 'immunosuppression', label: 'Immunosupressiya',               group: 'info', hint: '' },
                    { id: 'psychiatric',       label: 'Psixiatrik kasallik tarixi',     group: 'info', hint: '' },
                    { id: 'rheumatoid',        label: 'Reumatoid artrit',              group: 'info', hint: '' },
                  ]).map(c => {
                    const selected = form.comorbidities.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={`${styles.comorbBtn} ${selected ? styles.comorbBtnActive : ''} ${c.group === 'clinical' && selected ? styles.comorbBtnClinical : ''}`}
                        onClick={() => {
                          const next = selected
                            ? form.comorbidities.filter(x => x !== c.id)
                            : [...form.comorbidities, c.id];
                          set('comorbidities', next);
                          // diabetes va hypertension backcompat
                          set('diabetes', next.includes('diabetes'));
                          set('hypertensionHistory', next.includes('hypertension'));
                        }}
                      >
                        <span className={styles.comorbCheck}>{selected ? '✓' : ''}</span>
                        <span className={styles.comorbLabel}>{c.label}</span>
                        {c.hint && <span className={styles.comorbHint}>{c.hint}</span>}
                      </button>
                    );
                  })}
                </div>
                {form.comorbidities.length > 0 && (
                  <div className={styles.comorbSelected}>
                    Tanlangan: <strong>{form.comorbidities.length} ta</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── QADAM 2: GCS VA KLINIK ── */}
          {step === 2 && (
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>2-qadam: GCS va klinik ko&apos;rsatkichlar</div>

              {/* Shikoyatlar */}
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Shikoyatlar</h3>
                <div className={styles.checkGrid}>
                  <Checkbox label="Bosh og'riq" checked={form.complaints.headache} onChange={v => setComplaints('headache', v)} />
                  <Checkbox label="Bosh aylanishi" checked={form.complaints.dizziness} onChange={v => setComplaints('dizziness', v)} />
                  <Checkbox label="Ko'ngil aynishi" checked={form.complaints.nausea} onChange={v => setComplaints('nausea', v)} />
                  <Checkbox label="Tutqanoq" checked={form.complaints.seizure} onChange={v => setComplaints('seizure', v)} />
                  <Checkbox label="Umumiy holsizlik" checked={form.complaints.weakness} onChange={v => setComplaints('weakness', v)} />
                </div>
                <div className={styles.field} style={{ marginTop: 16 }}>
                  <label className={styles.label}>Qusish</label>
                  <div className={styles.segmented}>
                    {([["none","Yo'q"],["once","1 marta"],["repeated","Qayta-qayta"]] as const).map(([val,lbl]) => (
                      <button key={val} type="button"
                        className={`${styles.seg} ${form.complaints.vomiting === val ? styles.segActive : ''}`}
                        onClick={() => setComplaints('vomiting', val)}>{lbl}</button>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  <Checkbox
                    label="Ko'z tebranishi (nistagm) — vestibulo-okulyar tekshiruv natijasi"
                    checked={form.complaints.nystagmus}
                    onChange={v => setComplaints('nystagmus', v)}
                  />
                  {form.complaints.nystagmus && (
                    <div style={{ fontSize: 12, color: '#854F0B', marginTop: 4, marginLeft: 28 }}>
                      Temporal suyak / vestibulyar jarohat ehtimoli — CT ko'rsatmasi
                    </div>
                  )}
                </div>
              </div>

              {/* GCS — kartochkalar */}
              <div className={styles.card}>
                <div className={styles.gcsHeader}>
                  <h3 className={styles.cardTitle}>Glasgow Coma Scale (GCS)</h3>
                  <div className={styles.gcsTotalBox}>
                    <span className={styles.gcsTotalNum} style={{ color: gcsSeverity.color }}>{gcsTotal}</span>
                    <span className={styles.gcsTotalMax}>/15</span>
                    <span className={styles.gcsTotalLabel} style={{ color: gcsSeverity.color }}>{gcsSeverity.label}</span>
                  </div>
                </div>
                <GcsCard title="Ko'z ochilishi (E)" options={EYE_OPTIONS} value={form.gcs.eye} onChange={v => setGcs('eye', v)} />
                <GcsCard title="Verbal javob (V)" options={VERBAL_OPTIONS} value={form.gcs.verbal} onChange={v => setGcs('verbal', v)} />
                <GcsCard title="Harakat (M)" options={MOTOR_OPTIONS} value={form.gcs.motor} onChange={v => setGcs('motor', v)} />
              </div>

              {/* Nevrologik */}
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Nevrologik tekshiruv</h3>
                <div className={styles.field}>
                  <label className={styles.label}>Ko&apos;z qorachig&apos;i (Anizokoria)</label>
                  <div className={styles.segmented}>
                    {([[`none`,"Yo'q"],[`right`,"O'ng"],[`left`,"Chap"]] as const).map(([val,lbl]) => (
                      <button key={val} type="button"
                        className={`${styles.seg} ${form.anisocoria === val ? styles.segActive : ''}`}
                        onClick={() => set('anisocoria', val)}>{lbl}</button>
                    ))}
                  </div>
                  {form.anisocoria !== 'none' && (
                    <span className={styles.hintDanger}>⚠️ Anizokoria — transtentorial herniatsiya ehtimoli. FAVQULODDA neyrojarrohlik baholash + shoshilinch KT zarur</span>
                  )}
                </div>
                <div className={styles.field} style={{ marginTop: 14 }}>
                  <label className={styles.label}>Meningeal belgilar</label>
                  <div className={styles.checkRow}>
                    <Checkbox label="Bo'yin qattiqligi" checked={form.meningealSigns.neckStiffness} onChange={v => setMeningeal('neckStiffness', v)} />
                    <Checkbox label="Kernig belgisi" checked={form.meningealSigns.kernig} onChange={v => setMeningeal('kernig', v)} />
                    <Checkbox label="Brudzinskiy belgisi" checked={form.meningealSigns.brudzinski} onChange={v => setMeningeal('brudzinski', v)} />
                  </div>
                </div>
              </div>

              {/* 12 Kranial nerv */}
              <div className={styles.card}>
                <div className={styles.cnHeader}>
                  <h3 className={styles.cardTitle}>12 Kranial nerv tekshiruvi</h3>
                  <div className={styles.cnLegend}>
                    <span className={styles.cnLegendN}>N — Normal</span>
                    <span className={styles.cnLegendP}>P — Patologik</span>
                  </div>
                </div>
                {pathoCN.length > 0 && (
                  <div className={styles.cnAlert} style={{
                    background: hasCNEmergency ? '#FCEBEB' : hasCNHigh ? '#FAECE7' : '#FAEEDA',
                    borderColor: hasCNEmergency ? '#A32D2D' : hasCNHigh ? '#993C1D' : '#854F0B',
                    color: hasCNEmergency ? '#A32D2D' : hasCNHigh ? '#993C1D' : '#854F0B',
                  }}>
                    {hasCNEmergency ? '🚨 FAVQULODDA' : hasCNHigh ? '⚠️ YUQORI XAVF' : '⚠️ Kuzatish kerak'} — CN {pathoCN.map(n => n.num).join(', ')} patologik
                  </div>
                )}
                <div className={styles.cnGrid}>
                  {CRANIAL_NERVES.map(n => {
                    const cfg = CN_URGENCY_COLOR[n.urgency];
                    const val = form.cranialNerves[n.id as keyof typeof form.cranialNerves];
                    const isP = val === 'P';
                    return (
                      <div key={n.id} className={styles.cnCard}
                        style={{ borderColor: isP ? cfg.color : 'var(--border)', background: isP ? cfg.bg : 'var(--bg)' }}>
                        <div className={styles.cnTop}>
                          <div>
                            <div className={styles.cnNum}>CN {n.num}</div>
                            <div className={styles.cnName}>{n.name}</div>
                            <div className={styles.cnLatin}>{n.latin}</div>
                          </div>
                          <span className={styles.cnBadge}
                            style={{ background: cfg.bg, color: cfg.color }}>
                            {cfg.label}
                          </span>
                        </div>
                        <div className={styles.cnBtns}>
                          <button type="button"
                            className={`${styles.cnBtn} ${val === 'N' ? styles.cnBtnN : ''}`}
                            onClick={() => setCn(n.id, 'N')}>N</button>
                          <button type="button"
                            className={`${styles.cnBtn} ${val === 'P' ? styles.cnBtnP : ''}`}
                            style={val === 'P' ? { background: cfg.color, borderColor: cfg.color, color: 'white' } : {}}
                            onClick={() => setCn(n.id, 'P')}>P</button>
                        </div>
                        {isP && <div className={styles.cnDesc}>{n.desc}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}


          {/* ── QADAM 3: VITAL BELGILAR VA POLITRAVMA ── */}
          {step === 3 && (
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>3-qadam: Vital belgilar va qo&apos;shimcha jarohatlar</div>

              {/* Vital signs */}
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Vital belgilar</h3>
                <p className={styles.cardDesc}>RTS (Boyd 1987) · IMPACT model · BTF 2023 · ACS TBI 2024</p>

                <div className={styles.row2} style={{ marginBottom: 16 }}>
                  {/* SBP */}
                  <div className={styles.field}>
                    <label className={styles.label}>
                      Sistolik qon bosim (SBP) <span style={{ color: 'var(--muted)', fontWeight: 400 }}>mmHg</span>
                    </label>
                    <input
                      type="number" className={styles.input} min={0} max={300}
                      placeholder="masalan: 120"
                      value={form.sbp ?? ''}
                      onChange={e => setVital('sbp', e.target.value ? parseInt(e.target.value) : undefined)}
                    />
                    {form.sbp !== undefined && form.sbp < 90 && (
                      <span className={styles.hintDanger}>🚨 KRITIK: SBP &lt; 90 mmHg — gipotenziya (OR o'lim 4.36)</span>
                    )}
                    {form.sbp !== undefined && form.sbp >= 90 && form.sbp < 110 && (
                      <span className={styles.hint}>⚠️ Xavfli zona: SBP &lt; 110 mmHg (maqsad ≥110)</span>
                    )}
                    {form.sbp !== undefined && form.sbp >= 110 && (
                      <span style={{ color: '#27ae60', fontSize: 12 }}>✓ Maqsad SBP ≥110 mmHg</span>
                    )}
                  </div>

                  {/* SpO2 */}
                  <div className={styles.field}>
                    <label className={styles.label}>
                      Oksigen saturatsiyasi (SpO2) <span style={{ color: 'var(--muted)', fontWeight: 400 }}>%</span>
                    </label>
                    <input
                      type="number" className={styles.input} min={0} max={100}
                      placeholder="masalan: 98"
                      value={form.spO2 ?? ''}
                      onChange={e => setVital('spO2', e.target.value ? parseInt(e.target.value) : undefined)}
                    />
                    {form.spO2 !== undefined && form.spO2 < 90 && (
                      <span className={styles.hintDanger}>🚨 KRITIK: SpO2 &lt; 90% — gipoksiya (OR o'lim 3.86)</span>
                    )}
                    {form.spO2 !== undefined && form.spO2 >= 90 && form.spO2 < 94 && (
                      <span className={styles.hint}>⚠️ Xavfli zona: SpO2 &lt; 94% (maqsad ≥94%)</span>
                    )}
                    {form.spO2 !== undefined && form.spO2 >= 94 && (
                      <span style={{ color: '#27ae60', fontSize: 12 }}>✓ Maqsad SpO2 ≥94%</span>
                    )}
                  </div>
                </div>

                {/* Nafas tezligi */}
                <div className={styles.field}>
                  <label className={styles.label}>
                    Nafas tezligi <span style={{ color: 'var(--muted)', fontWeight: 400 }}>nafas/daqiqa (ixtiyoriy)</span>
                  </label>
                  <input
                    type="number" className={styles.input} min={0} max={60}
                    placeholder="masalan: 16"
                    value={form.respiratoryRate ?? ''}
                    onChange={e => setVital('respiratoryRate', e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                  {form.respiratoryRate !== undefined && (form.respiratoryRate < 10 || form.respiratoryRate > 29) && (
                    <span className={styles.hint}>⚠️ Anormal nafas: {form.respiratoryRate < 10 ? 'bradipnoe' : 'taxipnoe'} — RTS pasaygan</span>
                  )}
                </div>

                {/* RTS ko'rsatkichi */}
                {form.sbp !== undefined && form.respiratoryRate !== undefined && (
                  <div style={{
                    marginTop: 16, padding: '10px 14px', borderRadius: 8,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 12
                  }}>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>Taxminiy RTS:</span>
                    {(() => {
                      const gcsK = gcsTotal >= 13 ? 4 : gcsTotal >= 9 ? 3 : gcsTotal >= 6 ? 2 : gcsTotal >= 4 ? 1 : 0;
                      const sbpK = (form.sbp ?? 0) > 89 ? 4 : (form.sbp ?? 0) > 75 ? 3 : (form.sbp ?? 0) > 49 ? 2 : (form.sbp ?? 0) > 0 ? 1 : 0;
                      const rrK  = (form.respiratoryRate ?? 0) >= 10 && (form.respiratoryRate ?? 0) <= 29 ? 4 :
                                   (form.respiratoryRate ?? 0) > 29 ? 3 : (form.respiratoryRate ?? 0) >= 6 ? 2 :
                                   (form.respiratoryRate ?? 0) >= 1 ? 1 : 0;
                      const rts = Math.round((0.9368 * gcsK + 0.7326 * sbpK + 0.2908 * rrK) * 100) / 100;
                      const rtsColor = rts >= 7 ? '#27ae60' : rts >= 5 ? '#e67e22' : '#c0392b';
                      return (
                        <>
                          <strong style={{ color: rtsColor, fontSize: 18 }}>{rts}</strong>
                          <span style={{ fontSize: 12, color: rtsColor }}>
                            {rts >= 7 ? '— Yaxshi' : rts >= 5 ? "— O'rta xavf" : '— YUQORI XAVF (norma: 7.84)'}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Gipoksiya + Gipotenziya ogohlantirish */}
                {form.sbp !== undefined && form.sbp < 90 && form.spO2 !== undefined && form.spO2 < 90 && (
                  <div style={{
                    marginTop: 12, padding: '12px 16px', borderRadius: 8,
                    background: '#FCEBEB', border: '2px solid #A32D2D', color: '#A32D2D'
                  }}>
                    🚨 <strong>SINERGISTIK IKKILAMCHI JAROHAT</strong> — Gipoksiya + Gipotenziya birgalikda: 14x o'lim xavfi (EPIC Study 2021, adjusted OR 6.1)
                  </div>
                )}
              </div>

              {/* Politravma shikoyatlari */}
              <div className={styles.card}>
                <h3 className={styles.cardTitle}>Qo&apos;shimcha jarohatlar — boshqa soha shikoyatlari</h3>
                <p className={styles.cardDesc}>WSES 2019/2020 · CRASH model · cABCDE Primary Survey</p>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
                  Bosh miyadan tashqari jarohat belgilari — TBI boshqaruvini o'zgartiradi
                </p>
                <div className={styles.checkGrid}>
                  <Checkbox
                    label="🫁 Ko'krak og'rig'i / nafas qiyinligi"
                    checked={form.complaints.chestPain}
                    onChange={v => setComplaints('chestPain', v)}
                  />
                  <Checkbox
                    label="🫃 Qorin og'rig'i / sezgirligi"
                    checked={form.complaints.abdominalPain}
                    onChange={v => setComplaints('abdominalPain', v)}
                  />
                  <Checkbox
                    label="🦴 Qo'l/oyoq og'rig'i / deformatsiyasi"
                    checked={form.complaints.limbPain}
                    onChange={v => setComplaints('limbPain', v)}
                  />
                  <Checkbox
                    label="🦶 Bel/umurtqa og'rig'i"
                    checked={form.complaints.backPain}
                    onChange={v => setComplaints('backPain', v)}
                  />
                </div>

                {(form.complaints.chestPain || form.complaints.abdominalPain || form.complaints.limbPain || form.complaints.backPain) && (
                  <div style={{
                    marginTop: 14, padding: '10px 14px', borderRadius: 8,
                    background: '#FAEEDA', border: '1px solid #854F0B', color: '#854F0B', fontSize: 13
                  }}>
                    Qo&apos;shimcha jarohatlar aniqlandi:{' '}
                    <strong>
                      {[
                        form.complaints.chestPain && "Ko'krak",
                        form.complaints.abdominalPain && 'Qorin',
                        form.complaints.limbPain && "Qo'l/oyoq",
                        form.complaints.backPain && 'Bel/umurtqa',
                      ].filter(Boolean).join(', ')}
                    </strong>
                    {' '}— qo&apos;shimcha jarohat protokoli aktivlandi (WSES)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── QADAM 4: CCHR VA KT ── */}
          {step === 4 && (
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>4-qadam: CCHR va KT natijalari</div>

              <div className={styles.card}>
                <h3 className={styles.cardTitle}>CCHR Qo&apos;shimcha mezonlar</h3>
                <p className={styles.cardDesc}>Canadian CT Head Rule (Stiell et al, Lancet 2001)</p>
                <div className={styles.cchrList}>
                  <div className={`${styles.cchrItem} ${styles.cchrHigh}`}>
                    <span className={styles.cchrBadge}>Yuqori xavf</span>
                    <div className={styles.cchrChecks}>
                      <Checkbox label="Jarohatdan 2 soat o'tgach GCS < 15" checked={form.cchrAdditional.gcsLessThan15at2hrs} onChange={v => setCchr('gcsLessThan15at2hrs', v)} />
                      <Checkbox label="Ochiq yoki botiq bosh suyagi sinishi gumonlandi" checked={form.cchrAdditional.suspectedOpenFracture} onChange={v => setCchr('suspectedOpenFracture', v)} />
                      <Checkbox label="Asos suyagi sinishi (Battle belgisi, Raccoon eyes, CSF)" checked={form.cchrAdditional.basalSkullFracture} onChange={v => setCchr('basalSkullFracture', v)} />
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.card}>
                <h3 className={styles.cardTitle}>KT natijasi</h3>
                <div className={styles.ctGrid}>
                  {([
                    ['not_done',  '🔲', 'Bajarilmagan'],
                    ['normal',    '✅', 'Normal'],
                    ['hematoma',  '🩸', 'Gematoma'],
                    ['contusion', '🟠', 'Kontuziya'],
                    ['fracture',  '💀', 'Suyak sinishi'],
                    ['other',     '⚠️', 'Boshqa'],
                  ] as const).map(([val, icon, name]) => (
                    <button key={val} type="button"
                      className={`${styles.ctBtn} ${form.ctResult === val ? styles.ctBtnActive : ''}`}
                      onClick={() => set('ctResult', val)}>
                      <span>{icon}</span><span>{name}</span>
                    </button>
                  ))}
                </div>

                {form.ctResult === 'hematoma' && (
                  <div className={styles.hematomaFields}>
                    <div className={styles.cardTitle} style={{ marginBottom: 14 }}>Gematoma tafsilotlari (BTF protokoli)</div>
                    <div className={styles.row2}>
                      <div className={styles.field}>
                        <label className={styles.label}>Turi</label>
                        <select className={styles.select} value={form.hematomaType ?? ''}
                          onChange={e => set('hematomaType', e.target.value as ClinicalInput['hematomaType'])}>
                          <option value="">Tanlang...</option>
                          <option value="epidural">Epidural</option>
                          <option value="subdural">Subdural</option>
                          <option value="intracerebral">Intraserebral</option>
                          <option value="subarachnoid">Subaraxnoid</option>
                        </select>
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label}>Hajmi (ml)</label>
                        <input type="number" className={styles.input} min={0} placeholder="masalan: 25"
                          value={form.hematomaVolume ?? ''}
                          onChange={e => set('hematomaVolume', parseFloat(e.target.value) || undefined)} />
                      </div>
                    </div>
                    <div className={styles.row2}>
                      <div className={styles.field}>
                        <label className={styles.label}>Qalinligi (mm)</label>
                        <input type="number" className={styles.input} min={0} placeholder="masalan: 10"
                          value={form.hematomaThickness ?? ''}
                          onChange={e => set('hematomaThickness', parseFloat(e.target.value) || undefined)} />
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label}>O&apos;rta chiziq siljishi (mm)</label>
                        <input type="number" className={styles.input} min={0} placeholder="masalan: 3"
                          value={form.midlineShift ?? ''}
                          onChange={e => set('midlineShift', parseFloat(e.target.value) || undefined)} />
                        {(form.midlineShift ?? 0) > 5 && (
                          <span className={styles.hintDanger}>⚠️ Siljish &gt; 5mm — jarrohlik ko&apos;rsatmasi</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── QADAM 5: YAKUNIY TEKSHIRUV ── */}
          {step === 5 && (
            <div className={styles.stepContent}>
              <div className={styles.stepTitle}>5-qadam: Yakuniy tekshiruv va tahlil</div>

              <div className={styles.reviewGrid}>
                <div className={styles.reviewCard}>
                  <div className={styles.reviewTitle}>Bemor</div>
                  <div className={styles.reviewRow}><span>Yosh</span><strong>{form.age}</strong></div>
                  <div className={styles.reviewRow}><span>Jins</span><strong>{form.sex === 'male' ? 'Erkak' : 'Ayol'}</strong></div>
                  {form.pregnancy && <div className={styles.reviewRow}><span>Holat</span><strong>Homilador ⚠️</strong></div>}
                  <div className={styles.reviewRow}><span>Mexanizm</span><strong>
                    {form.traumaMechanism === 'other'
                      ? `Boshqa${otherMechanism ? `: ${otherMechanism}` : ''}`
                      : { fall_height: 'Balandlikdan', road_accident: 'YTH', direct_blow: "To'g'ridan zarba", sports: 'Sport' }[form.traumaMechanism] ?? form.traumaMechanism}
                  </strong></div>
                  <div className={styles.reviewRow}><span>Antikoagulyant</span><strong>{form.anticoagulant ? 'Ha ⚠️' : "Yo'q"}</strong></div>
                  <div className={styles.reviewRow}><span>Alkogol</span><strong>{form.alcoholIntoxication ? 'Ha ⚠️' : "Yo'q"}</strong></div>
                  {form.comorbidities.length > 0 && (
                    <div className={styles.reviewRow}><span>Kasalliklar</span><strong style={{ color: 'var(--warn)' }}>{form.comorbidities.length} ta ⚠️</strong></div>
                  )}
                </div>

                <div className={styles.reviewCard}>
                  <div className={styles.reviewTitle}>GCS</div>
                  <div className={styles.reviewRow}><span>Ko&apos;z (E)</span><strong>{form.gcs.eye} — {EYE_OPTIONS[form.gcs.eye-1]?.label}</strong></div>
                  <div className={styles.reviewRow}><span>Verbal (V)</span><strong>{form.gcs.verbal} — {VERBAL_OPTIONS[form.gcs.verbal-1]?.label}</strong></div>
                  <div className={styles.reviewRow}><span>Harakat (M)</span><strong>{form.gcs.motor} — {MOTOR_OPTIONS[form.gcs.motor-1]?.label}</strong></div>
                  <div className={`${styles.reviewRow} ${styles.reviewTotal}`}>
                    <span>Jami GCS</span>
                    <strong style={{ color: gcsSeverity.color }}>{gcsTotal}/15 — {gcsSeverity.label}</strong>
                  </div>
                </div>

                <div className={styles.reviewCard}>
                  <div className={styles.reviewTitle}>Vital belgilar</div>
                  <div className={styles.reviewRow}>
                    <span>SBP</span>
                    <strong style={{ color: form.sbp !== undefined && form.sbp < 90 ? '#c0392b' : form.sbp !== undefined && form.sbp < 110 ? '#e67e22' : undefined }}>
                      {form.sbp !== undefined ? `${form.sbp} mmHg${form.sbp < 90 ? ' 🚨' : form.sbp < 110 ? ' ⚠️' : ''}` : "Kiritilmagan"}
                    </strong>
                  </div>
                  <div className={styles.reviewRow}>
                    <span>SpO2</span>
                    <strong style={{ color: form.spO2 !== undefined && form.spO2 < 90 ? '#c0392b' : form.spO2 !== undefined && form.spO2 < 94 ? '#e67e22' : undefined }}>
                      {form.spO2 !== undefined ? `${form.spO2}%${form.spO2 < 90 ? ' 🚨' : form.spO2 < 94 ? ' ⚠️' : ''}` : "Kiritilmagan"}
                    </strong>
                  </div>
                  {form.respiratoryRate !== undefined && (
                    <div className={styles.reviewRow}>
                      <span>Nafas</span>
                      <strong>{form.respiratoryRate} /daq</strong>
                    </div>
                  )}
                  {(form.complaints.chestPain || form.complaints.abdominalPain || form.complaints.limbPain || form.complaints.backPain) && (
                    <div className={styles.reviewRow}>
                      <span>Qo&apos;shimcha jarohat</span>
                      <strong style={{ color: '#993C1D' }}>
                        {[form.complaints.chestPain && "Ko'krak", form.complaints.abdominalPain && "Qorin",
                          form.complaints.limbPain && "Qo'l/oyoq", form.complaints.backPain && "Bel"].filter(Boolean).join(', ')} ⚠️
                      </strong>
                    </div>
                  )}
                </div>

                <div className={styles.reviewCard}>
                  <div className={styles.reviewTitle}>Klinik</div>
                  <div className={styles.reviewRow}><span>Anizokoria</span><strong>{form.anisocoria === 'none' ? "Yo'q" : form.anisocoria + ' ⚠️'}</strong></div>
                  <div className={styles.reviewRow}><span>Nistagm</span><strong>{form.complaints.nystagmus ? 'Ha ⚠️' : "Yo'q"}</strong></div>
                  <div className={styles.reviewRow}><span>Tutqanoq</span><strong>{form.complaints.seizure ? 'Ha ⚠️' : "Yo'q"}</strong></div>
                  <div className={styles.reviewRow}><span>Qusish</span><strong>{form.complaints.vomiting === 'none' ? "Yo'q" : form.complaints.vomiting === 'once' ? '1 marta' : 'Qayta-qayta ⚠️'}</strong></div>
                  <div className={styles.reviewRow}><span>KT natijasi</span><strong>{form.ctResult}</strong></div>
                </div>

                <div className={styles.reviewCard}>
                  <div className={styles.reviewTitle}>Kranial nervlar</div>
                  {pathoCN.length === 0
                    ? <div className={styles.reviewRow}><span>Holat</span><strong style={{color:'#27ae60'}}>Hammasi normal</strong></div>
                    : pathoCN.map(n => (
                        <div key={n.id} className={styles.reviewRow}>
                          <span>CN {n.num}</span>
                          <strong style={{ color: CN_URGENCY_COLOR[n.urgency].color }}>Patologik ⚠️</strong>
                        </div>
                      ))
                  }
                </div>
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <button type="submit" className={styles.submitBtn} disabled={loading}>
                {loading ? <><span className={styles.spinner} /> Tahlil qilinmoqda...</> : '🧠 Tahlilni boshlash →'}
              </button>

              <p className={styles.disclaimer}>
                ⚕️ Bu tizim shifokorga yordam berish uchun mo&apos;ljallangan. Yakuniy klinik qaror doimo shifokorga tegishli.
              </p>
            </div>
          )}

          {/* Navigation */}
          <div className={styles.navRow}>
            <button type="button" className={styles.prevBtn} onClick={() => setStep(s => Math.max(1, s-1))} disabled={step === 1}>← Orqaga</button>
            <span className={styles.stepLabel}>{step} / {TOTAL_STEPS}</span>
            {step < TOTAL_STEPS
              ? <button type="button" className={styles.nextBtn} onClick={() => setStep(s => Math.min(TOTAL_STEPS, s+1))}>
                  {step === TOTAL_STEPS - 1 ? 'Tekshiruv →' : 'Keyingi →'}
                </button>
              : <div />}
          </div>
        </form>
      </main>
    </div>
  );
}
