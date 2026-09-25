"""Build an allowlisted static site. Never copy local data or credentials."""
import ast
import hashlib
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'site'
EXCLUDED_IMPORTS = {'argparse', 'secrets', 'threading', 'urllib.error', 'urllib.request',
                    'webbrowser', 'http.server'}
EXCLUDED_NAMES = {'Handler', 'NoRedirect', 'main', 'remote_json', 'search_remotive',
                  'search_jsearch', 'search_jobs', 'ollama_models', 'ai_tailor'}


def browser_core(source):
    module = ast.parse(source)
    nodes = []
    for node in module.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in EXCLUDED_NAMES:
            continue
        if isinstance(node, ast.ImportFrom) and node.module in EXCLUDED_IMPORTS:
            continue
        if isinstance(node, ast.Import):
            node.names = [name for name in node.names if name.name not in EXCLUDED_IMPORTS]
            if not node.names:
                continue
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in
                                                {'TOKEN', 'REMOTIVE_LOCK', 'SEARCH_LOCK'} for t in node.targets):
            continue
        if isinstance(node, ast.If) and ast.unparse(node.test) == "__name__ == '__main__'":
            continue
        nodes.append(node)
    module.body = nodes
    return ast.unparse(module) + '\n'


def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    for name in ('index.html', 'style.css', 'app.js', 'favicon.svg'):
        shutil.copyfile(ROOT / 'static' / name, OUT / name)
    for name in ('online.js', 'worker.js'):
        shutil.copyfile(ROOT / 'web' / name, OUT / name)
    shutil.copyfile(ROOT / 'browser_api.py', OUT / 'browser_api.py')
    (OUT / 'app.py').write_text(browser_core((ROOT / 'app.py').read_text()), encoding='utf-8')
    html = (OUT / 'index.html').read_text()
    html = html.replace('<!-- online-runtime -->', '<script src="./online.js" defer></script>')
    # Content-addressed assets prevent an existing browser/CDN cache from mixing
    # a newly deployed page with scripts or styles from the previous release.
    for name in ('style.css', 'app.js', 'online.js'):
        source = OUT / name
        digest = hashlib.sha256(source.read_bytes()).hexdigest()[:12]
        versioned = f'{source.stem}.{digest}{source.suffix}'
        shutil.copyfile(source, OUT / versioned)
        html = html.replace(f'./{name}', f'./{versioned}')
    (OUT / 'index.html').write_text(html, encoding='utf-8')
    feed = ROOT / 'public' / 'jobs.json'
    shutil.copyfile(feed, OUT / 'jobs.json')
    (OUT / '.nojekyll').touch()
    print('Built site/: public application code and job feed only.')


if __name__ == '__main__':
    build()
