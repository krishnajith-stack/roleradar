"""Browser-only transport; the shared Python engine owns scores and records."""
import base64
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import json
import app


_connect = app.db


@contextmanager
def closed_db():
    con = _connect()
    try:
        with con:
            yield con
    finally:
        con.close()


app.db = closed_db


def search_feed(filters, feed):
    source = filters.get('source', 'boards')
    if source == 'saved':
        jobs = [j for j in app.all_jobs() if app.filter_job(j, filters, broad=True)]
        return {'ids': [j['id'] for j in jobs], 'added': 0, 'cursor': '',
                'message': 'Saved browser records. Posted-date selection is ignored.'}
    if source not in ('boards', 'linkedin', 'naukri'):
        raise ValueError('Choose LinkedIn, Naukri, both platforms, or saved jobs.')
    if not isinstance(feed, dict) or feed.get('version') != 1 or not isinstance(feed.get('jobs'), list):
        raise ValueError('The published job feed is unavailable. Your saved records are safe.')
    if not feed.get('generated_at'):
        raise ValueError('Automatic feed is not connected yet. Add OPENWEBNINJA_API_KEY in the repository Actions secrets and run Refresh job feed. You can still import a listing or a backup.')
    now = datetime.now(timezone.utc)
    try:
        updated = datetime.fromisoformat(feed['generated_at'].replace('Z', '+00:00'))
        stale = now - updated > timedelta(hours=48)
    except (ValueError, TypeError):
        raise ValueError('The job feed has an invalid update date.')
    days = {'today': 1, '3days': 3, 'week': 7, 'month': 31}.get(filters.get('date_posted'))
    jobs = []
    for item in feed['jobs'][:5000]:
        job = app.normalize_job(item)
        platform = app.job_platform(job['url'])
        if platform not in ('LinkedIn', 'Naukri'):
            continue
        if source != 'boards' and platform.lower() != source:
            continue
        if not app.filter_job(job, filters, broad=True):
            continue
        if days:
            try:
                posted = datetime.fromisoformat(job['posted'].replace('Z', '+00:00'))
                if posted.tzinfo is None:
                    posted = posted.replace(tzinfo=timezone.utc)
                if not now - timedelta(days=days) <= posted <= now + timedelta(days=1):
                    continue
            except (ValueError, TypeError):
                continue
        job['demo'] = False
        job['status'] = 'Discovered'
        job['resume_draft'] = ''
        job['resume_method'] = ''
        job['applied_at'] = ''
        job['follow_up'] = ''
        jobs.append(job)
    ids, added = [], 0
    for job in jobs:
        record, new = app.save_job(job, refresh=True)
        ids.append(record['id'])
        added += int(new)
    message = ('Feed last updated ' + feed['generated_at'] + '. '
               'Search filters the published snapshot, not a new provider request. '
               'Coverage follows feed-config.json; not every vacancy is indexed.')
    if stale:
        message = 'STALE FEED: more than 48 hours old. Check the repository Actions runs. ' + message
    if feed.get('warning'):
        message += ' ' + str(feed['warning'])[:400]
    return {'ids': list(dict.fromkeys(ids)), 'added': added, 'cursor': '', 'message': message}


def dispatch(path, data=None, feed=None):
    if path == '/api/state':
        return app.app_state()
    if path == '/api/backup':
        return app.backup_data()
    if path == '/api/profile':
        app.kv_set('profile', app.prepare_profile(data))
        return {'ok': True}
    if path == '/api/extract':
        raw = base64.b64decode(str(data.get('content', '')), validate=True)
        text = app.extract_document(str(data.get('filename', '')), raw)
        if len(text.strip()) < 40:
            raise ValueError('Too little CV text was found. Paste the text instead.')
        return {'text': text[:100000]}
    if path == '/api/jobs':
        record, added = app.save_job(data)
        return {'job': record, 'added': added}
    if path.startswith('/api/jobs/'):
        identifier = path.split('/')[3]
        job = app.get_job(identifier)
        if path.endswith('/delete'):
            with app.db() as con:
                con.execute('DELETE FROM jobs WHERE id=?', (identifier,))
            return {'ok': True}
        if data is not None:
            return app.update_job(identifier, data)
        return {**job, 'notes': app.notes_for(identifier),
                'match': app.matching(app.kv_get('profile', {}), job)}
    if path == '/api/search':
        return search_feed(data, feed)
    if path == '/api/tailor':
        if data.get('method') == 'ollama':
            raise ValueError('Local Ollama is available only in the desktop edition.')
        profile = app.kv_get('profile', {})
        job = app.get_job(data.get('job_id'))
        if not profile.get('text'):
            raise ValueError('Save your CV first.')
        if len(job['description']) < 40:
            raise ValueError('Add the full job description before tailoring.')
        return app.local_tailor(profile, job)
    if path == '/api/docx':
        text = str(data.get('text', '')).strip()
        if not text or len(text) > 100000:
            raise ValueError('Enter a draft up to 100,000 characters.')
        return {'base64': base64.b64encode(app.docx_bytes(text)).decode()}
    if path == '/api/demo':
        app.sample_data()
        return {'ok': True}
    if path == '/api/clear-demo':
        with app.db() as con:
            for job in app.all_jobs():
                if job.get('demo'):
                    con.execute('DELETE FROM jobs WHERE id=?', (job['id'],))
            if app.kv_get('profile', {}).get('demo'):
                con.execute("DELETE FROM kv WHERE name='profile'")
        return {'ok': True}
    if path == '/api/restore':
        return app.restore_data(data)
    raise ValueError('This feature is not available in the online edition.')


def request(payload):
    payload = json.loads(payload)
    try:
        result = dispatch(payload['path'], payload.get('data'), payload.get('feed'))
        return json.dumps({'result': result})
    except (ValueError, TypeError) as exc:
        return json.dumps({'error': str(exc)})
