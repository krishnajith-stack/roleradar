"""Fetch public platform listings without touching a user's CV or workspace."""
import json
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import app


def generate(config):
    queries = config.get('queries')
    pages = config.get('max_pages_per_query', 1)
    if not isinstance(queries, list) or not 1 <= len(queries) <= 10:
        raise ValueError('Configure between 1 and 10 searches.')
    if not isinstance(pages, int) or not 1 <= pages <= 3:
        raise ValueError('max_pages_per_query must be 1, 2 or 3.')
    jobs, seen, coverage = [], set(), []
    for entry in queries:
        if not isinstance(entry, dict) or entry.get('country') not in app.COUNTRIES:
            raise ValueError('Each query needs a supported country code.')
        if not isinstance(entry.get('query'), str) or not entry['query'].strip():
            raise ValueError('Each query needs role keywords.')
        filters = {**entry, 'source': 'boards', 'platform': 'boards',
                   'date_posted': config.get('date_posted', 'month'), 'cursor': ''}
        coverage.append({key: str(entry.get(key, ''))[:200] for key in ('query', 'country', 'location')})
        for _ in range(pages):
            linkedin, cursor, _ = app.search_jsearch({**filters, 'platform': 'linkedin'})
            # The second pass reuses the same provider-response cache, retaining
            # Naukri alternatives even when LinkedIn is a listing's primary link.
            naukri, _, _ = app.search_jsearch({**filters, 'platform': 'naukri'})
            results = linkedin + naukri
            for job in results:
                key = app.fingerprint(job)
                if key in seen:
                    continue
                seen.add(key)
                # Only listing fields enter the publicly deployed snapshot.
                jobs.append({key: job[key] for key in (
                    'title', 'company', 'country', 'location', 'description', 'url',
                    'source', 'source_id', 'category', 'work_mode', 'salary', 'posted', 'required_years')})
            if not cursor:
                break
            filters['cursor'] = cursor
    return {'version': 1, 'status': 'ready', 'generated_at': app.now(),
            'queries': coverage, 'jobs': jobs,
            'warning': 'Indexed coverage only. Verify availability on the original platform. Naukri may have no indexed results.'}


def main():
    if not app.API_KEY:
        print('Feed not refreshed: OPENWEBNINJA_API_KEY is not configured. Existing snapshot retained.')
        return
    config = json.loads((ROOT / 'feed-config.json').read_text())
    # Caches from a scheduled run are temporary; never inspect the private desktop DB.
    with tempfile.TemporaryDirectory(prefix='roleradar-feed-') as temporary:
        app.DATA = Path(temporary)
        app.initialize()
        feed = generate(config)
    target = ROOT / 'public' / 'jobs.json'
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(feed, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(target)
    print(f"Feed refreshed: {len(feed['jobs'])} indexed platform listings.")


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Provider errors can contain request details; keep credentials out of build logs.
        print('Feed refresh failed. Previous snapshot retained. Check provider access, quota and feed-config.json.', file=sys.stderr)
        sys.exit(1)
