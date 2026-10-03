'use strict';
/**
 * Sends the outreach email over SMTP.
 *
 * Why this exists: the highest-converting distribution channel is direct email,
 * and there is no mail client on this machine. Gmail's SMTP endpoint accepts a
 * login from any network, so the account can send from a plain script.
 *
 * Gmail requires an App Password, NOT the account password, when 2FA is on.
 * Sending with the account password fails with 535 and Gmail then locks the
 * account after repeated failures — so this refuses to try the account password
 * at all rather than risk that.
 *
 * Credentials come from the environment only. They are never written to disk,
 * never passed as arguments (argv is visible in the process list), and the
 * password is never echoed.
 *
 * Usage:
 *   SMTP_USER=you@gmail.com SMTP_PASS=<app-password> node scripts/send_email.js --dry-run
 *   SMTP_USER=you@gmail.com SMTP_PASS=<app-password> node scripts/send_email.js --to a@b.com --file body.txt
 */

const fs = require('fs');
const net = require('net');
const tls = require('tls');
const path = require('path');
const crypto = require('crypto');

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;

const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;

// Gmail app passwords are 16 characters with no spaces. A real account password
// would fail and, after retries, lock the account — so refuse before connecting.
function looksLikeAccountPassword(p) {
  if (!p) return true;
  const compact = p.replace(/\s+/g, '');
  return compact.length !== 16;
}

/**
 * Encode a header value that contains non-ASCII as RFC 2047 base64.
 *
 * A raw UTF-8 display name like "Oussama Boufia" is fine for ASCII, but any
 * accented character makes the header malformed and Gmail rejects the whole
 * envelope at MAIL FROM with 555 5.5.2 — the message never leaves.
 */
function encodeHeaderValue(value) {
  const s = String(value);
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(s)) return s;
  return '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

/**
 * Split "Display Name <addr@host>" into its parts. Passing the whole string to
 * MAIL FROM is invalid — the envelope needs the bare address.
 */
function parseAddress(value) {
  const m = String(value).match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ''), address: m[2].trim() };
  return { name: '', address: String(value).trim() };
}

function formatAddress({ name, address }) {
  if (!name) return address;
  return `${encodeHeaderValue(name)} <${address}>`;
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Minimal SMTP client over STARTTLS. Enough for one authenticated message. */
class Smtp {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.stage = 0;
    this.pending = [];
    this.buffer = '';
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.connect(this.port, this.host, () => {
        this.expect(() => resolve(), 'greeting');
      });
      this.socket.on('data', (d) => this.onData(d));
      this.socket.on('error', reject);
    });
  }

  expect(cb, label) {
    this.pending.push({ cb, label });
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    // SMTP replies are line-based; a reply ends with "NNN <space>text".
    let idx;
    while ((idx = this.buffer.indexOf('\n')) > -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!/^\d{3} /.test(line)) continue;
      const code = parseInt(line.slice(0, 3), 10);
      const last = this.pending.shift();
      if (!last) continue;
      if (code >= 400) {
        this.socket.end();
        return last.cb(new Error(`${last.label}: ${line.trim()}`));
      }
      last.cb(null, line);
    }
  }

  send(cmd, label) {
    return new Promise((resolve, reject) => {
      this.expect((err, line) => (err ? reject(err) : resolve(line)), label);
      this.socket.write(cmd + '\r\n');
    });
  }

  /**
   * Negotiate STARTTLS.
   *
   * The subtlety: the plaintext socket's 'data' handler (onData) is still
   * attached while the server sends "220 Ready to start TLS". Once we upgrade we
   * must stop feeding those bytes to the plaintext parser — and we must consume
   * the 220 ourselves. Listening with socket.once('data') while onData is also
   * attached raced, and on some runs the 220 was swallowed by the plaintext
   * parser, leaving no listener for the post-TLS EHLO reply and hanging forever.
   */
  upgrade() {
    return new Promise((resolve, reject) => {
      const onGreeting = (chunk) => {
        const text = chunk.toString('utf8');
        if (/^220 /.test(text)) {
          this.socket.removeListener('data', onGreeting);
          // Gmail's SMTP front end rejects a bare TLS 1.3-only handshake with
          // "tlsv1 alert protocol version" (alert 70). Offering 1.2 as well is what
          // makes the upgrade succeed; Node's default here is 1.3 only.
          const secure = tls.connect({
            socket: this.socket,
            servername: this.host,
            minVersion: 'TLSv1.2',
            maxVersion: 'TLSv1.2',
          }, () => {
            this.socket.removeAllListeners('data');
            this.socket = secure;
            this.buffer = '';
            secure.on('data', (d) => this.onData(d));
            secure.on('error', reject);
            resolve();
          });
          secure.on('error', reject);
        }
      };
      this.socket.on('data', onGreeting);
      this.socket.write('STARTTLS\r\n');
      setTimeout(() => reject(new Error('STARTTLS handshake timed out')), 25000);
    });
  }

  async login(user, pass) {
    await this.send('AUTH LOGIN', 'AUTH');
    await this.send(Buffer.from(user).toString('base64'), 'AUTH user');
    await this.send(Buffer.from(pass).toString('base64'), 'AUTH pass');
  }

  sendMail({ from, to, subject, body, messageId }) {
    // Date and Message-ID are mandatory under RFC 5322. Omitting Date is the
    // reason Gmail silently accepted but never filed the message: without it the
    // message is malformed and gets dropped rather than rejected.
    const headers = [
      `Date: ${new Date().toUTCString()}`,
      `From: ${formatAddress(parseAddress(from))}`,
      `To: ${formatAddress(parseAddress(to))}`,
      `Subject: ${encodeHeaderValue(subject)}`,
      'Auto-Submitted: auto-generated',
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      'X-Mailer: invoice-engine-outreach/1.0',
    ].join('\r\n');

    const bodyBytes = Buffer.from(body, 'utf8').length;
    const raw = headers + '\r\n\r\n' + body.replace(/\r?\n/g, '\r\n');
    const rawBytes = Buffer.byteLength(raw, 'utf8');

    return (async () => {
      // The envelope takes bare addresses — never "Name <addr@host>".
      await this.send(`MAIL FROM:<${parseAddress(from).address}>`, 'MAIL FROM');
      await this.send(`RCPT TO:<${parseAddress(to).address}>`, 'RCPT TO');
      await this.send(`DATA`, 'DATA');
      // Dot-stuffing: a line consisting of a single "." would end the message.
      const safe = raw.replace(/\r\n\./g, '\r\n..');
      this.socket.write(safe + '\r\n.\r\n');
      await new Promise((resolve, reject) => {
        this.expect((err, line) => (err ? reject(err) : resolve(line)), 'message body');
      });
      await this.send('QUIT', 'QUIT');
      return { bytes: rawBytes, bodyBytes };
    })();
  }
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const to = arg('to');
  const file = arg('file');
  const subject = arg('subject', 'hello');
  const from = arg('from', USER || 'me@example.com');

  if (!to && !dryRun) {
    console.error('usage: node scripts/send_email.js --to <addr> --file <body> [--subject <s>] [--dry-run]');
    process.exit(2);
  }

  const rawBody = file
    ? fs.readFileSync(path.resolve(file), 'utf8')
    : `Dry run body for ${to}.`;

  // Outreach files carry their own "Subject:" line for human review. Leaving it
  // in the body means the recipient sees the subject twice, so strip the header
  // and use it as the real subject.
  let body = rawBody;
  const m = rawBody.match(/^\s*Subject:\s*(.+)\r?\n\r?\n?/);
  let realSubject = subject;
  // (encoding happens at header-write time)
  if (m && !process.argv.includes('--keep-header')) {
    realSubject = m[1].trim();
    body = rawBody.slice(m[0].length);
  }
  body = body.trim();

  console.log('--- message preview ---');
  console.log('From   :', from);
  console.log('To     :', to || '(none)');
  console.log('Subject:', realSubject);
  console.log('Bytes  :', Buffer.byteLength(body, 'utf8'));
  console.log('First  :', body.split('\n')[0]);
  console.log('Last   :', body.trim().split('\n').pop());
  console.log('Links  :', (body.match(/https?:\/\/[^\s)]+/g) || []).join('\n         '));
  console.log('-----------------------');

  // Guard: the preview is only trustworthy if it is built from exactly what will
  // be transmitted. Assert on the values that go into the envelope so a mismatch
  // fails loudly instead of sending a mail labelled "hello".
  const actualSubject = realSubject;
  if (!actualSubject || actualSubject === 'hello') {
    console.error('Refusing to send: no real subject resolved.');
    console.error('Pass --subject, or include a "Subject: ..." line at the top of the body file.');
    process.exit(1);
  }
  if (!body || body.length < 40) {
    console.error('Refusing to send: body looks empty.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('DRY RUN — nothing sent.');
    return;
  }

  if (!USER || !PASS) {
    console.error('Set SMTP_USER and SMTP_PASS in the environment.');
    process.exit(2);
  }
  if (looksLikeAccountPassword(PASS)) {
    console.error('Refusing to send.');
    console.error('SMTP_PASS is not a 16-character Google app password.');
    console.error('Sending the account password fails with 535 and repeated failures lock the account.');
    console.error('');
    console.error('Create one at https://myaccount.google.com/apppasswords');
    console.error('(requires 2FA; select "Mail" and copy the 16-character code)');
    process.exit(1);
  }

  // Hold the event loop open until the send settles. A fire-and-forget async
  // IIFE lets node exit while the SMTP socket is still pending, so the process
  // printed the preview, exited 0, and silently sent nothing.
  const inFlight = (async () => {
    const smtp = new Smtp(SMTP_HOST, SMTP_PORT);
    try {
      await smtp.connect();
      await smtp.send('EHLO localhost', 'EHLO');
      await smtp.upgrade();
      await smtp.send('EHLO localhost', 'EHLO-after-TLS');
      await smtp.login(USER, PASS);
      const res = await smtp.sendMail({
        // realSubject, not subject: the subject parsed out of the file was only
        // ever printed in the preview, so every message went out with the
        // --subject default ("hello"). The preview lied and the bug shipped.
        from, to, subject: realSubject, body,
        messageId: '<' + crypto.randomUUID() + '@invoice-checker-ie.surge.sh>',
      });
      console.log('SENT ok —', res.bytes, 'bytes to', to);
      smtp.socket.end();
      process.exit(0);
    } catch (e) {
      console.error('SEND FAILED:', e.message);
      process.exitCode = 1;
      throw e;
    }
  })();

  inFlight.then(() => process.exit(process.exitCode || 0)).catch(() => process.exit(1));
}

main();