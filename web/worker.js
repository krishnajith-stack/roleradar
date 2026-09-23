'use strict';

const runtimeVersion = '0.29.4';
const runtimeUrl = `https://cdn.jsdelivr.net/pyodide/v${runtimeVersion}/full/`;
const databasePath = '/roleradar/data/roleradar.sqlite3';
let runtime, database, initialized = false, queue = Promise.resolve();

function storedBytes(mode, value) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('workspace', mode);
    const store = tx.objectStore('workspace');
    const op = mode === 'readonly' ? store.get('database') : store.put(value, 'database');
    tx.oncomplete = () => resolve(op.result);
    tx.onerror = () => reject(new Error('Browser storage failed. Export a backup before closing this page.'));
    tx.onabort = () => reject(new Error('Browser storage is full or unavailable. No changes were saved.'));
  });
}

async function initialize() {
  self.postMessage({progress: 'Loading the private matching engine. First visit may take a moment...'});
  if (!navigator.locks) throw new Error('This browser needs HTTPS and Web Locks support. Use a recent Chrome, Edge, Firefox or Safari.');
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('roleradar-' + new URL('.', self.location.href).pathname, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Allow browser storage to open your private workspace.'));
  });
  importScripts(runtimeUrl + 'pyodide.js');
  runtime = await loadPyodide({indexURL: runtimeUrl});
  await runtime.loadPackage('sqlite3');
  runtime.FS.mkdirTree('/roleradar/data');
  for (const name of ['app.py', 'browser_api.py']) {
    const response = await fetch(new URL(name, self.location.href));
    if (!response.ok) throw new Error('App files could not load. Reload the page.');
    runtime.FS.writeFile('/roleradar/' + name, await response.text());
  }
  await runtime.runPythonAsync("import sys\nsys.path.insert(0, '/roleradar')\nimport browser_api\n");
  initialized = true;
}

async function handle(message) {
  try {
    if (!initialized) await initialize();
    if (message.payload.path === '/api/extract' && /\.pdf$/i.test(message.payload.data?.filename || '')) {
      await runtime.loadPackage('micropip');
      await runtime.runPythonAsync("import micropip\nawait micropip.install('pypdf==6.0.0')");
    }
    const result = await navigator.locks.request('roleradar-' + new URL('.', self.location.href).pathname, async () => {
      // Reload the last committed snapshot under a cross-tab lock before every operation.
      const bytes = await storedBytes('readonly');
      if (runtime.FS.analyzePath(databasePath).exists) runtime.FS.unlink(databasePath);
      if (bytes) runtime.FS.writeFile(databasePath, new Uint8Array(bytes));
      runtime.runPython('browser_api.app.initialize()');
      runtime.globals.set('request_json', JSON.stringify(message.payload));
      const envelope = JSON.parse(runtime.runPython('browser_api.request(request_json)'));
      runtime.globals.delete('request_json');
      if (envelope.error) throw new Error(envelope.error);
      await storedBytes('readwrite', runtime.FS.readFile(databasePath).slice().buffer);
      return envelope.result;
    });
    self.postMessage({id: message.id, result});
  } catch (error) {
    self.postMessage({id: message.id, error: error.message || 'The operation failed. Reload and try again.'});
  }
}

self.onmessage = ({data}) => { queue = queue.then(() => handle(data)); };
