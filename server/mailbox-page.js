// Team pages for the mailbox (mailbox.js): email sent to our @mirrormirror.cloud addresses.
//   /myoffice/mail            every message, newest first; filter by address, search
//   /myoffice/mail/<id>       one message: headers, text, the HTML shown in a sandboxed frame, attachments
// A message with a problem (unverified, odd payload) is shown with its label; nothing is hidden.

import { esc } from './pages.js';
import { officePage } from './office-shell.js';

const CSS = `
.tbl { width:100%; overflow-x:auto; margin:0 0 26px; }
table.t { width:100%; border-collapse:collapse; font-size:14px; min-width:720px; }
table.t th { text-align:left; font-size:12px; color:var(--grey); font-weight:600; padding:0 10px 8px 0; white-space:nowrap; }
table.t td { padding:9px 10px 9px 0; border-top:1px solid var(--line); vertical-align:top; }
table.t tr.unread td { background:#f7f9ff; }
table.t tr.unread b.subj { color:var(--ink); }
table.t a { color:var(--ink); }
.sub { display:block; font-size:12px; color:var(--grey); overflow-wrap:anywhere; }
.badge { display:inline-block; font-size:12px; font-weight:600; padding:1px 8px; border-radius:99px; background:var(--band); color:var(--grey); white-space:nowrap; }
.badge.new { background:#e3ecff; color:#1d4ed8; }
.badge.bad { background:#fdecea; color:var(--wrong); }
.badge.wait { background:#fdf3e2; color:#a15c07; }
.chips { display:flex; gap:6px; flex-wrap:wrap; margin:0 0 14px; }
.chips a { font-size:13px; padding:4px 11px; border-radius:99px; border:1px solid var(--line); color:var(--ink); text-decoration:none; background:#fff; }
.chips a.on { background:var(--ink); color:#fff; border-color:var(--ink); }
form.search { display:flex; gap:8px; margin:0 0 18px; max-width:520px; }
form.search input { margin:0; }
form.search .btn { padding:10px 16px; font-size:15px; }
.problem { background:#fdecea; color:var(--wrong); padding:12px 14px; border-radius:10px; }
.note { background:#fdf3e2; color:#7a4706; padding:12px 14px; border-radius:10px; }
dl.hdr { display:grid; grid-template-columns:max-content 1fr; gap:4px 14px; font-size:14px; margin:0 0 18px; }
dl.hdr dt { color:var(--grey); }
dl.hdr dd { margin:0; overflow-wrap:anywhere; }
.msg { background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px; margin:0 0 18px; }
.msg pre { white-space:pre-wrap; overflow-wrap:anywhere; font:14px/1.55 ui-monospace,Menlo,Consolas,monospace; margin:0; color:var(--ink); }
.msg iframe { width:100%; height:70vh; border:0; background:#fff; }
.tabs { display:flex; gap:8px; margin:0 0 10px; }
.tabs a { font-size:13px; }
.atts a { display:inline-block; margin:0 10px 8px 0; font-size:14px; }
details.raw pre { white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; max-height:400px; overflow:auto; background:var(--band); padding:10px; border-radius:8px; }
h2 { font-family:var(--display); font-size:20px; margin:22px 0 10px; letter-spacing:-0.02em; }
.actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:0 0 18px; }
.actions form { margin:0; }`;

function timeFmt(tz) {
  const opts = { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
  let f;
  try { f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz }); } catch { f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }); tz = 'UTC'; }
  return { tz, at: (t) => { try { return t ? f.format(new Date(Number(t))) : ''; } catch { return ''; } } };
}
const num = (n) => Number(n ?? 0).toLocaleString('en');
const bytes = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const mailUrl = (id) => `/myoffice/mail/${encodeURIComponent(id)}`;
const listUrl = (params) => {
  const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return `/myoffice/mail${sp.size ? `?${sp}` : ''}`;
};

function labels(m) {
  const out = [];
  if (!m.read_at) out.push('<span class="badge new">new</span>');
  if (!m.verified) out.push('<span class="badge bad">unverified</span>');
  if (Number(m.spam_score) >= 5) out.push(`<span class="badge wait">spam score ${esc(m.spam_score)}</span>`);
  if (m.problem && m.verified) out.push('<span class="badge wait">problem</span>');
  return out.join(' ');
}

// mails: store.mailbox.list() (already filtered by the caller). recipients: store.mailbox.recipients().
export function mailboxPage({ email, badges, mails = [], total = 0, unread = 0, recipients = [], to = '', q = '', error = null, tz }) {
  const { at, tz: zone } = timeFmt(tz);
  const rows = mails.map((m) => `<tr class="${m.read_at ? '' : 'unread'}">
<td style="white-space:nowrap">${esc(at(m.received_at))}</td>
<td style="overflow-wrap:anywhere">${esc(m.mail_from ?? m.sender ?? '(no sender)')}<span class="sub">to ${esc(m.recipient ?? m.to_header ?? '?')}</span></td>
<td><a href="${esc(mailUrl(m.id))}"><b class="subj">${esc(m.subject || '(no subject)')}</b></a> ${labels(m)}<span class="sub">${esc(String(m.snippet ?? '').replace(/\s+/g, ' ').trim())}</span></td>
<td>${m.attachments ? `📎 ${num(m.attachments)}` : ''}</td></tr>`).join('');
  const chips = recipients.length > 1 || to
    ? `<div class="chips"><a href="${esc(listUrl({ q }))}"${to ? '' : ' class="on"'}>All</a>${recipients.map((r) => `<a href="${esc(listUrl({ to: r.recipient || '(none)', q }))}"${to === (r.recipient || '(none)') ? ' class="on"' : ''}>${esc(r.recipient || '(no recipient)')} · ${num(r.n)}${Number(r.unread) ? ` (${num(r.unread)} new)` : ''}</a>`).join('')}</div>`
    : '';
  const body = error
    ? `<p class="problem">The mailbox could not be read just now: ${esc(error)}. Refresh in a minute.</p>`
    : rows
      ? `<div class="tbl"><table class="t"><thead><tr><th>Received (${esc(zone)})</th><th>From · to</th><th>Subject</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : total
        ? '<p>No message matches.</p>'
        : `<p class="note">No mail has arrived yet. Mail to any @mirrormirror.cloud address lands here once the domain's MX record points to <b>parse.mailjet.com</b> and the Mailjet Parse route is set (docs/email.md).</p>`;
  return officePage('Mailbox', `<h1>Mailbox</h1>
<p>Email sent to our @mirrormirror.cloud addresses. ${num(total)} message${total === 1 ? '' : 's'}, ${num(unread)} new.</p>
${chips}
<form class="search" method="get" action="/myoffice/mail">${to ? `<input type="hidden" name="to" value="${esc(to)}">` : ''}<input type="text" name="q" value="${esc(q)}" placeholder="Search sender, subject, text"><button class="btn" type="submit">Search</button>${q ? ` <a class="btn quiet" href="${esc(listUrl({ to }))}">Clear</a>` : ''}</form>
${body}`, { on: '/myoffice/mail', email, badges, css: CSS });
}

// The message's HTML, shown in a frame with no scripts, no forms and no access to this page. Links open in a new tab.
function htmlFrame(html) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https:; font-src https: data:"><base target="_blank"></head><body>${html}</body></html>`;
  return `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc="${esc(doc)}" title="Message"></iframe>`;
}

// mail: store.mailbox.get(id). attachments: store.mailbox.attachmentsOf(id). view: 'html' | 'text' | 'raw'.
export function mailPage({ email, badges, mail, attachments = [], view = '', problems = [], tz }) {
  const { at, tz: zone } = timeFmt(tz);
  if (!mail) {
    return officePage('Mailbox', `<h1>Message not found</h1>${problems.map((p) => `<p class="problem">${esc(p)}</p>`).join('')}<p><a href="/myoffice/mail">Back to the mailbox</a></p>`, { on: '/myoffice/mail/', email, badges, crumb: 'Not found', css: CSS });
  }
  const show = view || (mail.html_body ? 'html' : 'text');
  const row = (k, v) => (v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '');
  const att = attachments.map((a) => `<a href="${esc(`${mailUrl(mail.id)}/att/${a.id}`)}">📎 ${esc(a.filename ?? a.part ?? 'attachment')}</a> <span class="small">${esc(a.content_type ?? '')} · ${esc(bytes(a.size))}${a.inline ? ' · inline' : ''}</span><br>`).join('');
  const tabs = [mail.html_body ? ['html', 'HTML'] : null, ['text', 'Plain text'], ['raw', 'Raw data']].filter(Boolean)
    .map(([v, label]) => (v === show ? `<b>${label}</b>` : `<a href="${esc(`${mailUrl(mail.id)}?view=${v}`)}">${label}</a>`)).join(' · ');
  let content;
  if (show === 'html' && mail.html_body) content = htmlFrame(mail.html_body);
  else if (show === 'raw') {
    let raw = mail.raw_json ?? '';
    try { raw = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* shown as stored */ }
    content = `<details class="raw" open><summary class="small">The post exactly as Mailjet sent it (attachment bytes left out)</summary><pre>${esc(raw || '(nothing stored)')}</pre></details>`;
  } else content = `<pre>${esc(mail.text_body || '(no plain-text part)')}</pre>`;

  return officePage(mail.subject || 'Message', `<p><a href="/myoffice/mail">← Mailbox</a></p>
<h1>${esc(mail.subject || '(no subject)')}</h1>
${problems.map((p) => `<p class="problem">${esc(p)}</p>`).join('')}
${mail.problem ? `<p class="${mail.verified ? 'note' : 'problem'}">${esc(mail.problem)}</p>` : ''}
<dl class="hdr">${row('From', mail.mail_from)}${row('Envelope sender', mail.sender && mail.sender !== mail.mail_from ? mail.sender : '')}${row('To (our address)', mail.recipient)}${row('To header', mail.to_header && mail.to_header !== mail.recipient ? mail.to_header : '')}${row('Cc', mail.cc)}${row('Reply-To', mail.reply_to)}${row('Date header', mail.date_header)}${row(`Received (${zone})`, at(mail.received_at))}${row('Spam score', mail.spam_score != null ? String(mail.spam_score) : '')}</dl>
<div class="actions">${mail.mail_from || mail.reply_to ? `<a class="btn quiet" href="${esc(`mailto:${replyAddress(mail)}?subject=${encodeURIComponent(`Re: ${mail.subject ?? ''}`)}`)}">Reply in my email app</a>` : ''}
<form method="post" action="${esc(`${mailUrl(mail.id)}/unread`)}"><button class="link" type="submit">Mark as unread</button></form></div>
${att ? `<h2>Attachments</h2><div class="atts">${att}</div>` : ''}
<div class="tabs small">${tabs}</div>
<div class="msg">${content}</div>`, { on: '/myoffice/mail/', email, badges, crumb: mail.subject || '(no subject)', css: CSS });
}

// The bare address to reply to: Reply-To, else From.
function replyAddress(mail) {
  const v = String(mail.reply_to || mail.mail_from || '');
  return (/<([^>]+)>/.exec(v)?.[1] ?? v).trim();
}
