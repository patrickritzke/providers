const TOKEN_URL  = 'https://plus.dnb.com/v2/token';
const SEARCH_URL = 'https://plus.dnb.com/v1/search/criteria';

export async function search(name) {
  const basicToken = process.env.DNB_BASIC_TOKEN;
  if (!basicToken) throw new Error('DNB_BASIC_TOKEN required');

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basicToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
  });
  if (!tokenRes.ok) throw new Error(`D&B token HTTP ${tokenRes.status}`);
  const { access_token } = await tokenRes.json();

  const searchRes = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchTerm: name, isStandalone: false, pageSize: 50, pageNumber: 1 }),
  });
  if (!searchRes.ok) throw new Error(`D&B search HTTP ${searchRes.status}`);
  const data = await searchRes.json();

  return (data.searchCandidates || []).map(c => {
    const org  = c.organization || {};
    const addr = org.primaryAddress || {};
    const location = [
      addr.streetAddress?.line1,
      addr.postalCode,
      addr.addressLocality?.name,
      addr.addressRegion?.abbreviatedName,
      addr.addressCountry?.isoAlpha2Code,
    ].filter(Boolean).join(', ');
    return {
      id:       org.duns          || '',
      name:     org.primaryName   || '',
      location,
      website:  org.domain        || '',
      ticker:   org.tickerSymbol  || '',
      isin:     '',
      lei:      '',
    };
  });
}
