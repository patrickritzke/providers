function normaliseWebsite(w) {
  return (w || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase().trim();
}

function normaliseAddress(a) {
  return (a || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildMatches(moodys, dnb, sp, squishy = false) {
  const matches = [];
  const usedM = new Set(), usedD = new Set(), usedS = new Set();
  const allProviders = [
    { key: 'moodys', arr: moodys, used: usedM },
    { key: 'dnb',    arr: dnb,    used: usedD },
    { key: 'sp',     arr: sp,     used: usedS },
  ].filter(p => p.arr.length);

  if (allProviders.length < 2) {
    return { matches: [], unmoodys: moodys.length, undnb: dnb.length, unsp: sp.length };
  }

  for (const idKey of ['ticker', 'isin', 'lei']) {
    const indexes = {};
    allProviders.forEach(({ key, arr }) => {
      indexes[key] = {};
      arr.forEach((r, i) => {
        let v = (r[idKey] || '').toUpperCase();
        if (idKey === 'ticker' && v.includes(':')) v = v.split(':')[1].trim();
        if (v) indexes[key][v] = i;
      });
    });
    const allVals = new Set(allProviders.flatMap(({ key }) => Object.keys(indexes[key])));
    for (const val of allVals) {
      const hits = allProviders.filter(({ key }) => indexes[key][val] !== undefined);
      if (hits.length < 2) continue;
      const sig = allProviders.map(({ key }) => indexes[key][val] ?? '-').join(':');
      if (matches.some(m => m.sig === sig)) continue;
      const entry = { key: idKey.toUpperCase(), val, sig, type: 'exact', moodys: null, dnb: null, sp: null };
      hits.forEach(({ key, arr }) => {
        entry[key] = arr[indexes[key][val]];
        hits.forEach(h => h.used.add(indexes[h.key][val]));
      });
      matches.push(entry);
    }
  }

  if (squishy) {
    for (const [label, extractor] of [
      ['Website', r => normaliseWebsite(r.website)],
      ['Address', r => normaliseAddress(r.location || '')],
    ]) {
      const indexes = {};
      allProviders.forEach(({ key, arr }) => {
        indexes[key] = {};
        arr.forEach((r, i) => { const v = extractor(r); if (v && v.length > 5) indexes[key][v] = i; });
      });
      const allVals = new Set(allProviders.flatMap(({ key }) => Object.keys(indexes[key])));
      for (const val of allVals) {
        const hits = allProviders.filter(({ key }) => indexes[key][val] !== undefined);
        if (hits.length < 2) continue;
        const sig = allProviders.map(({ key }) => indexes[key][val] ?? '-').join(':');
        if (matches.some(m => m.sig === sig)) continue;
        const entry = { key: label, val, sig, type: 'squishy', moodys: null, dnb: null, sp: null };
        hits.forEach(({ key, arr }) => {
          entry[key] = arr[indexes[key][val]];
          hits.forEach(h => h.used.add(indexes[h.key][val]));
        });
        matches.push(entry);
      }
    }
  }

  return {
    matches,
    unmoodys: moodys.length - usedM.size,
    undnb:    dnb.length   - usedD.size,
    unsp:     sp.length    - usedS.size,
  };
}
