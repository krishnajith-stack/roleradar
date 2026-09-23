import base64
from datetime import datetime, timezone, timedelta
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import app
import browser_api
from test_app import CV, JOB

ROOT = Path(__file__).resolve().parents[1]


class OnlineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original = app.DATA
        app.DATA = Path(self.tmp.name)
        app.initialize()

    def tearDown(self):
        app.DATA = self.original
        self.tmp.cleanup()

    def test_platform_host_validation(self):
        for url, expected in [
            ('https://www.linkedin.com/jobs/view/123', 'LinkedIn'),
            ('https://in.linkedin.com/jobs/view/123', 'LinkedIn'),
            ('https://www.naukri.com/job-listings-test-123', 'Naukri'),
            ('https://linkedin.com.evil.example/jobs/123', ''),
            ('https://notlinkedin.com/jobs/123', ''),
            ('https://linkedin.com@evil.example/jobs/123', ''),
            ('javascript:alert(1)', ''),
        ]:
            self.assertEqual(app.job_platform(url), expected)

    def test_provider_alternate_apply_links_and_strict_sources(self):
        raw = {'data': {'jobs': [
            {'job_title': 'GRC Analyst', 'employer_name': 'Example', 'job_country': 'IN',
             'job_apply_link': 'https://example.org/jobs/1', 'job_publisher': 'Example',
             'apply_options': [{'publisher': 'Naukri', 'apply_link': 'https://www.naukri.com/job-listings-grc-123'}]},
            {'job_title': 'Mislabelled job', 'job_publisher': 'LinkedIn', 'job_apply_link': 'https://evil.example/jobs/1'},
            {'job_title': 'Developer', 'job_country': 'US', 'job_apply_link': 'https://www.linkedin.com/jobs/view/2'},
        ], 'cursor': 'next-page'}}
        jobs, cursor = app.normalize_jsearch(raw, {'platform': 'boards', 'country': 'in'})
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]['platform'], 'Naukri')
        self.assertIn('naukri.com', jobs[0]['url'])
        self.assertEqual(cursor, 'next-page')
        self.assertEqual(app.normalize_jsearch(raw, {'platform': 'linkedin', 'country': 'in'})[0], [])

    def feed(self):
        return {'version': 1, 'generated_at': app.now(), 'jobs': [
            {**JOB, 'url': 'https://www.linkedin.com/jobs/view/123', 'posted': app.now()},
            {**JOB, 'url': 'https://www.naukri.com/job-listings-test-123', 'country': 'in',
             'location': 'Bengaluru, India', 'posted': app.now()},
        ]}

    def test_feed_filters_scores_and_status_preservation(self):
        browser_api.dispatch('/api/profile', {'text': CV, 'years': 10})
        filters = {'source': 'linkedin', 'country': 'ae', 'date_posted': 'week'}
        result = browser_api.dispatch('/api/search', filters, self.feed())
        self.assertEqual(result['added'], 1)
        identifier = result['ids'][0]
        browser_api.dispatch('/api/jobs/' + identifier, {'status': 'Applied', 'note': 'Applied today'})
        result = browser_api.dispatch('/api/search', filters, self.feed())
        self.assertEqual(result['added'], 0)
        job = browser_api.dispatch('/api/jobs/' + identifier)
        self.assertEqual(job['status'], 'Applied')
        self.assertGreater(job['match']['score'], 60)
        self.assertEqual(len(job['notes']), 2)
        self.assertEqual(len(browser_api.dispatch('/api/search', {'source': 'naukri'}, self.feed())['ids']), 1)

    def test_unconfigured_stale_and_unknown_posted_date(self):
        with self.assertRaisesRegex(ValueError, 'not connected'):
            browser_api.dispatch('/api/search', {'source': 'boards'}, {'version': 1, 'jobs': []})
        feed = self.feed()
        feed['generated_at'] = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        feed['jobs'][0]['posted'] = 'last week'
        result = browser_api.dispatch('/api/search', {'source': 'boards', 'date_posted': 'today'}, feed)
        self.assertIn('STALE', result['message'])
        self.assertEqual(len(result['ids']), 1)

    def test_invalid_feed_is_atomic(self):
        feed = self.feed()
        feed['jobs'].append({'title': 'bad', 'url': 'javascript:alert(1)'})
        with self.assertRaises(ValueError):
            browser_api.dispatch('/api/search', {'source': 'boards'}, feed)
        self.assertEqual(app.all_jobs(), [])

    def test_browser_cv_draft_backup_and_restore(self):
        browser_api.dispatch('/api/profile', {'text': CV, 'years': 10})
        record = browser_api.dispatch('/api/jobs', JOB)['job']
        draft = browser_api.dispatch('/api/tailor', {'job_id': record['id'], 'method': 'local'})
        docx = browser_api.dispatch('/api/docx', {'text': draft['text']})
        extracted = browser_api.dispatch('/api/extract', {'filename': 'cv.docx', 'content': docx['base64']})
        self.assertIn('Jordan Example', extracted['text'])
        backup = browser_api.dispatch('/api/backup')
        self.assertNotIn('api_key', json.dumps(backup))
        self.assertEqual(browser_api.dispatch('/api/restore', backup)['added'], 0)

    def test_feed_generator_never_exports_private_records(self):
        spec = importlib.util.spec_from_file_location('refresh_feed', ROOT / 'scripts' / 'refresh_feed.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        record = app.normalize_job({**JOB, 'url': 'https://www.linkedin.com/jobs/view/1',
                                    'resume_draft': 'PRIVATE', 'status': 'Applied'})
        with patch.object(app, 'search_jsearch', return_value=([record], '', '')):
            feed = module.generate({'queries': [{'query': 'security', 'country': 'ae'}]})
        self.assertNotIn('PRIVATE', json.dumps(feed))
        self.assertNotIn('status', feed['jobs'][0])
        self.assertNotIn('resume_draft', feed['jobs'][0])

    def test_both_platform_passes_reuse_provider_cache(self):
        spec = importlib.util.spec_from_file_location('refresh_feed_cache', ROOT / 'scripts' / 'refresh_feed.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        raw = {'status': 'OK', 'data': {'jobs': [{
            'job_title': 'Security Analyst', 'job_country': 'IN',
            'job_apply_link': 'https://www.linkedin.com/jobs/view/1',
            'apply_options': [{'apply_link': 'https://www.naukri.com/job-listings-security-1'}]
        }]}}
        with patch.object(app, 'API_KEY', 'test-key'), patch.object(app, 'remote_json', return_value=raw) as network:
            feed = module.generate({'queries': [{'query': 'security', 'country': 'in'}]})
        self.assertEqual(network.call_count, 1)
        self.assertEqual({app.job_platform(job['url']) for job in feed['jobs']}, {'LinkedIn', 'Naukri'})

    def test_browser_build_excludes_server_and_data(self):
        spec = importlib.util.spec_from_file_location('build_site', ROOT / 'scripts' / 'build_site.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        core = module.browser_core((ROOT / 'app.py').read_text())
        self.assertNotIn('class Handler', core)
        self.assertNotIn('urllib.request', core)
        self.assertIn('def matching(', core)
        compile(core, 'browser_core.py', 'exec')


if __name__ == '__main__':
    unittest.main()
