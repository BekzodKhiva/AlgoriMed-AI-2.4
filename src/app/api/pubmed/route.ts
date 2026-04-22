// api/pubmed/route.ts — AlgoriMed v2.5
// Parallel fetch + fallback + deduplication
// NCBI E-utilities API (bepul, ro'yxatdan o'tish shart emas)

import { NextRequest, NextResponse } from 'next/server';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const TIMEOUT = 8000;

interface Article {
  pmid: string; title: string; authors: string;
  journal: string; year: string; url: string;
}

async function searchPMIDs(query: string, retmax = 5): Promise<string[]> {
  try {
    const url = `${EUTILS}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&sort=relevance&retmode=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.esearchresult?.idlist ?? [];
  } catch { return []; }
}

async function fetchSummaries(ids: string[]): Promise<Article[]> {
  if (!ids.length) return [];
  try {
    const url = `${EUTILS}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return [];
    const data = await res.json();
    const result = data?.result ?? {};
    return ids.map(id => {
      const a = result[id];
      if (!a || a.error) return null;
      return {
        pmid: id, title: a.title ?? '',
        authors: (a.authors ?? []).slice(0, 3).map((au: {name: string}) => au.name).join(', '),
        journal: a.fulljournalname ?? a.source ?? '',
        year: (a.pubdate ?? '').split(' ')[0],
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      } as Article;
    }).filter((a): a is Article => a !== null && a.title.length > 10);
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const primary = searchParams.get('q');
  if (!primary) return NextResponse.json({ articles: [] });

  let extras: string[] = [];
  try {
    const raw = searchParams.get('queries');
    if (raw) extras = JSON.parse(decodeURIComponent(raw)).slice(0, 4);
  } catch { extras = []; }

  try {
    // Barcha querylar — primary + extras, takrorlanmasdan, max 5
    const allQueries = [primary, ...extras]
      .filter((q, i, arr) => arr.indexOf(q) === i && q.trim().length > 0)
      .slice(0, 5);

    // Parallel PMID qidirish
    const results = await Promise.allSettled(allQueries.map(q => searchPMIDs(q, 4)));

    const seen = new Set<string>();
    const pmids: string[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        for (const id of r.value) {
          if (!seen.has(id) && pmids.length < 8) { seen.add(id); pmids.push(id); }
        }
      }
    }

    // Fallback 1 — birinchi 3 so'z
    if (!pmids.length) {
      const fallback = primary.trim().split(/\s+/).slice(0, 3).join(' ');
      const ids = await searchPMIDs(fallback, 5);
      ids.forEach(id => { if (!seen.has(id)) { seen.add(id); pmids.push(id); } });
    }

    // Fallback 2 — umumiy query
    if (!pmids.length) {
      const ids = await searchPMIDs('traumatic brain injury management', 5);
      pmids.push(...ids.slice(0, 5));
    }

    if (!pmids.length) return NextResponse.json({ articles: [] });

    const articles = await fetchSummaries(pmids.slice(0, 8));
    return NextResponse.json({ articles });

  } catch (err) {
    console.error('PubMed error:', err);
    return NextResponse.json({ articles: [], error: 'PubMed xatosi' });
  }
}
