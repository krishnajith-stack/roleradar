import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadPyodide} from 'pyodide';
import {JSDOM} from 'jsdom';
import vm from 'node:vm';
import {indexedDB} from 'fake-indexeddb';

async function main() {
const root = new URL('../', import.meta.url);
const runtime = await loadPyodide();
await runtime.loadPackage('sqlite3');
runtime.FS.mkdirTree('/roleradar/data');
for (const name of ['app.py', 'browser_api.py']) {
  runtime.FS.writeFile('/roleradar/' + name, await readFile(new URL('site/' + name, root), 'utf8'));
}
await runtime.runPythonAsync("import sys\nsys.path.insert(0, '/roleradar')\nimport browser_api\nbrowser_api.app.initialize()\n");
const request = payload => {
  runtime.globals.set('request_json', JSON.stringify(payload));
  const envelope = JSON.parse(runtime.runPython('browser_api.request(request_json)'));
  runtime.globals.delete('request_json');
  if (envelope.error) throw new Error(envelope.error);
  return envelope.result;
};
assert.equal(request({path: '/api/state'}).jobs.length, 0);
request({path: '/api/demo', data: {}});
const state = request({path: '/api/state'});
assert.equal(state.jobs.length, 4);
assert.ok(state.jobs.some(job => job.match.score >= 75));
const identifier = state.jobs[0].id;
request({path: '/api/jobs/' + identifier, data: {status: 'Applied', note: 'Runtime regression test'}});
const draft = request({path: '/api/tailor', data: {job_id: identifier, method: 'local'}});
const docx = request({path: '/api/docx', data: {text: draft.text}});
assert.ok(Buffer.from(docx.base64, 'base64').length > 500);
assert.ok(request({path: '/api/extract', data: {filename: 'cv.docx', content: docx.base64}}).text.includes('Alex Morgan'));
await runtime.loadPackage('micropip');
await runtime.runPythonAsync("import micropip\nawait micropip.install('pypdf==6.0.0')");
const pdf = runtime.runPython(`
import io, base64
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
writer = PdfWriter()
page = writer.add_blank_page(width=595, height=842)
font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
stream = DecodedStreamObject()
stream.set_data(b'BT /F1 12 Tf 50 750 Td (Alex Morgan security engineer with Qualys and vulnerability management experience.) Tj ET')
page[NameObject('/Contents')] = stream
buffer = io.BytesIO()
writer.write(buffer)
base64.b64encode(buffer.getvalue()).decode()
`);
assert.ok(request({path: '/api/extract', data: {filename: 'cv.pdf', content: pdf}}).text.includes('vulnerability management'));
console.log('PASS: pinned PDF parser and actual PDF text extraction');
const backup = request({path: '/api/backup'});
assert.equal(backup.jobs.length, 4);
const snapshot = runtime.FS.readFile('/roleradar/data/roleradar.sqlite3').slice();
runtime.FS.unlink('/roleradar/data/roleradar.sqlite3');
runtime.FS.writeFile('/roleradar/data/roleradar.sqlite3', snapshot);
assert.equal(request({path: '/api/jobs/' + identifier}).status, 'Applied');
console.log('PASS: actual WebAssembly engine, scoring, notes, DOCX round-trip, backups and snapshot persistence');

const html = await readFile(new URL('site/index.html', root), 'utf8');
const dom = new JSDOM(html, {url: 'https://example.test/roleradar/', runScripts: 'outside-only', pretendToBeVisual: true});
const window = dom.window;
window.scrollTo = () => {};
window.confirm = () => true;
window.CSS = {escape: value => value};
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const source = await readFile(new URL('site/worker.js', root), 'utf8');
// Exercise the unconfigured state regardless of the deployed provider snapshot.
const initialFeed = {version: 1, status: 'not_configured', generated_at: null, jobs: []};
const feedFetch = async () => ({ok: true, json: async () => initialFeed});
window.fetch = feedFetch;
window.AbortController = AbortController;
let lock = Promise.resolve();
window.Worker = class {
  constructor() {
    const owner = this;
    const scope = {
      URL, Uint8Array, ArrayBuffer, console, indexedDB,
      navigator: {locks: {request: (_name, callback) => {
        const result = lock.then(callback);
        lock = result.catch(() => {});
        return result;
      }}},
      loadPyodide: async () => runtime,
      importScripts: () => {},
      fetch: async url => ({ok: true, text: () => readFile(new URL('site/' + new URL(url).pathname.split('/').pop(), root), 'utf8')}),
      location: {href: 'https://example.test/roleradar/worker.js'},
      postMessage: data => queueMicrotask(() => owner.onmessage?.({data}))
    };
    scope.self = scope;
    this.context = vm.createContext(scope);
    vm.runInContext(source, this.context);
  }
  postMessage(data) { this.context.onmessage({data}); }
};
window.eval(await readFile(new URL('site/online.js', root), 'utf8'));
window.eval(await readFile(new URL('site/app.js', root), 'utf8'));
for (let attempt = 0; attempt < 100 && window.document.getElementById('content').hidden; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 50));
}
assert.equal(window.document.getElementById('fatal').hidden, true);
assert.equal(window.document.getElementById('content').hidden, false);
assert.equal(window.document.getElementById('navJobs').textContent, '0');
assert.equal(window.document.getElementById('tailorAI').hidden, true);
assert.ok(window.document.getElementById('sourceNote').textContent.includes('not connected'));
assert.equal(window.document.getElementById('searchButton').disabled, true);
window.document.getElementById('source').value = 'saved';
window.document.getElementById('source').dispatchEvent(new window.Event('change'));
assert.equal(window.document.getElementById('searchButton').disabled, false);
assert.equal(window.document.getElementById('searchButton').textContent, 'Search saved jobs');
window.document.getElementById('source').value = 'boards';
window.document.getElementById('source').dispatchEvent(new window.Event('change'));
window.document.getElementById('query').value = 'Security & IT Lead';
window.document.getElementById('location').value = 'Dubai';
window.document.getElementById('country').value = 'ae';
window.document.getElementById('country').dispatchEvent(new window.Event('change'));
const boardUrl = new URL(window.document.getElementById('linkedinSearch').href);
assert.equal(boardUrl.hostname, 'www.linkedin.com');
assert.equal(boardUrl.searchParams.get('keywords'), 'Security & IT Lead');
assert.equal(boardUrl.searchParams.get('location'), 'Dubai, United Arab Emirates');
assert.ok(!boardUrl.searchParams.has('cv'));
window.document.getElementById('pasteBoardJob').click();
assert.equal(window.document.getElementById('addDialog').open, true);
window.document.getElementById('addDialog').close();
console.log('PASS: unconfigured-feed guidance, saved search and encoded job-board handoff');
window.document.querySelector('[data-action="demo"]').click();
for (let attempt = 0; attempt < 100 && window.document.getElementById('navJobs').textContent !== '4'; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 50));
}
assert.equal(window.document.getElementById('navJobs').textContent, '4');
assert.equal(window.document.querySelectorAll('.job-card').length, 4);
window.document.querySelector('[data-view="tracker"]').click();
assert.equal(window.document.getElementById('view-tracker').hidden, false);
window.document.querySelector('[data-view="profile"]').click();
assert.ok(window.document.getElementById('profileText').value.includes('Alex Morgan'));
window.document.getElementById('addJob').click();
assert.equal(window.document.getElementById('addDialog').open, true);
console.log('PASS: UI bootstrap, job cards, navigation, CV editor and add-job dialog');
const beforeFailure = await window.roleRadarOnline.api('/api/state');
const onlineId = beforeFailure.jobs[0].id;
await window.roleRadarOnline.api('/api/jobs/' + onlineId, {status: 'Applied', note: 'Persisted via IndexedDB'});
await assert.rejects(window.roleRadarOnline.api('/api/jobs/' + onlineId, {status: 'Offer', follow_up: 'invalid'}));
assert.equal((await window.roleRadarOnline.api('/api/jobs/' + onlineId)).status, 'Applied');
assert.ok((await window.roleRadarOnline.api('/api/jobs/' + onlineId)).notes.some(note => note.text === 'Persisted via IndexedDB'));
await assert.rejects(window.roleRadarOnline.api('/api/search', {source: 'boards'}), /not connected/);
console.log('PASS: actual worker transport, IndexedDB snapshots, failed-write rollback and unconfigured feed');
window.close();
}

main().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
