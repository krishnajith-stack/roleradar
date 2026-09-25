import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('', {url:'https://example.org/roleradar/', runScripts:'outside-only'});
dom.window.eval(readFileSync(new URL('../static/job-import.js', import.meta.url), 'utf8'));
const importer = dom.window.roleRadarJobImport;
const countries = {in:'India', ae:'United Arab Emirates', gb:'United Kingdom'};
const description = '<p>Manage enterprise vulnerabilities using Qualys and ServiceNow.</p><ul><li>Coordinate remediation with application owners and infrastructure teams.</li><li>Report risk and remediation progress.</li></ul>';
const job = {'@type':'JobPosting', title:'Vulnerability Management Engineer', description,
  hiringOrganization:{name:'Example Employer'}, jobLocation:{address:{addressLocality:'Kochi',addressRegion:'Kerala',addressCountry:'IN'}},
  jobLocationType:'TELECOMMUTE', datePosted:'2026-09-25', baseSalary:{currency:'INR',value:{minValue:100000,maxValue:150000,unitText:'MONTH'}}};
const html = data => '<html><head><script type="application/ld+json">' + JSON.stringify(data).replaceAll('<', '\\u003c') + '</script></head><body></body></html>';
const url = 'https://careers.example.com/jobs/42';
let result = importer.parse(html({'@graph':[job]}), url, countries);
assert.equal(result.title, job.title); assert.equal(result.company,'Example Employer');
assert.equal(result.country,'in'); assert.equal(result.work_mode,'Remote');
assert.equal(result.location,'Kochi, Kerala, IN'); assert.match(result.salary,/100000/);
assert.ok(!result.description.includes('<p>')); assert.match(result.description,/\n/);
assert.equal(importer.publicUrl('https://in.linkedin.com/jobs/view/security-engineer-123456?trackingId=abc'), 'https://in.linkedin.com/jobs/view/security-engineer-123456');
assert.throws(()=>importer.publicUrl('https://www.linkedin.com/jobs/search/?currentJobId=123456'), /direct link/);
for (const bad of ['javascript:alert(1)','https://localhost/x','http://127.0.0.1/','http://2130706433/','http://[::1]/','http://user:pass@example.com/','https://server.internal/job','https://example.com:8080/job']) {
  assert.throws(()=>importer.publicUrl(bad));
}
assert.equal(importer.publicUrl(url+'?utm_source=mail&jobId=42#apply'),url+'?jobId=42');
assert.throws(()=>importer.parse(html([job,{...job,title:'Different role'}]),url,countries),/several jobs/);
assert.equal(importer.parse(html([{...job,url},{...job,title:'Different',url:url+'2'}]),url,countries).title, job.title);
assert.throws(()=>importer.parse(html({...job,validThrough:'2020-01-01'}),url,countries),/expired/);
assert.throws(()=>importer.parse('<h1>Sign in</h1><p>Join our network</p>',url,countries),/publicly/);
assert.throws(()=>importer.parse('<h1>Security roles</h1><p>Some site navigation</p>',url,countries),/complete job/);
result = importer.parse(html({...job,description:description.replaceAll('<','&lt;').replaceAll('>','&gt;')}),url,countries);
assert.ok(!result.description.includes('<li>')); assert.match(result.description,/Coordinate/);
result = importer.parse(html({...job,description:description+'<script>window.compromised=true</script><img src="https://evil.example/x" onerror="alert(1)">'}),url,countries);
assert.ok(!result.description.includes('compromised')); assert.equal(dom.window.compromised,undefined);
result = importer.parse('<title>Job Application for Security Engineer at Example Employer</title><h1>Security Engineer</h1><div class="job__location">Dubai, United Arab Emirates</div><div class="job__description">'+description+'</div>', 'https://job-boards.greenhouse.io/example/jobs/42',countries);
assert.equal(result.company,'Example Employer'); assert.equal(result.country,'ae');

let captured;
dom.window.fetch = async (endpoint, options) => {
  captured={endpoint,options};
  return {ok:true,headers:new Map(),text:async()=>JSON.stringify({data:{html:html(job),url,httpStatus:200}})};
};
result = await importer.fetchJob(url,countries);
assert.equal(result.company,'Example Employer'); assert.equal(captured.endpoint,'https://r.jina.ai/'+url);
assert.equal(captured.options.credentials,'omit'); assert.equal(captured.options.referrerPolicy,'no-referrer');
assert.equal(captured.options.body,undefined);
dom.window.fetch = async () => ({ok:false,status:429});
await assert.rejects(importer.fetchJob(url,countries),/rate limited/);
dom.window.fetch = async () => ({ok:true,headers:new Map(),text:async()=>JSON.stringify({data:{html:html(job),url,httpStatus:403}})});
await assert.rejects(importer.fetchJob(url,countries),/publicly/);
dom.window.fetch = async () => ({ok:true,headers:new Map([['content-length','5000001']])});
await assert.rejects(importer.fetchJob(url,countries),/too large/);
console.log('PASS: structured extraction, HTML fallback, URL validation, privacy, expiry, ambiguous pages, hostile HTML and reader failures');
dom.window.close();
