import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

test('all lesson page module imports are served as JavaScript', () => {
  const serverUrl = new URL('./server.ts', import.meta.url);
  const source = readFileSync(serverUrl, 'utf8');
  const declaration = source.slice(source.indexOf('const ASSETS ='), source.indexOf('const LIVE_RELOAD'));
  const assets: Map<string, { file: string; type: string }> = runInNewContext(
    stripTypeScriptTypes(declaration.replaceAll('import.meta.url', 'serverUrl') + '\nASSETS;'),
    { URL, fileURLToPath, serverUrl: serverUrl.href, HTML: 'text/html', CSS: 'text/css', JS: 'text/javascript' },
  );
  const visited = new Set<string>();
  function check(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    const asset = assets.get(path);
    assert.ok(asset, `Missing static route: ${path}`);
    assert.equal(asset.type, 'text/javascript');
    const script = readFileSync(asset.file, 'utf8');
    for (const match of script.matchAll(/\bimport\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      check(new URL(match[1]!, `http://localhost${path}`).pathname);
    }
  }
  check('/learn.js');
});
