'use strict';

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = (url) => { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const link = (url, text, className = '') => safeUrl(url) ? `<a href="${escapeHtml(safeUrl(url))}" class="${className}" target="_blank" rel="noopener noreferrer">${text}</a>` : '';
const state = {profile:{}, jobs:[], settings:{}, countries:{}, categories:{}, statuses:[], skills:[], certifications:[]};
let token = '', currentView = 'discover', selectedIds = null, shortlistOnly = false, nextCursor = '', lastSearch = null;
let detailJob = null, detailTab = 'match', toastTimer, draftDirty = false, profileDirty = false, activeDraftJob = '', uploading = false;
let resumeMethod = '', booted = false;
let jobImportController = null, jobFormEpoch = 0, importedJobMeta = null;

async function api(path, data, binary = false) {
  if (window.roleRadarOnline) return window.roleRadarOnline.api(path, data, binary);
  const response = await fetch(path, {method: data === undefined ? 'GET' : 'POST',
    headers: {'X-RoleRadar-Token': token, ...(data === undefined ? {} : {'Content-Type':'application/json'})},
    ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  if (!response.ok) {
    const error = await response.json().catch(() => ({error:'The local app could not complete that request.'}));
    throw new Error(error.error || 'Request failed.');
  }
  return binary ? response.blob() : response.json();
}

function toast(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').className = 'toast' + (error ? ' error' : '');
  $('toast').hidden = false; toastTimer = setTimeout(() => {$('toast').hidden = true;}, error ? 9000 : 4300);
}
function notice(id, message, kind = '') {
  const node = $(id); node.textContent = message; node.className = 'notice ' + kind; node.hidden = !message;
}
async function busy(button, message, fn) {
  const previous = button.innerHTML; button.disabled = true; button.textContent = message;
  try { return await fn(); } catch (e) { toast(e.message, true); throw e; }
  finally { button.disabled = false; button.innerHTML = previous; }
}
function guarded(fn) { return async (event) => { try { await fn(event); } catch (e) { toast(e.message, true); } }; }
function fmtDate(value, withTime = false) {
  if (!value) return 'Not set';
  const date = new Date(value.length === 10 ? value + 'T12:00:00' : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {day:'numeric', month:'short', year:'numeric', ...(withTime ? {hour:'2-digit', minute:'2-digit'} : {})}).format(date);
}
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function statusClass(status) { return 'status-' + String(status).toLowerCase(); }
function pill(status) { return `<span class="pill ${statusClass(status)}">${escapeHtml(status)}</span>`; }
function scoreRing(score, large = false) {
  const cls = score === null || score === undefined ? 'none' : score >= 75 ? 'high' : score >= 50 ? 'mid' : 'low';
  return `<div class="score-wrap"><div class="score-ring ${cls}${large?' large':''}" style="--score:${Number(score)||0}" aria-label="${score == null ? 'No match score available' : escapeHtml(score)+' out of 100, text similarity'}"><strong>${score ?? '—'}</strong></div><span class="score-label">${score == null ? 'ADD CV / JD' : 'MATCH / 100'}</span></div>`;
}
function skillsTags(skills, type = '', max = 30) { return skills.slice(0,max).map(s => `<span class="skill ${type}">${escapeHtml(s)}</span>`).join(''); }
function jobById(id) { return state.jobs.find(j => j.id === id); }
function options(map, blank = '') { return (blank ? `<option value="">${escapeHtml(blank)}</option>` : '') + Object.entries(map).map(([k,v]) => `<option value="${escapeHtml(k)}">${escapeHtml(v)}</option>`).join(''); }
function download(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filenameBase() { return ((jobById($('resumeJob').value)?.company || 'Role') + '-Tailored-Resume').replace(/[^a-zA-Z0-9_-]/g, '_'); }

function switchView(view) {
  if (!['discover','tracker','profile','resume','settings'].includes(view)) return;
  currentView = view;
  document.querySelectorAll('.view').forEach(v => {v.hidden = v.id !== 'view-' + view;});
  document.querySelectorAll('.nav-item[data-view]').forEach(b => {b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false');});
  $('crumb').textContent = {discover:'Discover jobs',tracker:'Applications',profile:'My CV',resume:'Resume studio',settings:'Connections & data'}[view];
  history.replaceState(null, '', '#' + view);
  if (view === 'profile' && !profileDirty) populateProfile();
  if (view === 'resume') renderResumeFocus();
  window.scrollTo({top:0,behavior:'auto'});
}

async function refresh() {
  Object.assign(state, await api('/api/state'));
  $('navJobs').textContent = state.jobs.length;
  const applied = state.jobs.filter(j => j.applied_at || ['Applied','Screening','Interview','Offer'].includes(j.status));
  $('navApplied').textContent = applied.length;
  $('demoBadge').hidden = !state.jobs.some(j => j.demo);
  $('clearDemo').hidden = !state.jobs.some(j => j.demo) && !state.profile.demo;
  $('avatar').textContent = state.profile.name ? state.profile.name.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase() : 'CV';
  $('keyStatus').textContent = state.jsearch_connected ? 'Connected' : 'Not connected';
  $('keyStatus').className = 'pill' + (state.jsearch_connected ? ' green' : '');
  $('disconnectKey').hidden = !state.jsearch_connected;
  renderStats(); renderCvBanner(); renderJobs(); renderTracker(); populateResumeJobs(); renderResumeFocus(); sourceNote();
  $('originalCv').textContent = state.profile.text || 'No CV saved yet.';
  if (!profileDirty) populateProfile();
  if (state.settings.model && !$('ollamaModel').querySelector(`option[value="${CSS.escape(state.settings.model)}"]`)) {
    const option = document.createElement('option'); option.value = state.settings.model; option.textContent = state.settings.model + ' (saved)'; $('ollamaModel').append(option); $('ollamaModel').value = state.settings.model;
  }
}

function renderStats() {
  const ranked = state.jobs.filter(j=>j.match.score != null).length;
  const strong = state.jobs.filter(j=>j.match.score >= 75).length;
  const applied = state.jobs.filter(j=>j.applied_at || ['Applied','Screening','Interview','Offer'].includes(j.status)).length;
  const interviews = state.jobs.filter(j=>j.status === 'Interview').length;
  const items = [['Jobs ranked',ranked,'In your workspace','↗',''],['Strong matches',strong,'75+ text similarity','◎','accent'],['Applications sent',applied,'Marked by you','✓',''],['In interview',interviews,'Conversations in progress','◇','']];
  $('stats').innerHTML = items.map(([label,note,foot,icon,cls])=>`<div class="stat ${cls}"><div class="stat-label">${label}<span class="stat-icon" aria-hidden="true">${icon}</span></div><strong class="stat-number">${note}</strong><small class="stat-foot">${foot}</small></div>`).join('');
}

function renderCvBanner() {
  const hasCV = !!state.profile.text;
  $('cvBanner').innerHTML = hasCV
    ? `<div class="cv-banner compact"><div class="banner-leading"><div class="cv-icon" aria-hidden="true">✓</div><div><h3>${state.profile.demo ? 'Sample CV is active' : 'Your CV is ready to match'}</h3><p>${escapeHtml(state.profile.filename || 'Master CV')} · ${state.skills.length} skills recognized${state.profile.years != null ? ' · '+state.profile.years+' years entered' : ''}</p></div></div><button class="text-button" data-view="profile">Review CV →</button></div>`
    : `<div class="cv-banner"><div class="banner-leading"><div class="cv-icon" aria-hidden="true">↑</div><div><h3>Start with your CV</h3><p>Get match scores and see where your experience fits.</p></div></div><div class="banner-actions"><button class="button primary small" data-view="profile">Import my CV</button>${state.jobs.length ? '' : '<button class="text-button" data-action="demo">Explore sample</button>'}</div></div>`;
}

function sourceNote() {
  if (window.roleRadarOnline) return window.roleRadarOnline.sourceNote();
  const source = $('source').value;
  $('sourceNote').textContent = ['jsearch','linkedin','naukri','boards'].includes(source)
    ? (state.jsearch_connected ? 'JSearch connected. One page per request. Country is required; provider usage limits apply. Your CV is not sent.' : 'Connect an OpenWeb Ninja key in Connections for broad live search, or choose Remotive for free remote listings.')
    : source === 'remotive' ? 'Remote listings only, delayed by 24 hours; cached for 6 hours. Country checks use listing eligibility text. Leave city blank to include remote roles.'
    : 'Search the jobs already saved on this computer. Country, city, specialism, remote and keyword filters apply; posted-date selection is ignored.';
  $('datePosted').disabled = source === 'saved';
}

function visibleJobs() {
  let jobs = state.jobs.filter(j => (!selectedIds || selectedIds.has(j.id)) && (!shortlistOnly || j.status === 'Saved'));
  const min = Number($('minScore').value);
  if (min) jobs = jobs.filter(j => j.match.score != null && j.match.score >= min);
  if ($('sort').value === 'newest') jobs.sort((a,b)=>b.created.localeCompare(a.created));
  else if ($('sort').value === 'company') jobs.sort((a,b)=>a.company.localeCompare(b.company));
  else jobs.sort((a,b)=>(b.match.score ?? -1)-(a.match.score ?? -1));
  return jobs;
}

function renderJobs() {
  const jobs = visibleJobs(); $('resultCount').textContent = jobs.length;
  $('resetResults').hidden = !selectedIds;
  $('loadMore').hidden = !nextCursor;
  if (!jobs.length) {
    const blank = !state.jobs.length;
    $('jobList').innerHTML = `<div class="empty-state"><div class="empty-mark" aria-hidden="true">◎</div><h2>${blank?'Your next opportunity starts here':'No jobs match this view'}</h2><p>${blank?'Add your CV, then search a connected job source or paste a job description from any website. Nothing is submitted automatically.':'Try broader keywords, a lower minimum score or a different location. For remote jobs, leave the city empty.'}</p><div class="empty-actions"><button class="button primary" data-action="add">＋ Add a job description</button>${blank && !state.profile.text?'<button class="button secondary" data-action="demo">Explore fictional sample</button>':'<button class="button secondary" data-action="reset">Show all saved jobs</button>'}</div></div>`;
    return;
  }
  $('jobList').innerHTML = jobs.map((job,idx) => {
    const match = job.match, initials = job.company.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
    const sourceLink = job.source === 'Remotive' ? link(job.url,'Remotive ↗') : escapeHtml(job.source);
    return `<article class="job-card"><div class="company-logo color-${idx%4}" aria-hidden="true">${escapeHtml(initials)}</div><div class="job-main"><button class="job-title-button" data-open="${job.id}">${escapeHtml(job.title)}</button><p class="job-company">${escapeHtml(job.company)}</p><div class="job-meta"><span>${escapeHtml(job.location || state.countries[job.country] || 'Location not stated')}</span><span class="meta-separator">·</span><span>${escapeHtml(job.work_mode)}</span>${job.salary?`<span class="meta-separator">·</span><span>${escapeHtml(job.salary)}</span>`:''}</div><div class="job-skills">${skillsTags(match.matched,'',4)}${skillsTags(match.missing.map(s=>'Gap: '+s),'missing',2)}${!match.matched.length&&!match.missing.length?'<span class="skill neutral">Add CV / complete JD to score</span>':''}</div><div class="job-bottom"><div class="job-source"><span>${sourceLink}</span>${job.posted?`<span>·</span><time>${escapeHtml(fmtDate(job.posted))}</time>`:''}</div><div class="job-actions"><button class="text-button" data-open="${job.id}">View match</button>${job.demo?'<span class="subtle">Sample only</span>':link(job.url,'Apply ↗','button secondary small')}${job.status==='Discovered'?`<button class="text-button" data-save="${job.id}" aria-label="Shortlist ${escapeHtml(job.title)}">Save</button>`:''}</div></div></div><div class="job-score-col">${scoreRing(match.score)}${pill(job.status)}</div></article>`;
  }).join('');
}

function renderTracker() {
  const stages = [['Shortlisted',['Saved']],['Applied',['Applied']],['In conversation',['Screening','Interview']],['Offers',['Offer']]];
  $('pipeline').innerHTML = stages.map(([label,statuses])=>`<button class="stage-card" data-stage="${statuses.join(',')}"><small>${label}</small><strong>${state.jobs.filter(j=>statuses.includes(j.status)).length}</strong><div class="stage-line"></div></button>`).join('');
  const due = state.jobs.filter(j=>j.follow_up && j.follow_up<=today() && !['Rejected','Withdrawn'].includes(j.status));
  $('followUps').innerHTML = due.length ? `<div class="due-notice">${due.length} follow-up${due.length>1?'s':''} due. ${due.slice(0,3).map(j=>`<button class="text-button" data-open="${j.id}">${escapeHtml(j.company)}</button>`).join(' · ')}</div>` : '';
  const filter = $('trackerFilter').value;
  let jobs = state.jobs.filter(j=> filter==='all' || (filter==='active' ? ['Saved','Applied','Screening','Interview','Offer'].includes(j.status) : filter.split(',').includes(j.status)));
  jobs.sort((a,b)=>(b.updated||b.created).localeCompare(a.updated||a.created));
  $('trackerList').innerHTML = !jobs.length ? '<div class="empty-state"><h2>Make your first move</h2><p>Save an interesting role or mark a job Applied after you submit on the employer’s website. Your notes and status history will appear here.</p><button class="button primary" data-view="discover">Find jobs</button></div>'
    : `<div class="tracker-table-wrap"><table class="tracker-table"><thead><tr><th>Role & company</th><th>Match</th><th>Stage</th><th>Applied</th><th>Follow-up</th><th></th></tr></thead><tbody>${jobs.map(j=>`<tr><td><button class="job-title-button" data-open="${j.id}">${escapeHtml(j.title)}</button><br><small>${escapeHtml(j.company)}</small></td><td><span class="tracker-score">${j.match.score ?? '—'}</span></td><td>${pill(j.status)}</td><td>${j.applied_at?escapeHtml(fmtDate(j.applied_at)):'—'}</td><td>${j.follow_up?escapeHtml(fmtDate(j.follow_up)):'—'}</td><td><button class="text-button" data-updates="${j.id}">Add update</button></td></tr>`).join('')}</tbody></table></div>`;
}

function populateProfile() {
  const profile = state.profile;
  $('profileName').value = profile.name || ''; $('profileYears').value = profile.years ?? ''; $('profileText').value = profile.text || '';
  $('cvFileName').textContent = profile.filename || 'Or paste your CV in the editor below.';
  $('profileSaved').textContent = profile.updated ? 'Saved '+fmtDate(profile.updated,true) : 'Not saved yet';
  $('profileSkills').innerHTML = state.skills.length ? `<p class="profile-count">${state.skills.length} recognized skills</p><div class="tag-list">${skillsTags(state.skills)}</div>${state.certifications.length?`<h3>Certification keywords</h3><div class="tag-list">${skillsTags(state.certifications,'neutral')}</div>`:''}` : '<p class="muted profile-count">Save your CV to see recognized skills here.</p>';
}

async function importCV(file) {
  if (!file) return;
  if (file.size>8_000_000) throw new Error('Choose a CV smaller than 8 MB.');
  uploading = true; $('cvFileName').textContent = 'Reading '+file.name+'…';
  try {
    const base64 = await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(new Error('Could not read that file.'));r.readAsDataURL(file);});
    const result = await api('/api/extract',{filename:file.name,content:base64});
    $('profileText').value = result.text; $('profileText').dataset.filename = file.name;
    $('cvFileName').textContent = file.name+' · Review the extracted text, then save.'; profileDirty = true;
    toast('CV imported. Check the text and click Save CV.');
  } finally { uploading = false; $('cvFile').value = ''; }
}

function openJobForm(job = null) {
  jobImportController?.abort(); jobImportController = null; jobFormEpoch++; importedJobMeta = null;
  setJobImportBusy(false); notice('jobImportNotice', '');
  $('jobForm').reset(); $('editJobId').value = job?.id || ''; $('jobFormTitle').textContent = job ? 'Edit job details' : 'Add a job';
  $('importJobLink').textContent = job ? 'Fetch details' : 'Fetch & add job';
  const mapping = {jobTitle:'title',jobCompany:'company',jobCountry:'country',jobLocation:'location',jobCategory:'category',jobMode:'work_mode',jobUrl:'url',jobDescription:'description'};
  Object.entries(mapping).forEach(([id,key])=>{$(id).value = job?.[key] || (id==='jobCategory'?'all':id==='jobMode'?'Unspecified':'');});
  $('addDialog').showModal();
}

function setJobImportBusy(active) {
  $('jobForm').querySelectorAll('input, select, textarea, button[type="submit"]').forEach(node => {node.disabled = active;});
  $('importJobLink').disabled = active;
  $('jobForm').setAttribute('aria-busy', String(active));
}

async function importJobLink() {
  if (jobImportController) return;
  const url = window.roleRadarJobImport.publicUrl($('jobUrl').value);
  const controller = new AbortController(), epoch = jobFormEpoch;
  jobImportController = controller;
  const timer = setTimeout(() => controller.abort(), 45000);
  setJobImportBusy(true);
  notice('jobImportNotice', 'Fetching the job title, company, location and description…');
  try {
    const job = await window.roleRadarJobImport.fetchJob(url, state.countries, controller.signal);
    if (controller.signal.aborted || epoch !== jobFormEpoch || !$('addDialog').open) return;
    clearTimeout(timer);
    const editing = Boolean($('editJobId').value);
    const fields = {jobTitle:'title', jobCompany:'company', jobCountry:'country', jobLocation:'location', jobMode:'work_mode', jobDescription:'description'};
    // Keep any fields already entered by the user. The fetched URL is the import identity.
    for (const [id, key] of Object.entries(fields)) {
      if (!$(id).value.trim() || (id === 'jobMode' && $(id).value === 'Unspecified')) $(id).value = job[key] || '';
    }
    $('jobUrl').value = job.url;
    importedJobMeta = {source: job.source, posted: job.posted, salary: job.salary};
    if (editing) {
      notice('jobImportNotice', 'Available details filled in. Your existing text was kept. Review and save your changes.');
      return;
    }
    const data = {...job, title:$('jobTitle').value, company:$('jobCompany').value,
      country:$('jobCountry').value, location:$('jobLocation').value,
      description:$('jobDescription').value, work_mode:$('jobMode').value,
      category:$('jobCategory').value, status:'Saved'};
    notice('jobImportNotice', 'Saving the job and calculating its match…');
    const result = await api('/api/jobs', data);
    $('addDialog').close(); selectedIds = null;
    await refresh();
    toast(result.added ? 'Job imported and saved. Review the fetched details.' : 'This job is already saved. Its existing notes and stage were kept.');
    await openJob(result.job.id, 'jd');
  } catch (error) {
    if (epoch !== jobFormEpoch || !$('addDialog').open) return;
    notice('jobImportNotice', controller.signal.aborted ? 'Fetching timed out. Try again or paste the job description below.' : error.message, 'error');
  } finally {
    clearTimeout(timer);
    if (jobImportController === controller) {jobImportController = null; setJobImportBusy(false);}
  }
}

async function openJob(id, tab = 'match') {
  detailJob = await api('/api/jobs/'+encodeURIComponent(id)); detailTab = tab; renderDetail();
  if (!$('jobDialog').open) $('jobDialog').showModal();
}

function renderDetail() {
  const j=detailJob,m=j.match;
  let body = '';
  if (detailTab === 'match') {
    body = `<p class="match-intro">${escapeHtml(m.confidence)} · Scored against your master CV.</p><h3 class="match-label">Skills found in your CV</h3><div class="tag-list">${m.matched.length?skillsTags(m.matched):'<span class="subtle">No supported matches detected.</span>'}</div><h3 class="match-label amber">Not evidenced in your CV</h3><div class="tag-list">${m.missing.length?skillsTags(m.missing,'missing'):'<span class="subtle">No dictionary-keyword gaps found. Read the full JD.</span>'}</div>${m.components.map(c=>`<div class="component"><div class="component-header"><strong>${escapeHtml(c.name)}</strong><span>${Math.round(c.fraction*100)}% · ${c.normalized_weight}% weight</span></div><div class="component-bar"><span style="width:${c.fraction*100}%"></span></div><p>${escapeHtml(c.detail)}</p></div>`).join('')}<ul class="warning-list">${m.warnings.map(w=>`<li>${escapeHtml(w)}</li>`).join('')}</ul>${m.evidence.length?`<details class="evidence-details"><summary>Show supporting lines from your CV</summary>${m.evidence.map(e=>`<div class="evidence-item"><strong>${escapeHtml(e.skill)}</strong><p>${escapeHtml(e.text)}</p></div>`).join('')}</details>`:''}`;
  } else if (detailTab === 'jd') {
    body = `<div class="section-heading"><span class="subtle">Source: ${escapeHtml(j.source)}</span><button class="text-button" data-edit="${j.id}">Edit details</button></div><pre class="jd-text">${escapeHtml(j.description || 'No job description saved.')}</pre>`;
  } else {
    body = `<form id="noteForm" class="detail-note-form"><label>Add an update<textarea id="noteText" rows="4" placeholder="e.g. Recruiter called. Technical interview on Friday at 3 PM." required maxlength="10000"></textarea></label><button class="button primary" type="submit">Save update</button></form><div class="timeline">${j.notes.length?j.notes.map(n=>`<div class="timeline-item ${n.kind==='status'?'status':''}"><small>${escapeHtml(fmtDate(n.created,true))}</small><p>${escapeHtml(n.text)}</p></div>`).join(''):'<p class="muted">No updates yet. Add your first note above.</p>'}</div>`;
  }
  $('jobDetails').innerHTML = `<div class="detail-top"><div class="company-logo" aria-hidden="true">${escapeHtml(j.company.slice(0,2).toUpperCase())}</div><div class="detail-title"><h2>${escapeHtml(j.title)}</h2><p>${escapeHtml(j.company)} · ${escapeHtml(j.location || state.countries[j.country] || 'Location not stated')}</p></div><button class="icon-button" data-close="jobDialog" aria-label="Close job details">×</button></div><div class="detail-body"><div class="detail-main"><div class="detail-tabs" role="tablist" aria-label="Job detail sections">${[['match','Match breakdown'],['jd','Job description'],['updates','Updates']].map(([id,label])=>`<button role="tab" aria-selected="${id===detailTab}" class="detail-tab ${id===detailTab?'active':''}" data-detail-tab="${id}">${label}</button>`).join('')}</div>${body}</div><aside class="detail-side">${scoreRing(m.score,true)}${j.demo?'<p>Fictional sample. No real application link.</p>':j.url?link(j.url,'Open apply page ↗','button primary'):'<p>No application link. Add one in job details.</p>'}<button class="button secondary" data-tailor="${j.id}">Tailor resume</button><label>Application stage<select id="detailStatus">${state.statuses.map(s=>`<option ${s===j.status?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select></label><p>Mark Applied only after submitting on the employer’s website.</p><label>Follow-up date<input id="detailFollowUp" type="date" value="${escapeHtml(j.follow_up)}"></label><button class="button secondary small" id="saveFollowUp">Save date</button><p>Dates are shown inside the dashboard. No background reminders.</p><button class="text-button danger" data-delete="${j.id}">Delete job</button></aside></div>`;
  if ($('noteForm')) $('noteForm').addEventListener('submit',guarded(async(e)=>{
    e.preventDefault(); const button=e.submitter;
    await busy(button,'Saving…',async()=>{await api('/api/jobs/'+j.id,{note:$('noteText').value});await refresh();await openJob(j.id,'updates');toast('Update saved.');});
  }));
  $('detailStatus').addEventListener('change',guarded(async()=>{const newStatus=$('detailStatus').value;await api('/api/jobs/'+j.id,{status:newStatus});await refresh();await openJob(j.id,detailTab);toast('Stage updated to '+newStatus+'.');}));
  $('saveFollowUp').addEventListener('click',guarded(async()=>{await api('/api/jobs/'+j.id,{follow_up:$('detailFollowUp').value});await refresh();await openJob(j.id,detailTab);toast('Follow-up date saved.');}));
}

function populateResumeJobs() {
  const previous = $('resumeJob').value || activeDraftJob;
  $('resumeJob').innerHTML = '<option value="">Choose a saved job…</option>'+state.jobs.map(j=>`<option value="${j.id}">${escapeHtml(j.title+' · '+j.company)}</option>`).join('');
  if (state.jobs.some(j=>j.id===previous)) $('resumeJob').value=previous;
}
function renderResumeFocus() {
  const job=jobById($('resumeJob').value);
  if (!job) {$('resumeFocus').textContent='Choose a target job to see matched skills and gaps.';return;}
  $('resumeFocus').innerHTML=`<p style="margin-top:14px;font-weight:650;color:var(--ink)">${escapeHtml(job.title)}</p><p class="subtle">${escapeHtml(job.company)}</p><h3 class="match-label">Emphasize real strengths</h3><div class="tag-list">${skillsTags(job.match.matched)}</div><h3 class="match-label amber">Review these gaps</h3><div class="tag-list">${skillsTags(job.match.missing,'missing')||'<span class="subtle">No recognized keyword gaps.</span>'}</div><p class="subtle">Do not add a missing skill unless you genuinely have it. Scores remain based on your master CV.</p>`;
}
function setDraftJob(id) {
  if (draftDirty && activeDraftJob !== id && !confirm('Switch jobs and discard the unsaved draft? Save the draft first if you want to keep it.')) { $('resumeJob').value=activeDraftJob;return false; }
  activeDraftJob=id; $('resumeJob').value=id;
  const job=jobById(id); $('resumeDraft').value=job?.resume_draft || ''; resumeMethod=job?.resume_method || '';
  $('draftMethod').textContent=resumeMethod || 'EDITABLE DRAFT';draftDirty=false;wordCount();renderResumeFocus();notice('resumeNotice','');return true;
}
function wordCount() {const words=$('resumeDraft').value.trim().split(/\s+/).filter(Boolean).length; $('wordCount').textContent=words+' words'+(draftDirty?' · unsaved changes':'');}
async function tailor(method,button) {
  const id=$('resumeJob').value;
  if (!id) throw new Error('Choose a target job first.');
  if (!state.profile.text) {switchView('profile');throw new Error('Save your master CV before tailoring.');}
  if ($('resumeDraft').value.trim() && !confirm('Replace the text currently in this editor? Your last saved draft is kept until you save again.')) return;
  notice('resumeNotice',method==='ollama'?'Your local model is writing. This can take a few minutes; keep the app open.':'Preparing a draft from your saved CV…');
  try {
    await busy(button,method==='ollama'?'Rewriting locally…':'Tailoring…',async()=>{
      const result=await api('/api/tailor',{job_id:id,method});
      // A user may switch target jobs during a slow generation. Never attach the result to the wrong job.
      if ($('resumeJob').value !== id) {notice('resumeNotice','The target job changed during generation. Select the original job and generate again.','warn');return;}
      $('resumeDraft').value=result.text;resumeMethod=result.method;$('draftMethod').textContent=result.method;activeDraftJob=id;draftDirty=true;wordCount();
      notice('resumeNotice',result.warnings.join(' '),'warn');toast('Draft ready. Review and save it for this job.');
    });
  } catch(e) {notice('resumeNotice',e.message,'error');}
}

async function performSearch(loadMore=false) {
  const filters=loadMore?{...lastSearch,cursor:nextCursor}:{source:$('source').value,query:$('query').value.trim(),country:$('country').value,location:$('location').value.trim(),category:$('category').value,date_posted:$('datePosted').value,remote:$('remoteOnly').checked};
  const button=loadMore?$('loadMore'):$('searchButton');
  notice('searchNotice','Searching '+(filters.source==='saved'?'your workspace':filters.source==='remotive'?'Remotive':'JSearch')+'…');
  try {
    await busy(button,'Searching…',async()=>{
      const result=await api('/api/search',filters);
      selectedIds=new Set(loadMore?[...(selectedIds||[]),...result.ids]:result.ids); nextCursor=result.cursor;lastSearch={...filters,cursor:''};
      await refresh();notice('searchNotice',`${result.ids.length} result${result.ids.length===1?'':'s'} · ${result.added} new jobs saved. ${result.message}`);
    });
  } catch(e) {notice('searchNotice',e.message,'error');}
}

async function globalClick(event) {
  const button=event.target.closest('button, [data-view]');if(!button)return;
  if(button.dataset.view) return switchView(button.dataset.view);
  if(button.dataset.close) return $(button.dataset.close).close();
  if(button.dataset.open) return openJob(button.dataset.open);
  if(button.dataset.updates) return openJob(button.dataset.updates,'updates');
  if(button.dataset.save) {await api('/api/jobs/'+button.dataset.save,{status:'Saved'});await refresh();toast('Job shortlisted.');return;}
  if(button.dataset.detailTab) {detailTab=button.dataset.detailTab;renderDetail();return;}
  if(button.dataset.edit) {const j=jobById(button.dataset.edit);$('jobDialog').close();openJobForm(j);return;}
  if(button.dataset.tailor) {if(setDraftJob(button.dataset.tailor)){$('jobDialog').close();switchView('resume');}return;}
  if(button.dataset.delete) {
    if(!confirm('Delete this job, its notes and its saved resume draft? This cannot be undone unless you have a backup.'))return;
    await api('/api/jobs/'+button.dataset.delete+'/delete',{});$('jobDialog').close();await refresh();toast('Job, notes and draft deleted. Restore from a backup if needed.');return;
  }
  if(button.dataset.stage) {
    let option=$('trackerFilter').querySelector('option[value="'+button.dataset.stage+'"]');
    if(!option){option=document.createElement('option');option.value=button.dataset.stage;option.textContent=button.dataset.stage.replace(',', ' / ');$('trackerFilter').append(option);}
    $('trackerFilter').value=button.dataset.stage;renderTracker();return;
  }
  if(button.dataset.results) {shortlistOnly=button.dataset.results==='saved';document.querySelectorAll('[data-results]').forEach(b=>b.classList.toggle('active',b===button));renderJobs();return;}
  if(button.dataset.action==='add') return openJobForm();
  if(button.dataset.action==='reset') return resetResults();
  if(button.dataset.action==='demo') {await api('/api/demo',{});await refresh();toast('Fictional sample loaded. Remove it in Connections & data before adding your own CV.');}
}

function resetResults(){selectedIds=null;nextCursor='';shortlistOnly=false;$('minScore').value='0';document.querySelectorAll('[data-results]').forEach(b=>b.classList.toggle('active',b.dataset.results==='all'));notice('searchNotice','');renderJobs();}

function bind() {
  document.addEventListener('click',guarded(globalClick));
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  $('addJob').onclick=()=>openJobForm();$('trackerAdd').onclick=()=>openJobForm();
  $('importJobLink').onclick=guarded(importJobLink);
  $('jobUrl').addEventListener('input', () => {importedJobMeta = null; notice('jobImportNotice', '');});
  $('jobUrl').addEventListener('keydown', guarded(async event => {
    if (event.key === 'Enter') {event.preventDefault(); await importJobLink();}
  }));
  $('addDialog').addEventListener('close', () => {
    jobImportController?.abort(); jobImportController = null; jobFormEpoch++; setJobImportBusy(false);
  });
  $('source').onchange=sourceNote;$('sort').onchange=renderJobs;$('minScore').onchange=renderJobs;$('trackerFilter').onchange=renderTracker;
  $('searchForm').onsubmit=e=>{e.preventDefault();performSearch();};$('loadMore').onclick=()=>performSearch(true);$('resetResults').onclick=resetResults;
  $('scoreGuide').onclick=()=>$('guideDialog').showModal();
  $('profileForm').addEventListener('input',()=>{profileDirty=true;});
  $('profileForm').onsubmit=guarded(async(e)=>{
    e.preventDefault();if(uploading)throw new Error('Please wait for the import to finish.');
    await busy(e.submitter,'Saving…',async()=>{await api('/api/profile',{name:$('profileName').value,years:$('profileYears').value,text:$('profileText').value,filename:$('profileText').dataset.filename||state.profile.filename||'Pasted CV',demo:false});profileDirty=false;delete $('profileText').dataset.filename;await refresh();toast('CV saved. All match scores have been refreshed.');});
  });
  $('cvFile').onchange=guarded(e=>importCV(e.target.files[0]));
  $('jobForm').onsubmit=guarded(async(e)=>{
    e.preventDefault();const id=$('editJobId').value;
    if (jobImportController) return;
    const data={...(importedJobMeta || {}),title:$('jobTitle').value,company:$('jobCompany').value,country:$('jobCountry').value,location:$('jobLocation').value,category:$('jobCategory').value,work_mode:$('jobMode').value,url:$('jobUrl').value,description:$('jobDescription').value};
    await busy(e.submitter,'Saving…',async()=>{const result=await api(id?'/api/jobs/'+id:'/api/jobs',data);$('addDialog').close();selectedIds=null;await refresh();toast(id?'Job updated.':result.added?'Job saved and matched.':'This job was already saved. Open the existing record to edit it.');if(id)await openJob(id,'jd');});
  });
  $('resumeJob').onchange=()=>setDraftJob($('resumeJob').value);
  $('resumeDraft').oninput=()=>{draftDirty=true;wordCount();};
  $('tailorLocal').onclick=guarded(()=>tailor('local',$('tailorLocal')));$('tailorAI').onclick=guarded(()=>tailor('ollama',$('tailorAI')));
  $('saveDraft').onclick=guarded(async()=>{const id=$('resumeJob').value;if(!id)throw new Error('Choose a target job.');await busy($('saveDraft'),'Saving…',async()=>{await api('/api/jobs/'+id,{resume_draft:$('resumeDraft').value,resume_method:resumeMethod||'Edited draft'});draftDirty=false;await refresh();wordCount();toast('Draft saved for this job.');});});
  $('exportDocx').onclick=guarded(async()=>{if(!$('resumeDraft').value.trim())throw new Error('Create or paste a draft first.');await busy($('exportDocx'),'Preparing…',async()=>{const blob=await api('/api/docx',{text:$('resumeDraft').value},true);download(blob,filenameBase()+'.docx');});});
  $('exportTxt').onclick=guarded(()=>{if(!$('resumeDraft').value.trim())throw new Error('Create a draft first.');download(new Blob([$ ('resumeDraft').value],{type:'text/plain;charset=utf-8'}),filenameBase()+'.txt');});
  $('exportPdf').onclick=guarded(()=>{if(!$('resumeDraft').value.trim())throw new Error('Create a draft first.');$('printArea').textContent=$('resumeDraft').value;window.print();});
  $('keyForm').onsubmit=guarded(async(e)=>{e.preventDefault();const key=$('apiKey').value.trim();if(!key)throw new Error('Paste an OpenWeb Ninja API key.');await api('/api/settings',{api_key:key});$('apiKey').value='';await refresh();toast('Key connected for this session. Run a search to verify access.');});
  $('disconnectKey').onclick=guarded(async()=>{await api('/api/settings',{api_key:''});await refresh();toast('Session key disconnected.');});
  $('detectModels').onclick=guarded(async()=>{await busy($('detectModels'),'Looking…',async()=>{const result=await api('/api/models',{});$('ollamaModel').innerHTML='<option value="">Choose a local model</option>'+result.models.map(m=>`<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');if(result.models.includes(state.settings.model))$('ollamaModel').value=state.settings.model;else if(result.models.length)$('ollamaModel').value=result.models[0];$('modelStatus').textContent=result.models.length?`${result.models.length} installed local model(s) found. Choose one and save.`:'No local models found. Download one with Ollama, then try again.';});});
  $('saveModel').onclick=guarded(async()=>{if(!$('ollamaModel').value)throw new Error('Choose an installed model.');await api('/api/settings',{model:$('ollamaModel').value});await refresh();toast('Local AI model selected.');});
  $('backup').onclick=guarded(async()=>{download(await api('/api/backup',undefined,true),'RoleRadar-backup-'+today()+'.json');toast('Backup downloaded. Keep it private.');});
  $('restoreFile').onchange=guarded(async(e)=>{const file=e.target.files[0];e.target.value='';if(!file)return;if(file.size>15_000_000)throw new Error('Backup exceeds 15 MB.');if(!confirm('Merge this backup into your workspace? Existing jobs and your current CV will not be overwritten.'))return;let data;try{data=JSON.parse(await file.text());}catch{throw new Error('Not a valid JSON file.');}const result=await api('/api/restore',data);await refresh();toast(result.message);});
  $('clearDemo').onclick=guarded(async()=>{if(!confirm('Remove all fictional sample jobs, their updates and the sample CV? Your non-sample records will be kept.'))return;await api('/api/clear-demo',{});selectedIds=null;activeDraftJob='';$('resumeDraft').value='';draftDirty=false;await refresh();toast('Sample records removed. Other saved records were kept.');});
  window.addEventListener('beforeunload',e=>{if(draftDirty||profileDirty){e.preventDefault();e.returnValue='';}});
  document.querySelector('.brand').onclick=e=>{e.preventDefault();switchView('discover');};
}

function registerAgentTools() {
  const context = document.modelContext;
  if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  const tools=[
    {name:'list_saved_job_matches',title:'List saved job matches',description:'Read the local job workspace and current CV/JD match scores. Does not search the internet or change data.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async(input)=>{if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('No input fields are accepted.');return state.jobs.map(j=>({id:j.id,title:j.title,company:j.company,score:j.match.score,status:j.status}));}},
    {name:'open_saved_job',title:'Open a saved job',description:'Navigate to a saved job detail panel. Does not apply, update status or submit anything.',inputSchema:{type:'object',properties:{job_id:{type:'string'}},required:['job_id'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async(input)=>{if(!input||typeof input.job_id!=='string'||Object.keys(input).some(k=>k!=='job_id')||!jobById(input.job_id))throw new Error('A valid saved job_id is required.');await openJob(input.job_id);return {opened:input.job_id};}}
  ];
  for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}

async function boot() {
  try {
    if (window.roleRadarOnline) await window.roleRadarOnline.ready();
    else {
      const response=await fetch('/api/bootstrap');if(!response.ok)throw new Error('Start RoleRadar using its launcher, then open the local address shown in its window.');
      token=(await response.json()).token;
    }
    Object.assign(state,await api('/api/state'));
    $('country').innerHTML=options(state.countries,'All locations');$('country').value=window.roleRadarOnline?'':'ae';
    $('jobCountry').innerHTML=options(state.countries,'Not stated / worldwide');
    $('category').innerHTML=options(state.categories);$('category').value=window.roleRadarOnline?'all':'vm';$('jobCategory').innerHTML=options(state.categories);
    if (window.roleRadarOnline) $('query').value='';
    state.statuses.forEach(s=>{const option=document.createElement('option');option.value=s;option.textContent=s;$('trackerFilter').append(option);});
    $('source').value=window.roleRadarOnline?'boards':state.jsearch_connected?'boards':'remotive';
    bind();await refresh();switchView(location.hash.slice(1)||'discover');registerAgentTools();
    $('loading').hidden=true;$('content').hidden=false;booted=true;
  } catch(e) {$('loading').hidden=true;$('fatal').textContent=e.message;$('fatal').hidden=false;}
}
boot();
