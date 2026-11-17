#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

const USAGE = `Usage: snip <command>

  add <url>    Create a short link for an HTTP(S) URL
  ls           List codes, hit counts, and original URLs
  open <code>  Resolve a code and open its target in your browser
  help         Show this help

Environment:
  SNIP_API     API origin (default http://localhost:3000)

Requests time out after 10 seconds. Errors go to stderr with exit code 1.
`;

function httpUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
  return url;
}

function browserCommand(target, platform = process.platform) {
  const url = httpUrl(target, 'Redirect target').href;
  if (platform === 'win32') {
    // Keep untrusted URL text out of the command interpreter's source.
    return {
      command: 'cmd.exe',
      args: ['/d', '/v:off', '/s', '/c', 'start "" "%SNIP_OPEN_URL%"'],
      env: { ...process.env, SNIP_OPEN_URL: url },
    };
  }
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'linux') return { command: 'xdg-open', args: [url] };
  throw new Error(`Browser launching is not supported on ${platform}`);
}

async function openBrowser(target, { platform = process.platform, spawnImpl = spawn } = {}) {
  const { command, args, env } = browserCommand(target, platform);
  await new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      shell: false,
      windowsVerbatimArguments: platform === 'win32',
      stdio: 'ignore',
      ...(env ? { env } : {}),
    });
    child.once('error', (error) => reject(new Error(`Cannot launch browser: ${error.message}`)));
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Browser launcher failed (${signal || `exit ${code}`})`));
    });
  });
}

function isLink(link) {
  return link !== null && typeof link === 'object'
    && typeof link.code === 'string' && /^[A-Za-z0-9]{6}$/.test(link.code)
    && typeof link.url === 'string'
    && typeof link.shortUrl === 'string'
    && Number.isSafeInteger(link.hits) && link.hits >= 0
    && typeof link.createdAt === 'string' && Number.isFinite(Date.parse(link.createdAt));
}

async function request(base, path, options, expectedStatus, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL(path, base), {
      ...options,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status !== expectedStatus) {
      let detail = '';
      const body = await response.text();
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.error === 'string') detail = `: ${parsed.error}`;
      } catch {
        // HTTP status remains useful when a proxy returns a non-JSON error.
      }
      throw new Error(`API returned HTTP ${response.status}${detail}`);
    }
    if (expectedStatus === 302) {
      const target = response.headers.get('location');
      if (!target) throw new Error('API redirect is missing Location');
      return httpUrl(target, 'Redirect target').href;
    }
    try {
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error('API returned invalid JSON');
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`API request timed out after ${timeoutMs} ms`);
    if (error instanceof TypeError) throw new Error(`Cannot reach API at ${base.origin}: ${error.message}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function run(args, {
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  fetchImpl = globalThis.fetch,
  launchBrowser = openBrowser,
  timeoutMs = 10000,
} = {}) {
  try {
    const [command, ...values] = args;
    if (!command || ['help', '--help', '-h'].includes(command)) {
      if (values.length) throw new Error('Help takes no arguments');
      stdout.write(USAGE);
      return 0;
    }
    if (!['add', 'ls', 'open'].includes(command)) throw new Error(`Unknown command: ${command}. Run snip help.`);
    const expected = command === 'ls' ? 0 : 1;
    if (values.length !== expected) throw new Error(`Usage: snip ${command}${expected ? ` <${command === 'add' ? 'url' : 'code'}>` : ''}`);
    if (command === 'add') httpUrl(values[0], 'URL');
    if (command === 'open' && !/^[A-Za-z0-9]{6}$/.test(values[0])) {
      throw new Error('Code must contain exactly 6 base62 characters (A-Z, a-z, 0-9)');
    }
    const base = httpUrl(env.SNIP_API === undefined ? 'http://localhost:3000' : env.SNIP_API, 'SNIP_API');
    if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
      throw new Error('SNIP_API must be an origin without credentials, path, query, or fragment');
    }
    const call = (path, options, status) => request(base, path, options, status, fetchImpl, timeoutMs);
    if (command === 'add') {
      const link = await call('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: values[0] }),
      }, 201);
      if (!isLink(link)) throw new Error('API returned an invalid link record');
      httpUrl(link.shortUrl, 'Returned short URL');
      stdout.write(`${link.shortUrl}\n`);
    } else if (command === 'ls') {
      const links = await call('/api/links', { method: 'GET' }, 200);
      if (!Array.isArray(links) || !links.every(isLink)) throw new Error('API returned an invalid links array');
      if (!links.length) stdout.write('No links yet.\n');
      else {
        const hitsWidth = links.reduce((width, link) => Math.max(width, String(link.hits).length), 4);
        stdout.write(`CODE    ${'HITS'.padStart(hitsWidth)}  URL\n`);
        for (const link of links) {
          const safeUrl = link.url.replace(/[\u0000-\u001f\u007f-\u009f]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
          stdout.write(`${link.code}  ${String(link.hits).padStart(hitsWidth)}  ${safeUrl}\n`);
        }
      }
    } else {
      const target = await call(`/${values[0]}`, { method: 'GET' }, 302);
      await launchBrowser(target);
    }
    return 0;
  } catch (error) {
    stderr.write(`snip: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { run, browserCommand, openBrowser };
