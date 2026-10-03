'use strict';
/**
 * Authenticates to surge.sh without a TTY.
 *
 * surge's CLI only accepts credentials from an interactive masked prompt, which
 * cannot be driven from a non-TTY shell. But the CLI itself uses
 * sdk.token({user, pass}) to exchange an email+password for a long-lived token,
 * and stores that token in ~/.netrc. This script performs the same exchange
 * directly so a deployment is possible in an automated context.
 *
 * The password is read from the environment, never from argv (argv is visible
 * in the process list) and never written to disk.
 *
 * Usage:
 *   SURGE_EMAIL=you@example.com SURGE_PASSWORD=... node scripts/surge_login.js
 *   node scripts/surge_login.js --check     report session state only
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const EMAIL = process.env.SURGE_EMAIL;
const PASSWORD = process.env.SURGE_PASSWORD;

function netrcPath() {
  // surge resolves the home directory per platform; mirror that exactly.
  const home = /^win/.test(process.platform) ? process.env.USERPROFILE : process.env.HOME;
  return path.join(home, '.netrc');
}

async function main() {
  // Resolve surge-sdk by absolute path. NODE_PATH is not consulted on Windows,
  // and spawning `npm` fails when npm is not on the inherited PATH, so fall back
  // through the known locations instead of shelling out.
  const { execFileSync } = require('child_process');
  const candidates = [];

  const fromNpm = (() => {
    try {
      return execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 20000 }).trim();
    } catch {
      return '';
    }
  })();
  if (fromNpm) candidates.push(path.join(fromNpm, 'surge', 'node_modules', 'surge-sdk'));

  const home = /^win/.test(process.platform) ? process.env.USERPROFILE : os.homedir();

  // npm's own global root lives under the Node install prefix, which on this
  // machine is inside the Hermes tools directory rather than AppData\Roaming.
  // Derive it from the running Node binary instead of shelling out to npm.
  const nodeDir = path.dirname(process.execPath);
  const prefixes = [
    path.join(nodeDir, 'node_modules'),
    path.join(nodeDir, '..', 'node_modules'),
    path.join(home, 'AppData', 'Roaming', 'npm', 'node_modules'),
    path.join(home, '.npm-global', 'lib', 'node_modules'),
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
  ];
  for (const prefix of prefixes) {
    candidates.push(path.join(prefix, 'surge', 'node_modules', 'surge-sdk'));
  }

  let sdk = null;
  let tried = [];
  for (const c of candidates) {
    tried.push(c);
    try { sdk = require(c); break; } catch { /* try the next location */ }
  }

  if (!sdk) {
    console.error('Could not load surge-sdk. Looked in:');
    for (const t of tried) console.error('  ' + t);
    console.error('Install it with: npm install -g surge');
    process.exit(1);
  }

  const endpoint = 'https://surge.surge.sh';

  const file = netrcPath();
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const hasSession = /machine\s+surge\.surge\.sh/.test(existing);

  if (process.argv[2] === '--check') {
    console.log('netrc      :', file);
    console.log('session    :', hasSession ? 'present' : 'none');
    try {
      const account = await new Promise((resolve, reject) => {
        sdk({ endpoint }).account({ user: 'token', pass: readToken(existing) },
          (err, acct) => (err ? reject(err) : resolve(acct)));
      });
      console.log('email      :', account.email);
      console.log('authenticated: yes');
    } catch (e) {
      console.log('authenticated: no —', e.message || ('status ' + (e.status || '?')));
    }
    return;
  }

  if (!EMAIL || !PASSWORD) {
    console.error('Set SURGE_EMAIL and SURGE_PASSWORD in the environment.');
    console.error('Do not pass them as arguments — argv is visible to other processes.');
    process.exit(2);
  }

  // Exchange the password for a token, exactly as the CLI does internally.
  const creds = await new Promise((resolve, reject) => {
    sdk({ endpoint }).token({ user: EMAIL, pass: PASSWORD },
      { msg: 'login from ' + os.hostname() },
      (err, c) => (err ? reject(err) : resolve(c)));
  });

  if (!creds || !(creds.token || creds.pass)) {
    console.error('Token exchange returned nothing — check the credentials.');
    process.exit(1);
  }

  // Persist the token in the format surge reads on every subsequent command.
  // The SDK returns the token as `pass`; surge's netrc stores it under
  // `password`. Checking only `token` silently failed on a successful exchange.
  const token = creds.token || creds.pass;
  const user = creds.user || creds.email || EMAIL;

  let body = existing;
  // Drop any stale entry for this host so we do not accumulate duplicates.
  body = body.replace(/machine\s+surge\.surge\.sh[\s\S]*?(?=\n\n|\n*$)/g, '').trim();
  const entry = `machine surge.surge.sh\n  login ${user}\n  password ${token}`;
  const next = (body ? body + '\n\n' : '') + entry + '\n';

  fs.writeFileSync(file, next);
  try { fs.chmodSync(file, 0o600); } catch { /* not supported on Windows */ }

  console.log('token acquired and stored in', file);
  console.log('email:', user);
  console.log('NOTE : the account password is no longer needed for surge CLI commands.');
}

function readToken(text) {
  const m = text.match(/machine\s+surge\.surge\.sh\s+login\s+(\S+)\s+password\s+(\S+)/);
  return m ? m[2] : '';
}

main().catch((e) => {
  console.error('surge authentication failed:', e.message || e);
  if (e.status) console.error('status:', e.status);
  process.exit(1);
});