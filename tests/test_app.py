"""Focused regression checks. Run: python -m unittest discover -s tests -v"""
import base64
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
import zipfile
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


CV = '''Jordan Example
PROFESSIONAL SUMMARY
Vulnerability management engineer with 10 years of experience.
EXPERIENCE
Security Engineer | Example A | 2020–2025
- Maintained Qualys VMDR and ServiceNow vulnerability management workflows.
- Worked with Windows Server and patch management.
- Supported risk-based prioritization and threat intelligence.
Systems Engineer | Example B | 2015–2020
- Supported Microsoft 365, SCCM, Active Directory and Azure AD.
CERTIFICATIONS
AZ-500 | Security+
Currently studying for CISM
'''
JOB = {'title':'Vulnerability Management Engineer', 'company':'Example Employer', 'country':'ae',
       'location':'Dubai, United Arab Emirates', 'category':'vm', 'url':'https://example.com/jobs/1?utm_source=test',
       'description':'Required: 5 years of experience in vulnerability management, Qualys, ServiceNow, patch management and Windows Server. AZ-500 preferred.'}


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='roleradar-test-')
        self.original = app.DATA; app.DATA = Path(self.tmp.name); app.initialize()
        self.profile = app.prepare_profile({'text':CV,'years':10,'name':'Jordan Example'})
    def tearDown(self):
        app.DATA = self.original; self.tmp.cleanup()

    def test_scores_evidence_and_ranking(self):
        good = app.matching(self.profile, JOB)
        other = app.matching(self.profile, {**JOB,'title':'Cloud Developer','description':'Required: AWS, GCP, Kubernetes, Docker, Terraform, Python, JavaScript, React and CISSP. Minimum 15 years experience.'})
        self.assertGreater(good['score'], other['score']); self.assertTrue(1 <= other['score'] <= 100)
        self.assertIn('Qualys', good['matched']); self.assertTrue(good['evidence'])
        self.assertIn('CISSP', other['components'][-1]['detail'])
        self.assertIsNone(app.matching({}, JOB)['score'])
        self.assertIsNone(app.matching(self.profile, {**JOB,'description':''})['score'])

    def test_aliases_negation_certifications(self):
        found = app.evidence(CV, app.SKILLS)
        self.assertIn('Entra ID',found); self.assertIn('SCCM',app.detected('MECM deployment',app.SKILLS))
        self.assertNotIn('Qualys',app.evidence('No experience with Qualys.',app.SKILLS))
        self.assertNotIn('CISM',app.evidence(CV,app.CERTS))
        self.assertIn('Security+',app.evidence(CV,app.CERTS))

    def test_duplicate_link_does_not_reset_pipeline(self):
        job,new = app.save_job(JOB); self.assertTrue(new)
        app.update_job(job['id'],{'status':'Applied','note':'Applied on employer website.','follow_up':'2026-10-01'})
        duplicate,new = app.save_job({**JOB,'url':'https://example.com/jobs/1?utm_source=other','status':'Discovered'},refresh=True)
        self.assertFalse(new); self.assertEqual(duplicate['status'],'Applied')
        self.assertEqual(len(app.all_jobs()),1); self.assertEqual(len(app.notes_for(job['id'])),2)
        self.assertEqual(duplicate['follow_up'],'2026-10-01'); self.assertTrue(duplicate['applied_at'])

    def test_date_validation_and_hostile_url(self):
        job,_=app.save_job(JOB)
        with self.assertRaises(ValueError): app.update_job(job['id'],{'follow_up':'not-a-date','status':'Offer'})
        self.assertEqual(app.get_job(job['id'])['status'],'Discovered')
        for url in ['javascript:alert(1)','file:///etc/passwd','https://user:secret@example.com']:
            with self.assertRaises(ValueError): app.validate_url(url)

    def test_geography_and_specialism(self):
        job=app.normalize_job(JOB)
        self.assertTrue(app.filter_job(job,{'country':'ae','category':'vm'}))
        self.assertFalse(app.filter_job(job,{'country':'in'}))
        self.assertFalse(app.filter_job(job,{'location':'Kochi'}))
        self.assertFalse(app.filter_job(job,{'category':'pentest'}))
        remote={**job,'country':'','location':'Worldwide','work_mode':'Remote'}
        self.assertTrue(app.job_in_country(remote,'in'))
        self.assertFalse(app.job_in_country({**remote,'location':'United States only'},'in'))
        self.assertFalse(app.job_in_country({**remote,'location':'Worldwide excluding India'},'in'))
        self.assertFalse(app.job_in_country({**remote,'location':'US only, not worldwide'},'in'))

    def test_docx_round_trip_and_html_sanitizing(self):
        blob=app.docx_bytes(CV)
        self.assertEqual(app.extract_document('cv.docx',blob).replace('\n\n','\n'), CV.strip().replace('\n\n','\n'))
        with zipfile.ZipFile(io.BytesIO(blob)) as z: self.assertIsNone(z.testzip())
        self.assertEqual(app.plain('<p>Real job</p><script>evil()</script>'),'Real job')

    def test_tailoring_keeps_employer_attribution(self):
        result=app.local_tailor(self.profile,JOB)
        self.assertIn('RELEVANT SKILLS',result['text']);self.assertNotIn('CISSP',result['text'])
        self.assertLess(result['text'].index('Security Engineer | Example A'),result['text'].index('Systems Engineer | Example B'))
        self.assertLess(result['text'].index('Maintained Qualys'),result['text'].index('Systems Engineer | Example B'))
        self.assertEqual(self.profile['text'],CV.strip())

    def test_backup_merge_and_atomic_rejection(self):
        app.kv_set('profile',self.profile);job,_=app.save_job(JOB);app.update_job(job['id'],{'note':'Keep this note.'})
        data=app.backup_data();self.assertNotIn('api_key',json.dumps(data))
        self.assertEqual(app.restore_data(data)['added'],0);self.assertEqual(len(app.notes_for(job['id'])),1)
        data['jobs'].append({**JOB,'url':'https://example.com/jobs/2','notes':[{'text':'Restored.'}]})
        self.assertEqual(app.restore_data(data)['added'],1);self.assertEqual(len(app.all_jobs()),2)
        bad={**data,'jobs':[{**JOB,'url':'https://example.com/jobs/3'}, {'title':''}]}
        with self.assertRaises(ValueError):app.restore_data(bad)
        self.assertEqual(len(app.all_jobs()),2)

    def test_provider_parsing_and_cache(self):
        data={'data':{'jobs':[{'job_title':'VM Engineer','employer_name':'Example','job_description':JOB['description'],
                              'job_country':'AE','job_city':'Dubai','job_apply_link':'https://example.com/jobs/a'}], 'cursor':'next-page'}}
        jobs,cursor=app.normalize_jsearch(data,{'country':'ae'})
        self.assertEqual(cursor,'next-page');self.assertEqual(jobs[0]['country'],'ae')
        with patch.object(app,'remote_json',return_value={'jobs':[{'id':1,'title':'Vulnerability Engineer','company_name':'Example','description':JOB['description'],
                                                                'url':'https://remotive.com/test','candidate_required_location':'Worldwide'}]}) as call:
            filters={'country':'in','category':'vm','query':'vulnerability','date_posted':'all'}
            self.assertEqual(len(app.search_remotive(filters)[0]),1)
            app.search_remotive({**filters,'country':'ae'});self.assertEqual(call.call_count,1)

    def test_demo_never_overwrites_real_workspace(self):
        app.save_job(JOB)
        with self.assertRaises(ValueError):app.sample_data()
        self.assertEqual(len(app.all_jobs()),1)

    def test_ai_keyword_guard_and_cloud_model_exclusion(self):
        models={'models':[{'name':'local-model:latest','size':2000000000},
                          {'name':'cloud:latest','size':0},
                          {'name':'renamed-remote:latest','size':2000000000,'remote_host':'https://ollama.com'}]}
        with patch.object(app,'remote_json',return_value=models):
            self.assertEqual(app.ollama_models(),['local-model:latest'])
        with patch.object(app,'ollama_models',return_value=['local-model:latest']), patch.object(app,'remote_json',return_value={'message':{'content':json.dumps({'resume':CV+'\nExpert in Kubernetes and CISSP.','warnings':[],'changes':[]})}}):
            with self.assertRaises(ValueError):app.ai_tailor(self.profile,JOB,'local-model:latest')
        with patch.object(app,'ollama_models',return_value=['local-model:latest']), patch.object(app,'remote_json',return_value={'message':{'content':json.dumps({'resume':CV,'warnings':[],'changes':['Used supported evidence.']})}}):
            self.assertIn('local-model',app.ai_tailor(self.profile,JOB,'local-model:latest')['method'])

    def test_http_security_and_persistence(self):
        server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        port=server.server_address[1];server.allowed_hosts={f'127.0.0.1:{port}'}
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url=f'http://127.0.0.1:{port}'
        def request(path,data=None,auth=True,extra=None):
            headers={'Content-Type':'application/json',**({'X-RoleRadar-Token':app.TOKEN} if auth else {}),**(extra or {})}
            req=urllib.request.Request(url+path,data=json.dumps(data).encode() if data is not None else None,headers=headers)
            with urllib.request.urlopen(req) as response:return json.loads(response.read())
        try:
            self.assertEqual(request('/api/health')['app'],'RoleRadar')
            with self.assertRaises(urllib.error.HTTPError) as e:request('/api/state',auth=False)
            self.assertEqual(e.exception.code,403)
            with self.assertRaises(urllib.error.HTTPError):request('/api/bootstrap',extra={'Origin':'https://evil.example'})
            request('/api/profile',{'text':CV,'years':10})
            record=request('/api/jobs',JOB)['job'];request('/api/jobs/'+record['id'],{'status':'Applied','note':'Test update'})
            app.initialize() # No destructive startup migrations or resets.
            returned=request('/api/state');self.assertEqual(returned['jobs'][0]['status'],'Applied')
            self.assertEqual(len(request('/api/jobs/'+record['id'])['notes']),2)
            for path in ['/app.py','/data/roleradar.sqlite3','/../app.py']:
                with self.assertRaises(urllib.error.HTTPError) as e:request(path)
                self.assertEqual(e.exception.code,404)
        finally:server.shutdown();server.server_close();thread.join(timeout=3)


if __name__=='__main__':unittest.main()
