import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q');
  if (!query) return NextResponse.json({ articles: [] });
  try {
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=5&sort=relevance&retmode=json`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const ids: string[] = searchData.esearchresult?.idlist ?? [];
    if (ids.length === 0) return NextResponse.json({ articles: [] });
    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const summaryRes = await fetch(summaryUrl);
    const summaryData = await summaryRes.json();
    const result = summaryData.result ?? {};
    const articles = ids.map((id: string) => {
      const a = result[id];
      if (!a) return null;
      return {
        pmid: id,
        title: a.title,
        authors: a.authors?.slice(0, 3).map((au: { name: string }) => au.name).join(', '),
        journal: a.fulljournalname,
        year: a.pubdate?.split(' ')[0],
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      };
    }).filter(Boolean);
    return NextResponse.json({ articles });
  } catch {
    return NextResponse.json({ articles: [], error: 'PubMed xatosi' });
  }
}
