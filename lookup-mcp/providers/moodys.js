const DEFAULT_ENDPOINT = 'https://webservices.bvdinfo.com/v1.3/orbis4/remoteaccess.asmx';

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\/(?:[^:>]+:)?${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

async function soapPost(endpoint, action, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': action },
    body,
  });
  if (!res.ok) throw new Error(`BvD HTTP ${res.status}`);
  return res.text();
}

export async function search(name) {
  const username = process.env.MOODYS_USERNAME;
  const password = process.env.MOODYS_PASSWORD;
  const endpoint = process.env.MOODYS_BASE_URL || DEFAULT_ENDPOINT;
  if (!username || !password) throw new Error('MOODYS_USERNAME and MOODYS_PASSWORD required');

  const openXml = await soapPost(
    endpoint,
    'http://bvdep.com/webservices/Open',
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://bvdep.com/webservices/"><soapenv:Header/><soapenv:Body><web:Open><web:username>${escXml(username)}</web:username><web:password>${escXml(password)}</web:password></web:Open></soapenv:Body></soapenv:Envelope>`
  );

  const sid = xmlTag(openXml, 'OpenResult');
  if (!sid) throw new Error(xmlTag(openXml, 'faultstring') || 'BvD: no session ID returned');

  const matchXml = await soapPost(
    endpoint,
    'http://bvdep.com/webservices/Match',
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://bvdep.com/webservices/"><soapenv:Header/><soapenv:Body><web:Match><web:sessionHandle>${escXml(sid)}</web:sessionHandle><web:criteria><web:Name>${escXml(name)}</web:Name><web:Address></web:Address><web:PostCode></web:PostCode><web:City></web:City><web:Country></web:Country><web:PhoneOrFax></web:PhoneOrFax><web:EMailOrWebsite></web:EMailOrWebsite><web:NationalId></web:NationalId><web:Ticker></web:Ticker><web:Isin></web:Isin><web:State></web:State><web:BvD9></web:BvD9></web:criteria><web:exclusionFlags></web:exclusionFlags></web:Match></soapenv:Body></soapenv:Envelope>`
  );

  const results = [];
  const re = /<(?:[^:>]+:)?MatchResult[^>]*>([\s\S]*?)<\/(?:[^:>]+:)?MatchResult>/gi;
  let m;
  while ((m = re.exec(matchXml)) !== null) {
    const b = m[1];
    const location = [
      xmlTag(b, 'Address'),
      [xmlTag(b, 'PostCode'), xmlTag(b, 'City')].filter(Boolean).join(' '),
      xmlTag(b, 'Country'),
    ].filter(Boolean).join(', ');
    results.push({
      id:       xmlTag(b, 'BvDID'),
      name:     xmlTag(b, 'Name'),
      location,
      website:  xmlTag(b, 'EMailOrWebsite'),
      ticker:   xmlTag(b, 'Ticker'),
      isin:     xmlTag(b, 'ISIN'),
      lei:      xmlTag(b, 'LEI'),
    });
  }
  return results;
}
