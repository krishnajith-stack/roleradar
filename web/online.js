'use strict';

window.roleRadarOnline = (() => {
  const worker = new Worker('./worker.js');
  const pending = new Map();
  let serial = 0, feed = null;
  const $ = id => document.getElementById(id);
  const rpc = payload => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, {resolve, reject});
    worker.postMessage({id, payload});
  });
  worker.onmessage = ({data}) => {
    if (data.progress) {
      $('loading').textContent = data.progress;
      return;
    }
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  };
  worker.onerror = () => {
    for (const request of pending.values()) request.reject(new Error('The matching engine could not load. Check your connection and reload.'));
    pending.clear();
  };

  async function readFeed() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('./jobs.json', {cache: 'no-cache', signal: controller.signal});
      if (!response.ok) throw new Error('The job feed could not load. Try again later; your saved jobs are safe.');
      const value = await response.json();
      if (value.version !== 1 || !Array.isArray(value.jobs)) throw new Error('Unexpected job-feed format.');
      feed = value;
      sourceNote();
      return value;
    } finally { clearTimeout(timeout); }
  }

  function sourceNote() {
    const saved = $('source').value === 'saved';
    $('datePosted').disabled = saved;
    $('searchButton').disabled = !saved && !feed?.generated_at;
    $('searchButton').textContent = saved ? 'Search saved jobs' : 'Search published feed';
    $('sourceNote').textContent = saved
      ? 'Search private records in this browser. Posted-date selection is ignored.'
      : feed?.generated_at
        ? `Published feed: ${new Date(feed.generated_at).toLocaleString()}. Filters search this snapshot. Coverage depends on configured searches and provider indexing.`
        : 'Automatic feed not connected yet. Use the job-board links below, then paste a job description to match it against your CV. Connect the automatic feed in Connections & data.';
    if ($('feedStatus')) $('feedStatus').textContent = feed?.generated_at
      ? `${feed.jobs.length} indexed listings. Updated ${new Date(feed.generated_at).toLocaleString()}.${Date.now() - Date.parse(feed.generated_at) > 172800000 ? ' Stale: check the latest Actions run.' : ''}`
      : 'Awaiting provider setup. No live listings have been fetched.';
    if ($('feedCoverage')) $('feedCoverage').textContent = feed?.queries?.length
      ? 'Configured searches: ' + feed.queries.map(q => `${q.query} (${q.country.toUpperCase()})`).join('; ')
      : 'Default coverage: cybersecurity roles in India and the UAE. Edit feed-config.json to change the scheduled searches.';
    updateBoardLinks();
  }

  function updateBoardLinks() {
    if (!$('linkedinSearch')) return;
    const url = new URL('https://www.linkedin.com/jobs/search/');
    const query = $('query').value.trim();
    const country = $('country').value ? $('country').selectedOptions[0]?.textContent : '';
    const location = [$('location').value.trim(), country].filter(Boolean).join(', ');
    if (query) url.searchParams.set('keywords', query);
    if (location) url.searchParams.set('location', location);
    $('linkedinSearch').href = url.href;
  }

  function addBoardLinks() {
    const section = document.createElement('section');
    section.className = 'panel board-search';
    section.setAttribute('aria-labelledby', 'boardSearchTitle');
    section.innerHTML = '<h2 id="boardSearchTitle">Find jobs on your favourite boards</h2><p>Open a board, find a role, then bring its full description and apply link back here for a match score and application tracking.</p><div class="board-actions"><a id="linkedinSearch" class="button secondary" href="https://www.linkedin.com/jobs/search/" target="_blank" rel="noopener noreferrer">Search LinkedIn ↗</a><a class="button secondary" href="https://www.naukri.com/" target="_blank" rel="noopener noreferrer">Open Naukri ↗</a><a class="button secondary" href="https://www.naukrigulf.com/" target="_blank" rel="noopener noreferrer">Open Naukrigulf ↗</a><button type="button" class="button primary" id="pasteBoardJob">＋ Paste a job description</button></div><p class="subtle">LinkedIn uses the role and location above. Set other filters on the job board. These links open external websites; they do not import listings or send your CV.</p>';
    $('searchForm').after(section);
    $('pasteBoardJob').addEventListener('click', () => $('addJob').click());
    for (const id of ['query', 'location', 'country']) {
      $(id).addEventListener('input', updateBoardLinks);
      $(id).addEventListener('change', updateBoardLinks);
    }
  }

  async function api(path, data, binary = false) {
    const payload = {path, data};
    if (path === '/api/search' && data.source !== 'saved') payload.feed = await readFeed();
    const result = await rpc(payload);
    if (binary && path === '/api/docx') {
      return new Blob([Uint8Array.from(atob(result.base64), c => c.charCodeAt(0))],
        {type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    }
    return binary ? new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'}) : result;
  }

  async function ready() {
    addBoardLinks();
    document.querySelector('meta[name="description"]').content = 'Private CV matching and tracking, with a scheduled LinkedIn and Naukri job feed.';
    document.querySelector('.local-pill').textContent = 'BROWSER PRIVATE';
    document.querySelector('.local-label div').innerHTML = 'Online workspace<small>Private data in this browser.</small>';
    document.querySelector('#view-settings .page-heading .muted').textContent = 'CVs and application history stay in this browser, not in your public repository. Export backups to move between devices.';
    document.querySelector('#searchForm .search-panel-heading .subtle').textContent = 'Scheduled feed. Original platform apply links.';
    $('searchButton').textContent = 'Search published feed';
    document.querySelector('.upload-zone span:last-of-type').textContent = 'DOCX, TXT or text-based PDF - up to 8 MB';
    for (const value of ['jsearch', 'remotive']) $('source').querySelector(`option[value="${value}"]`).remove();
    $('tailorAI').hidden = true;
    document.querySelector('.studio-controls > p').textContent = 'Evidence-based tailoring preserves employers, dates and achievements. Local Ollama remains available in the desktop edition.';
    const panels = document.querySelectorAll('.settings-grid > .panel');
    panels[0].hidden = true;
    panels[1].hidden = true;
    panels[2].hidden = true;
    panels[3].querySelector(':scope > p').textContent = 'Your CV, jobs and notes are stored in this browser using IndexedDB. Clearing site data removes them. Back up regularly; another device starts with an empty workspace.';
    const connection = document.createElement('section');
    connection.className = 'panel feed-connection';
    connection.innerHTML = '<h2>LinkedIn + Naukri feed</h2><p id="feedStatus" role="status"></p><p id="feedCoverage" class="subtle"></p><p>The site reads a scheduled, public job snapshot. Your CV is never sent to the job provider. Naukri coverage is not guaranteed.</p><ol><li>Open the separate RoleRadar repository on GitHub.</li><li>Under Settings &gt; Secrets and variables &gt; Actions, add <code>OPENWEBNINJA_API_KEY</code>.</li><li>Run <strong>Refresh job feed</strong> under Actions, then reload this site.</li></ol><p class="subtle">The default schedule is weekly: two provider calls per run. Plans and quotas vary. Review provider licensing before publishing listing text. Edit feed-config.json for roles and locations, and the workflow for frequency.</p><a href="https://www.openwebninja.com/api/jsearch" target="_blank" rel="noopener noreferrer">Provider access and plans</a>';
    document.querySelector('.settings-grid').prepend(connection);
    const coverage = document.querySelectorAll('.coverage-panel p');
    coverage[1].textContent = 'This edition opens online without Python installation. It downloads a pinned Python runtime to perform matching in your browser. It is not an account-based cloud sync service. Keep your device secure and do not use a shared browser profile for private CVs.';
    await api('/api/state');
    try { await readFeed(); } catch { sourceNote(); }
  }
  return {api, ready, sourceNote};
})();
