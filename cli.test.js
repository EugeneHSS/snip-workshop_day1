'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');
const { run, browserCommand, openBrowser } = require('./cli.js');

const exec = promisify(execFile);
const cli = join(__dirname, 'cli.js');
const link = {
  code: 'Ab12Cd', url: 'https://example.com/a?x=1&y=2',
  shortUrl: 'http://localhost:3000/Ab12Cd', hits: 0,
  createdAt: '2026-11-17T00:00:00.000Z',
};

async function capture(args, options = {}) {
  let out = '';
  let err = '';
  const code = await run(args, {
    env: {},
    stdout: { write: (text) => { out += text; } },
    stderr: { write: (text) => { err += text; } },
    fetchImpl: async () => { throw new Error('Unexpected request'); },
    ...options,
  });
  return { code, out, err };
}

async function withServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback(base);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('help aliases and no arguments work without configuration or requests', async () => {
  for (const args of [[], ['help'], ['-h'], ['--help']]) {
    const result = await capture(args, { env: { SNIP_API: 'invalid' } });
    assert.equal(result.code, 0);
    assert.match(result.out, /Usage: snip/);
    assert.match(result.out, /SNIP_API/);
    assert.equal(result.err, '');
  }
});

test('invalid commands, arity, URLs and codes fail before requests', async () => {
  for (const args of [
    ['wat'], ['add'], ['add', 'https://example.com', 'extra'], ['add', 'file:///tmp/x'],
    ['add', 'not-url'], ['ls', 'extra'], ['open'], ['open', '../bad'],
    ['open', 'abc'], ['help', 'extra'],
  ]) {
    const result = await capture(args);
    assert.equal(result.code, 1, JSON.stringify(args));
    assert.equal(result.out, '');
    assert.doesNotMatch(result.err, /Unexpected request/);
    assert.match(result.err, /^snip: /);
  }
});

test('SNIP_API rejects unsafe or ambiguous values before requests', async () => {
  for (const value of ['', 'not-url', 'ftp://example.com', 'https://x/a', 'https://x/?a', 'https://x/#a', 'https://user:pass@x']) {
    const result = await capture(['ls'], { env: { SNIP_API: value } });
    assert.equal(result.code, 1);
    assert.match(result.err, /SNIP_API/);
  }
});

test('default API origin and manual redirect mode', async () => {
  const result = await capture(['ls'], {
    fetchImpl: async (url, options) => {
      assert.equal(url.href, 'http://localhost:3000/api/links');
      assert.equal(options.redirect, 'manual');
      return Response.json([]);
    },
  });
  assert.deepEqual(result, { code: 0, out: 'No links yet.\n', err: '' });
});

test('mock HTTP API: add payload, success output, aligned list and empty state', async () => {
  const requests = [];
  await withServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { url: link.url });
      assert.equal(req.headers['content-type'], 'application/json');
      res.writeHead(201).end(JSON.stringify(link));
    } else res.end(JSON.stringify([link, { ...link, code: 'Zz99Yy', hits: 12345 }]));
  }, async (base) => {
    const options = { env: { SNIP_API: base }, fetchImpl: fetch };
    assert.deepEqual(await capture(['add', link.url], options), {
      code: 0, out: `${link.shortUrl}\n`, err: '',
    });
    const result = await capture(['ls'], options);
    assert.equal(result.code, 0);
    assert.equal(result.err, '');
    assert.equal(result.out, `CODE     HITS  URL\nAb12Cd      0  ${link.url}\nZz99Yy  12345  ${link.url}\n`);
  });
  assert.deepEqual(requests, ['POST /api/links', 'GET /api/links']);
});

test('open asks for exactly one redirect and launches Location, not the short URL', async () => {
  let count = 0;
  await withServer((req, res) => {
    count++;
    assert.equal(req.url, '/Ab12Cd');
    res.writeHead(302, { Location: link.url }).end();
  }, async (base) => {
    let launched;
    const result = await capture(['open', link.code], {
      env: { SNIP_API: base }, fetchImpl: fetch,
      launchBrowser: async (target) => { launched = target; },
    });
    assert.deepEqual(result, { code: 0, out: '', err: '' });
    assert.equal(launched, link.url);
  });
  assert.equal(count, 1);
});

test('400, 404 and 500 errors preserve API error and produce no stdout', async () => {
  for (const status of [400, 404, 500]) {
    await withServer((req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end('{"error":"Test failure"}');
    }, async (base) => {
      const result = await capture(['open', link.code], { env: { SNIP_API: base }, fetchImpl: fetch });
      assert.equal(result.code, 1);
      assert.equal(result.out, '');
      assert.match(result.err, new RegExp(`HTTP ${status}: Test failure`));
    });
  }
});

test('non-JSON API errors still report HTTP status', async () => {
  const result = await capture(['ls'], { fetchImpl: async () => new Response('<html>bad gateway</html>', { status: 502 }) });
  assert.match(result.err, /HTTP 502/);
  assert.equal(result.code, 1);
});

test('malformed success JSON and invalid record shapes fail explicitly', async () => {
  for (const body of ['{', '{}', '[{}]', JSON.stringify([{ ...link, hits: -1 }]), JSON.stringify([{ ...link, code: 123456 }])]) {
    const result = await capture(['ls'], { fetchImpl: async () => new Response(body) });
    assert.equal(result.code, 1);
    assert.equal(result.out, '');
    assert.match(result.err, /invalid/);
  }
  const result = await capture(['add', link.url], { fetchImpl: async () => Response.json({}, { status: 201 }) });
  assert.equal(result.code, 1);
  assert.match(result.err, /invalid link record/);
});

test('redirects must be 302 with an absolute HTTP(S) Location', async () => {
  for (const response of [
    new Response(null, { status: 302 }),
    new Response(null, { status: 302, headers: { Location: 'file:///bad' } }),
    new Response(null, { status: 302, headers: { Location: '/relative' } }),
    new Response(null, { status: 301, headers: { Location: link.url } }),
  ]) {
    const result = await capture(['open', link.code], {
      fetchImpl: async () => response,
      launchBrowser: async () => { assert.fail('Must not launch browser'); },
    });
    assert.equal(result.code, 1);
    assert.equal(result.out, '');
  }
});

test('timeout covers headers and body and is reported to stderr', async () => {
  for (const sendHeaders of [false, true]) {
    await withServer((req, res) => {
      if (sendHeaders) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.flushHeaders();
        res.write('[');
      }
    }, async (base) => {
      const result = await capture(['ls'], {
        env: { SNIP_API: base }, fetchImpl: fetch, timeoutMs: 100,
      });
      assert.equal(result.code, 1);
      assert.equal(result.out, '');
      assert.match(result.err, /timed out after 100 ms/);
    });
  }
});

test('unreachable backend uses real process exit 1 and stderr', async () => {
  let deadBase;
  await withServer((req, res) => res.end(), async (base) => { deadBase = base; });
  await assert.rejects(exec(process.execPath, [cli, 'ls'], {
    env: { ...process.env, SNIP_API: deadBase },
  }), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /Cannot reach API/);
    return true;
  });
});

test('browser-launch failure returns exit 1 after the resolve request', async () => {
  const result = await capture(['open', link.code], {
    fetchImpl: async () => new Response(null, { status: 302, headers: { Location: link.url } }),
    launchBrowser: async () => { throw new Error('Browser launcher failed'); },
  });
  assert.equal(result.code, 1);
  assert.match(result.err, /Browser launcher failed/);
});

test('platform launchers keep URL out of executable command source', () => {
  const target = 'https://example.com/?x=1&y=%PATH%';
  const win = browserCommand(target, 'win32');
  assert.equal(win.command, 'cmd.exe');
  assert.deepEqual(win.args, ['/d', '/v:off', '/s', '/c', 'start "" "%SNIP_OPEN_URL%"']);
  assert.equal(win.env.SNIP_OPEN_URL, target);
  assert.deepEqual(browserCommand(target, 'darwin'), { command: 'open', args: [target] });
  assert.deepEqual(browserCommand(target, 'linux'), { command: 'xdg-open', args: [target] });
  assert.throws(() => browserCommand('javascript:alert(1)', 'win32'), /HTTP\(S\)/);
  assert.throws(() => browserCommand(target, 'unsupported'), /not supported/);
});

test('table escapes terminal control characters in stored URLs', async () => {
  const result = await capture(['ls'], {
    fetchImpl: async () => Response.json([{ ...link, url: 'https://example.com/\x1b[31m\n' }]),
  });
  assert.equal(result.code, 0);
  assert.match(result.out, /\\x1b\[31m\\x0a/);
});

test('browser subprocess success, nonzero exit and spawn error on every platform', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const outcome of ['success', 'failure', 'error']) {
      const promise = openBrowser(link.url, {
        platform,
        spawnImpl(command, args, options) {
          assert.equal(options.shell, false);
          assert.equal(options.stdio, 'ignore');
          assert.equal(options.windowsVerbatimArguments, platform === 'win32');
          assert.equal(command, browserCommand(link.url, platform).command);
          assert.deepEqual(args, browserCommand(link.url, platform).args);
          const child = new EventEmitter();
          process.nextTick(() => {
            if (outcome === 'error') child.emit('error', new Error('Missing launcher'));
            else child.emit('exit', outcome === 'success' ? 0 : 1);
          });
          return child;
        },
      });
      if (outcome === 'success') await promise;
      else await assert.rejects(promise, /Cannot launch browser|Browser launcher failed/);
    }
  }
});

test('Windows command interpreter preserves special URL characters as data', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  const target = 'https://example.com/a%22?x=1&y=%PATH%&z=!NAME!#fragment';
  const spec = browserCommand(target, 'win32');
  const result = await exec(spec.command, [
    ...spec.args.slice(0, -1), 'echo "%SNIP_OPEN_URL%"',
  ], { env: spec.env, windowsVerbatimArguments: true });
  assert.equal(result.stdout.trim(), `"${target}"`);
});

test('Windows wrappers forward a quoted URL with query characters to the API', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  await withServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { url: link.url });
    res.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify(link));
  }, async (base) => {
    for (const [command, args, extra] of [
      ['cmd.exe', ['/d', '/c', `.\\snip.cmd add "${link.url}"`], { windowsVerbatimArguments: true }],
      ['powershell.exe', ['-NoProfile', '-File', join(__dirname, 'snip.ps1'), 'add', link.url], {}],
    ]) {
      const result = await exec(command, args, {
        cwd: __dirname, env: { ...process.env, SNIP_API: base }, ...extra,
      });
      assert.equal(result.stdout.trim(), link.shortUrl);
      assert.equal(result.stderr, '');
    }
  });
});

test('Node entrypoint help and native Windows wrappers preserve output and failures', async () => {
  const result = await exec(process.execPath, [cli, 'help']);
  assert.match(result.stdout, /Usage: snip/);
  assert.equal(result.stderr, '');
  if (process.platform !== 'win32') return;
  const cmd = await exec('cmd.exe', ['/d', '/c', '.\\snip.cmd help'], { cwd: __dirname });
  assert.equal(cmd.stdout, result.stdout.replace(/\r\n/g, '\n'));
  const ps = await exec('powershell.exe', ['-NoProfile', '-File', join(__dirname, 'snip.ps1'), 'help']);
  assert.equal(ps.stdout, result.stdout.replace(/\r\n/g, '\n'));
  for (const [command, args] of [
    ['cmd.exe', ['/d', '/c', '.\\snip.cmd add invalid']],
    ['powershell.exe', ['-NoProfile', '-File', join(__dirname, 'snip.ps1'), 'add', 'invalid']],
  ]) {
    await assert.rejects(exec(command, args, { cwd: __dirname }), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /HTTP\(S\)/);
      return true;
    });
  }
});
