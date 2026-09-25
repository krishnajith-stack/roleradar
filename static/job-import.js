'use strict';

// Fetch only public job pages. The reader receives the URL, never workspace data.
window.roleRadarJobImport = (() => {
  const MAX_PAGE = 5_000_000;
  const unavailable = 'This page could not be read publicly. It may require sign-in, block automated access, or be unavailable. Paste its job details below instead.';
  const blockedTitle = /^(?:access denied|forbidden|just a moment|security check|sign in|log in|login|verify you are human|page not found|error\b)/i;

  function publicUrl(value) {
    let url;
    try { url = new URL(String(value).trim()); } catch { throw new Error('Paste a complete public job URL starting with https://.'); }
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
        !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)) {
      throw new Error('Use a public job-posting URL, without credentials, private addresses or custom ports.');
    }
    if (url.href.length > 4000) throw new Error('The job URL is too long. Copy the direct posting link.');
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|trk$|trackingid$|refid$|tracking$)/i.test(key)) url.searchParams.delete(key);
    }
    // Preserve the posting's original host/path: rewriting a regional link can
    // lead to a different page, a sign-in wall, or an access restriction.
    if ((host === 'linkedin.com' || host.endsWith('.linkedin.com')) && /\/jobs\/search\/?$/.test(url.pathname)) {
      throw new Error('Copy the direct link to one LinkedIn job posting, rather than the search-results page.');
    }
    return url.href;
  }

  function fragment(html) {
    // Template content stays inert: fetched scripts, images and forms are never mounted.
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    return template.content;
  }

  function plain(value) {
    let root = typeof value === 'string' ? fragment(value) : value;
    if (!root) return '';
    // JobPosting descriptions sometimes contain entity-escaped HTML strings.
    if (typeof value === 'string' && /&lt;\/?(?:br|p|div|strong|ul|li)\b/i.test(value)) root = fragment(root.textContent);
    const visit = node => {
      if (node.nodeType === 3) return node.textContent;
      if (/^(SCRIPT|STYLE|NOSCRIPT|IFRAME|FORM|SVG|NAV|BUTTON)$/.test(node.nodeName)) return '';
      const text = [...node.childNodes].map(visit).join('');
      return /^(P|DIV|LI|BR|H[1-6]|SECTION|ARTICLE|UL|OL)$/.test(node.nodeName) ? '\n' + text + '\n' : text;
    };
    return visit(root).replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function parse(html, originalUrl, countries = {}) {
    if (typeof html !== 'string' || html.length > MAX_PAGE) throw new Error('The page is too large or unreadable. Paste the job description instead.');
    const url = publicUrl(originalUrl), root = fragment(html);
    const titleText = plain(root.querySelector('title'));
    const headingText = plain(root.querySelector('h1'));
    if (blockedTitle.test(titleText) || blockedTitle.test(headingText)) throw new Error(unavailable);
    const candidates = [];
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 20) return;
      if (Array.isArray(value)) { value.forEach(v => visit(v, depth + 1)); return; }
      if ([value['@type']].flat().some(t => /(?:^|[\/#])JobPosting$/.test(String(t)))) candidates.push(value);
      else Object.values(value).forEach(v => visit(v, depth + 1));
    };
    for (const node of root.querySelectorAll('script[type="application/ld+json"]')) {
      try { visit(JSON.parse(node.textContent)); } catch { /* Other page metadata may be malformed. */ }
    }
    const unique = [...new Map(candidates.map(j => [JSON.stringify([j.title, j.description, j.url]), j])).values()];
    let schema = unique[0];
    if (unique.length > 1) {
      const matches = unique.filter(j => { try { return publicUrl(j.url).replace(/\/$/, '') === url.replace(/\/$/, ''); } catch { return false; } });
      if (matches.length !== 1) throw new Error('This link contains several jobs. Open one job posting and copy its direct link.');
      schema = matches[0];
    }
    let job = {url, source: 'URL import', title: '', company: '', location: '', country: '', description: '', work_mode: 'Unspecified', posted: '', salary: ''};
    const countryCode = value => {
      const text = String(typeof value === 'object' ? value?.name || '' : value || '').trim();
      const code = text.toLowerCase() === 'uk' ? 'gb' : text.toLowerCase();
      return countries[code] ? code : Object.keys(countries).find(k => countries[k].toLowerCase() === code) || '';
    };
    if (schema) {
      job.title = plain(schema.title);
      job.description = plain(schema.description);
      job.company = plain(typeof schema.hiringOrganization === 'string' ? schema.hiringOrganization : schema.hiringOrganization?.name);
      const places = [schema.jobLocation || []].flat();
      job.location = places.map(place => {
        const a = place.address || {};
        if (!job.country) job.country = countryCode(a.addressCountry);
        return [a.addressLocality, a.addressRegion, typeof a.addressCountry === 'object' ? a.addressCountry?.name : a.addressCountry].filter(Boolean).join(', ');
      }).filter(Boolean).join('; ');
      if ([schema.jobLocationType].flat().includes('TELECOMMUTE')) job.work_mode = 'Remote';
      job.posted = String(schema.datePosted || '');
      if (schema.validThrough && Date.parse(schema.validThrough) < Date.now()) throw new Error('This posting is marked as expired. Check the original page before adding it manually.');
      const salary = schema.baseSalary, amount = salary?.value;
      if (amount && typeof amount === 'object') {
        job.salary = [salary.currency, amount.value ?? [amount.minValue, amount.maxValue].filter(v => v != null).join('–'), amount.unitText].filter(v => v != null && v !== '').join(' ');
      }
    } else {
      // Fall back only to job-specific elements; never save an entire search/login page as a JD.
      const description = root.querySelector('[itemprop="description"], .show-more-less-html__markup, .jobs-description__content, .job-description, .jobDescription, #job-description, .job__description');
      job.description = plain(description);
      job.title = headingText;
      job.company = plain(root.querySelector('[itemprop="hiringOrganization"] [itemprop="name"], .topcard__org-name-link, .job-company'));
      if (!job.company && /(?:^|\.)greenhouse\.io$/.test(new URL(url).hostname)) job.company = titleText.match(/^Job Application for .+ at (.+)$/)?.[1]?.trim() || '';
      job.location = plain(root.querySelector('.topcard__flavor--bullet, [itemprop="jobLocation"], .job-location, .job__location'));
      job.country = Object.keys(countries).find(k => job.location.toLowerCase().includes(countries[k].toLowerCase())) || '';
    }
    if (!job.title || job.description.length < 100) throw new Error('The page did not expose a complete job title and description. Paste the missing details below; nothing has been saved.');
    if (job.description.length > 80000) throw new Error('This description is too long to import safely. Paste the relevant job details below.');
    if (job.title.length > 240 || /verify (?:that )?you are (?:a )?human|unusual traffic|checking your browser/i.test(job.description.slice(0, 200))) throw new Error(unavailable);
    job.title = job.title.trim(); job.company = job.company.slice(0, 180); job.location = job.location.slice(0, 240);
    return job;
  }

  async function fetchJob(value, countries, signal) {
    const url = publicUrl(value);
    let response;
    try {
      response = await fetch('https://r.jina.ai/' + url, {
        headers: {'Accept': 'application/json', 'X-Respond-With': 'html'},
        credentials: 'omit', referrerPolicy: 'no-referrer', signal
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error('Could not reach the public-page reader. Check your connection or paste the job description below.');
    }
    if (response.status === 429) throw new Error('The public-page reader is busy or rate limited. Try later, or paste the job description.');
    if (!response.ok) throw new Error(unavailable);
    if (Number(response.headers.get('content-length')) > MAX_PAGE) throw new Error('The page is too large. Paste the job description instead.');
    let raw = '';
    if (response.body?.getReader) {
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let total = 0;
      while (true) {
        const {done, value: chunk} = await reader.read();
        if (done) break;
        total += chunk.byteLength;
        if (total > MAX_PAGE) { await reader.cancel(); throw new Error('The page is too large. Paste the job description instead.'); }
        raw += decoder.decode(chunk, {stream: true});
      }
      raw += decoder.decode();
    } else raw = await response.text();
    if (raw.length > MAX_PAGE) throw new Error('The page is too large. Paste the job description instead.');
    let data;
    try { data = JSON.parse(raw).data; } catch { throw new Error('The public-page reader returned an unreadable response. Try later or paste the description.'); }
    if (!data || !data.html || Number(data.httpStatus) >= 400) throw new Error(unavailable);
    // Readers may follow a redirect; do not turn a redirect to a private URL into a saved link.
    if (data.url) publicUrl(data.url);
    return parse(data.html, url, countries);
  }
  return {publicUrl, parse, fetchJob};
})();
