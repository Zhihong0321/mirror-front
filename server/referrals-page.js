// The referral pages. Pure rendering; app.js gathers the data (referrals.js has the rules).
//   /account/referrals    for any signed-in account: code, earnings, wallet, previews with the visitor tracker, commissions
//   /myoffice/referrals   for the team: commission setting, who is owed what, mark paid / void / approve
// A problem in one part of the data is shown as a label on that part; the page itself always renders.

import { page, esc } from './pages.js';
import { accountPage } from './account-ui.js';
import { DASHBOARD_CSS } from './dashboard-css.js';
import { duration } from './visitors-page.js';
import { networkLabel, shortWallet, STATE_LABEL, WALLET_REASONS, ago, COMMISSION_CURRENCY } from './referrals.js';

const money = (cents) => `USD ${(Number(cents) / 100).toFixed(Number(cents) % 100 ? 2 : 0)}`;
const usdt = (cents) => `${(Number(cents) / 100).toFixed(Number(cents) % 100 ? 2 : 0)} USDT`;

function timeFmt(tz) {
  const opts = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
  let f;
  try { f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz }); } catch { f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }); }
  return (t) => { try { return t ? f.format(new Date(Number(t))) : ''; } catch { return ''; } };
}

const EXTRA = `
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:22px 0 0; }
.kpi { border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:#fff; }
.kpi b { display:block; font-family:var(--display); font-size:26px; letter-spacing:-0.02em; color:var(--ink); line-height:1.15; overflow-wrap:anywhere; }
.kpi span { font-size:13px; color:var(--grey); }
.kpi.big { border-color:var(--ink); box-shadow:0 0 0 1px var(--ink) inset; }
.how { margin:14px 0 0; padding:0; list-style:none; display:grid; gap:10px; counter-reset:h; }
.how li { position:relative; padding-left:40px; color:var(--grey); font-size:16px; }
.how li::before { counter-increment:h; content:counter(h); position:absolute; left:0; top:0; width:28px; height:28px; border-radius:50%; background:var(--ink); color:#fff; font:600 13px var(--body); display:grid; place-items:center; }
.how li b { color:var(--ink); }
form.wallet .acts { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
code.addr { font-size:14px; background:var(--band); padding:2px 6px; border-radius:6px; overflow-wrap:anywhere; }
.linkbox { display:flex; gap:8px; flex-wrap:wrap; margin:10px 0 0; flex-basis:100%; }
.linkbox input { flex:1 1 300px; margin:0; font-size:14px; }
.track { flex-basis:100%; margin:2px 0 0; padding:12px 0 0; border-top:1px dashed var(--line); font-size:14px; color:var(--grey); }
.track b { color:var(--ink); }
.track details { margin-top:8px; }
.track summary { cursor:pointer; font-weight:600; color:var(--ink); }
table.views { width:100%; border-collapse:collapse; margin-top:8px; font-size:13px; }
table.views th { text-align:left; font-size:12px; color:var(--grey); font-weight:600; padding:0 10px 6px 0; }
table.views td { padding:6px 10px 6px 0; border-top:1px solid var(--line); vertical-align:top; }
.tbl { width:100%; overflow-x:auto; }
table.t { width:100%; border-collapse:collapse; font-size:14px; min-width:640px; }
table.t th { text-align:left; font-size:12px; color:var(--grey); font-weight:600; padding:0 10px 8px 0; white-space:nowrap; }
table.t td { padding:9px 10px 9px 0; border-top:1px solid var(--line); vertical-align:top; }
table.t td b { white-space:nowrap; }
table.t .sub { display:block; font-size:12px; color:var(--grey); overflow-wrap:anywhere; }
form.inline { display:inline-flex; gap:6px; flex-wrap:wrap; align-items:center; margin:2px 0; }
form.inline input { margin:0; padding:7px 10px; font-size:13px; width:190px; }
form.inline .btn { padding:7px 12px; font-size:13px; }
form.setting { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
form.setting input { margin:0; max-width:140px; }
.fine { font-size:14px; color:var(--grey); }
details.how { border:1px solid var(--line); border-radius:14px; padding:0 22px 6px; margin:0 0 6px; }
details.how > summary { cursor:pointer; list-style:none; padding:14px 0; font-family:var(--display); font-weight:600; font-size:19px; letter-spacing:-0.02em; display:flex; justify-content:space-between; align-items:center; }
details.how > summary::-webkit-details-marker { display:none; }
details.how > summary::after { content:"+"; font:400 24px var(--body); color:var(--grey); }
details.how[open] > summary::after { content:"–"; }
details.how[open] > summary { padding-bottom:0; }
`;
const CSS = `${DASHBOARD_CSS}
${EXTRA}`;

const COPY_SCRIPT = `<script>document.addEventListener("click",function(e){var b=e.target.closest("[data-copy]");if(!b)return;var t=b.getAttribute("data-copy");var done=function(){var o=b.textContent;b.textContent="Copied";setTimeout(function(){b.textContent=o},1500)};try{navigator.clipboard.writeText(t).then(done,function(){var i=b.parentNode.querySelector("input");if(i){i.select();document.execCommand("copy");done()}})}catch(x){var i=b.parentNode.querySelector("input");if(i){i.select();try{document.execCommand("copy");done()}catch(y){}}}});</script>`;

const NOTICES = {
  wallet_saved: ['ok', 'Wallet saved. Your commissions are paid to it.'],
  wallet_cleared: ['info', 'Wallet removed. Commissions you earn stay on record and are paid once you add a wallet.'],
  wallet_empty: ['bad', WALLET_REASONS.empty],
  wallet_format: ['bad', WALLET_REASONS.format],
  wallet_checksum: ['bad', WALLET_REASONS.checksum],
  link_bad: ['bad', 'That does not look like a preview link. It should contain /p/ and the report id.'],
};

const copyBox = (link) => `<div class="linkbox"><input type="text" readonly value="${esc(link)}" onfocus="this.select()" aria-label="Your referral link"><button class="btn sm" type="button" data-copy="${esc(link)}">Copy link</button></div>`;

// The one-line verdict for a preview: label, tone and the sentence under it. Shared by the Links and tracker page and
// the Free previews list. `short` is the list version (no explaining sentence for "nobody yet").
export function readSummary(read, now, { short = false } = {}) {
  const [label, tone] = STATE_LABEL[read.state] ?? STATE_LABEL.none;
  let line;
  if (read.state === 'none') line = short ? 'Nobody has opened this link yet.' : 'Nobody has opened this link yet. When they do, you see it here: when, from where, how long they stayed and how far they scrolled.';
  else if (read.state === 'bots') line = `The link was fetched ${read.bots} time${read.bots === 1 ? '' : 's'} by a bot or a chat app's link preview, but no person has opened it yet.`;
  else {
    const bits = [`${read.views} view${read.views === 1 ? '' : 's'} by ${read.people} ${read.people === 1 ? 'person' : 'people'}`, `last ${ago(read.lastAt, now)}`];
    if (read.unmeasured) bits.push('time on the page was not measured (their browser did not report it)');
    else bits.push(`best visit ${duration(read.bestMs)} on the page`, read.maxScroll != null ? `scrolled up to ${Math.round(read.maxScroll)}%` : '');
    line = bits.filter(Boolean).join(' · ');
  }
  return { label, tone, line };
}

// The tracker block under one preview: the verdict, the numbers, and the last few views.
function trackerBlock(read, rows, { now, at }) {
  if (!read) return '<div class="track"><b>Visitor activity:</b> could not be read just now.</div>';
  const { label, tone, line } = readSummary(read, now);
  const humans = (rows ?? []).filter((r) => !r.is_bot).slice(0, 12);
  const table = humans.length ? `<details><summary>Every view (${humans.length}${read.views > humans.length ? ` of ${read.views}` : ''})</summary>
<table class="views"><thead><tr><th>When</th><th>Where</th><th>Device</th><th>On the page</th><th>Scrolled</th></tr></thead><tbody>${humans.map((r) => `<tr>
<td>${esc(at(r.created_at))}</td>
<td>${esc([r.city, r.country_code || r.country].filter(Boolean).join(', ') || 'Unknown')}</td>
<td>${esc([r.device, r.browser].filter(Boolean).join(' · '))}</td>
<td>${r.js ? esc(duration(r.active_ms)) : 'not measured'}</td>
<td>${r.scroll_pct == null ? '' : `${esc(r.scroll_pct)}%`}</td></tr>`).join('')}</tbody></table></details>` : '';
  return `<div class="track"><span class="badge ${esc(tone)}">${esc(label)}</span> ${esc(line)}${table}</div>`;
}

const SOLD = { pending: ['ok', 'Sold: commission earned'], held: ['wait', 'Sold: commission on hold'], paid: ['ok', 'Sold: commission paid'], void: ['', 'Sold: commission cancelled'] };

function previewRow(p, ctx) {
  const sold = p.sold ? SOLD[p.sold.status] ?? ['', 'Sold'] : null;
  const head = `<div class="what"><b>${esc(p.company)}</b><span>${esc(p.meta ?? '')}</span></div>`;
  if (!p.link) return `<div class="row">${head}<div class="acts"><span class="badge wait">Being prepared</span></div></div>`;
  return `<div class="row">${head}
<div class="acts">${sold ? `<span class="badge ${esc(sold[0])}">${esc(sold[1])}</span>` : ''}<a href="/p/${esc(p.reportId)}">Open preview</a></div>
${copyBox(p.link)}
${trackerBlock(p.read, p.rows, ctx)}
</div>`;
}

const COMMISSION_STATUS = { pending: ['ok', 'Earned: to be paid'], held: ['wait', 'On hold'], paid: ['ok', 'Paid'], void: ['bad', 'Cancelled'] };
const commissionBadge = (s) => { const [tone, label] = COMMISSION_STATUS[s] ?? ['', s]; return `<span class="badge ${esc(tone)}">${esc(label)}</span>`; };

// ---- The referrer's three pages, inside the account frame (account-ui.js) ----
// data: { shell: { email, nav, isAdmin }, code, commissionCents, wallet, notice, made, previews, others, commissions, now, tz }

const toNotice = (key) => { const n = key ? NOTICES[key] : null; return n ? { tone: n[0], text: n[1] } : null; };
const sumOf = (list, st) => (list ?? []).filter((c) => c.status === st).reduce((t, c) => t + Number(c.amount_cents || 0), 0);

// Shown on the links and earnings pages while commission is waiting and there is nowhere to send it.
const walletBanner = (d) => ((d.commissions ?? []).some((c) => c.status === 'pending') && !d.wallet
  ? '<p class="notice bad">You have earned commission but no wallet is saved yet. <a href="/account/referrals/wallet">Add your USDT wallet</a> so we can pay you.</p>' : '');

// 1. Links and tracker: the previews you can send, and who read them.
export function referralLinksPage(d) {
  const at = timeFmt(d.tz);
  const ctx = { now: d.now, at };
  const body = `
${walletBanner(d)}
<details class="how"${d.previews?.length ? '' : ' open'}>
<summary>How referring works</summary>
<ol class="how">
<li><b>Get a free preview</b> of a company's report on <a href="/account/previews">Free previews</a>. Anyone with an account can do this; there is nothing to apply for.</li>
<li><b>Send the preview link</b> below to the company's owner. It carries your referral code (<code class="addr">${esc(d.code ?? '')}</code>), so the sale is yours.</li>
<li><b>Watch whether they read it.</b> Each link has a visitor tracker: when it was opened, roughly where from, how long they stayed and how far they scrolled.</li>
<li><b>If they buy the full report, you earn ${esc(money(d.commissionCents))}</b>, paid in USDT to <a href="/account/referrals/wallet">your wallet</a>. Buying through your own link counts too.</li>
</ol>
</details>

<section class="blk" id="previews">
<h2>Your previews and who read them</h2>
<p class="lead">Your own visits are never counted. You see time, place (city), device and reading time, never IP addresses or names.</p>
${d.previews?.length ? `<div class="list">${d.previews.map((p) => previewRow(p, ctx)).join('')}</div>`
    : '<div class="empty"><b>No previews yet.</b> <a href="/account/previews">Ask for a free preview</a> of the company you want to sell to. When it is ready its link appears here.</div>'}
</section>

<section class="blk" id="link">
<h2>Get your link for any preview</h2>
<p class="lead">Already have a preview link, from the team or an email? Paste it to get the same page with your referral code on it.</p>
<form method="get" action="/account/referrals#link">
<input type="text" name="link" placeholder="Paste a preview link (…/p/…) or its report id" value="${esc(d.made?.input ?? '')}" required>
<button class="btn sm" type="submit">Make my link</button>
</form>
${d.made?.link ? `<p style="margin:14px 0 0"><b>Your link:</b></p>${copyBox(d.made.link)}<p class="fine">Opening it yourself does not count as a visitor.</p>` : ''}
</section>
${d.others?.length ? `<section class="blk" id="others">
<h2>Other previews opened through your link</h2>
<div class="list">${d.others.map((p) => previewRow({ ...p, meta: 'Opened through your referral link' }, ctx)).join('')}</div>
</section>` : ''}
${COPY_SCRIPT}`;
  return accountPage({
    title: 'Links and tracker', lede: `Send a preview link to the company's owner. If they buy the full report you earn ${esc(money(d.commissionCents))}.`,
    active: 'links', ...d.shell, notice: toNotice(d.notice), body, css: EXTRA,
  });
}

// 2. Earnings: what you are owed and what was paid.
export function referralEarningsPage(d) {
  const at = timeFmt(d.tz);
  const body = `
${walletBanner(d)}
<div class="kpis">
<div class="kpi big"><b>${esc(money(d.commissionCents))}</b><span>for each report you sell</span></div>
<div class="kpi"><b>${esc(money(sumOf(d.commissions, 'pending')))}</b><span>earned, to be paid</span></div>
<div class="kpi"><b>${esc(money(sumOf(d.commissions, 'paid')))}</b><span>paid to you</span></div>
${sumOf(d.commissions, 'held') ? `<div class="kpi"><b>${esc(money(sumOf(d.commissions, 'held')))}</b><span>on hold</span></div>` : ''}
</div>
<section class="blk" id="commissions">
<h2>Every commission</h2>
${d.commissions?.length ? `<div class="tbl"><table class="t"><thead><tr><th>Date</th><th>Report</th><th>Amount</th><th>Status</th><th>Paid</th></tr></thead><tbody>
${d.commissions.map((c) => `<tr><td>${esc(at(c.created_at))}</td><td>${esc(c.company ?? '')}</td><td><b>${esc(usdt(c.amount_cents))}</b></td>
<td>${commissionBadge(c.status)}${c.note ? `<span class="sub">${esc(c.note)}</span>` : ''}</td>
<td>${c.status === 'paid' ? `${esc(at(c.paid_at))}${c.paid_tx ? `<span class="sub">Transaction ${esc(c.paid_tx)}</span>` : ''}` : ''}</td></tr>`).join('')}
</tbody></table></div>` : '<div class="empty"><b>No sales yet.</b> When someone you referred pays for a full report, it appears here at once. <a href="/account/referrals">Get your links</a>.</div>'}
<p class="fine" style="margin-top:14px">Commission is recorded the moment the buyer's payment goes through. Payouts are USDT only, sent by our team to <a href="/account/referrals/wallet">your wallet</a>. A refunded payment cancels its commission.</p>
</section>`;
  return accountPage({
    title: 'Earnings', lede: 'What you have earned by referring, and what has been paid out.',
    active: 'earnings', ...d.shell, notice: toNotice(d.notice), body, css: EXTRA,
  });
}

// 3. Payout wallet. One box: the address. The chain is read from the address itself (no network to pick, owner decision
// 2026-11-13), so the page says what the two shapes look like instead of asking a question that can be answered wrongly.
export function referralWalletPage(d) {
  const w = d.wallet;
  const body = `
${walletBanner(d)}
<section class="blk" id="wallet">
<p class="lead">${w ? `Saved: <b>${esc(networkLabel(w.network))}</b> <code class="addr">${esc(w.address)}</code>` : 'No wallet saved yet. You can earn without one; we pay once you add it.'}</p>
<form class="wallet" method="post" action="/account/referrals/wallet">
<label class="f" for="wallet-address">USDT wallet address</label>
<input id="wallet-address" name="address" type="text" maxlength="100" value="${esc(w?.address ?? '')}" placeholder="Paste your USDT wallet address" autocomplete="off" spellcheck="false">
<p class="fine">Paste the address only. We read the chain from it: <b>T…</b> is a TRON (TRC20) address, <b>0x…</b> is an EVM address (Ethereum ERC20 or BNB Smart Chain BEP20). TRON is the cheapest to send on. Money sent to a wrong address cannot be recovered.</p>
<div class="acts"><button class="btn" type="submit">${w ? 'Update wallet' : 'Save wallet'}</button>${w ? '<button class="btn quiet" type="submit" name="clear" value="1" formnovalidate>Remove wallet</button>' : ''}</div>
</form>
</section>`;
  return accountPage({
    title: 'Payout wallet', lede: 'Where we send your commission. USDT only.',
    active: 'wallet', ...d.shell, notice: toNotice(d.notice), body, css: EXTRA,
  });
}

// ---- Team page ----

const ADMIN_NOTICES = {
  commission_saved: ['ok', 'Commission saved. It applies to sales from now on; commissions already earned keep the amount they were earned at.'],
  commission_bad: ['bad', 'That is not an amount. Enter dollars, for example 20 or 12.50.'],
  paid: ['ok', 'Marked as paid, and the referrer was emailed.'],
  paid_not_emailed: ['bad', 'Marked as paid, but the email to the referrer could not be sent.'],
  voided: ['ok', 'Commission cancelled.'],
  approved: ['ok', 'Commission approved: it is now earned and ready to be paid.'],
  missing: ['bad', 'That commission no longer exists.'],
};

// data: { email, commissionCents, totals, commissions, notice, error, now, tz }
export function adminReferralsPage(d) {
  const at = timeFmt(d.tz);
  const n = d.notice ? ADMIN_NOTICES[d.notice] : null;
  const money0 = (c) => money(c);
  const rows = (d.commissions ?? []).map((c) => {
    const wallet = d.wallets?.get?.(c.referrer_email);
    const acts = c.status === 'pending'
      ? `<form class="inline" method="post" action="/myoffice/referrals/${c.id}/paid"><input type="text" name="tx" placeholder="Transaction hash (after you send it)" aria-label="Transaction hash"><button class="btn sm" type="submit">Mark paid</button></form>
<form class="inline" method="post" action="/myoffice/referrals/${c.id}/void"><button class="btn quiet sm" type="submit">Cancel</button></form>`
      : c.status === 'held'
        ? `<form class="inline" method="post" action="/myoffice/referrals/${c.id}/approve"><button class="btn sm" type="submit">Approve</button></form>
<form class="inline" method="post" action="/myoffice/referrals/${c.id}/void"><button class="btn quiet sm" type="submit">Cancel</button></form>`
        : '';
    return `<tr><td>${esc(at(c.created_at))}</td>
<td>${esc(c.referrer_email)}<span class="sub">${wallet ? `${esc(networkLabel(wallet.network))} <code class="addr">${esc(wallet.address)}</code>` : (c.status === 'pending' || c.status === 'held' ? '<b>No wallet saved</b>' : '')}</span></td>
<td>${esc(c.company ?? '')}<span class="sub">bought by ${esc(c.buyer_email ?? '')} · via ${esc(c.source ?? '')}</span></td>
<td><b>${esc(usdt(c.amount_cents))}</b></td>
<td>${commissionBadge(c.status)}${c.note ? `<span class="sub">${esc(c.note)}</span>` : ''}${c.status === 'paid' ? `<span class="sub">${esc(at(c.paid_at))}${c.paid_tx ? ` · ${esc(c.paid_tx)}` : ''}${c.paid_wallet ? ` · to ${esc(shortWallet(c.paid_wallet))}` : ''}</span>` : ''}</td>
<td>${acts}</td></tr>`;
  }).join('');
  const totalRows = (d.totals ?? []).map((t) => `<tr><td>${esc(t.email)}</td><td>${esc(t.sales)}</td><td><b>${esc(money0(t.pending_cents))}</b></td><td>${esc(money0(t.held_cents))}</td><td>${esc(money0(t.paid_cents))}</td>
<td>${t.payout_wallet ? `${esc(networkLabel(t.payout_network))}<span class="sub"><code class="addr">${esc(t.payout_wallet)}</code></span>` : '<span class="badge wait">No wallet</span>'}</td></tr>`).join('');

  const checkoutRows = (d.checkouts ?? []).map((k) => {
    const paid = k.paid_at ? '<span class="badge ok">Paid</span>' : '<span class="badge wait">Not paid (yet)</span>';
    const who = k.detected
      ? `<span class="badge ok">Referrer detected</span><span class="sub">${esc(k.referrer_email ?? `code ${k.referrer_code}`)} · via ${esc(k.source ?? '')}</span>`
      : '<span class="badge">No referrer</span>';
    const com = k.commission_status ? commissionBadge(k.commission_status) : (k.detected && k.paid_at ? '<span class="badge bad">No commission recorded</span>' : '');
    return `<tr><td>${esc(at(k.created_at))}</td><td>${esc(k.company ?? '')}<span class="sub">${esc(k.buyer_email ?? '')}</span></td><td>${who}</td><td>${paid}</td><td>${com}</td></tr>`;
  }).join('');

  const body = `
<div class="top">
<div><h1>Team: referrals</h1><p>Signed in as <b>${esc(d.email)}</b> · <a href="/myoffice/previews">Preview requests</a> · <a href="/myoffice/users">Users</a> · <a href="/myoffice/visitors">Visitors</a></p></div>
</div>
${n ? `<p class="notice ${n[0] === 'ok' ? '' : n[0]}">${esc(n[1])}</p>` : ''}
${d.error ? `<p class="notice bad">${esc(d.error)}</p>` : ''}

<section class="blk">
<h2>Commission per sold report</h2>
<p class="lead">Now <b>${esc(money(d.commissionCents))}</b> (${esc(COMMISSION_CURRENCY.toUpperCase())}, paid as USDT). Stored in the site database (<code class="addr">settings.referral_commission_cents</code>); the default is USD 20. A change applies to sales from now on.</p>
<form class="setting" method="post" action="/myoffice/referrals/commission">
<label class="f" for="usd" style="margin:0">USD</label>
<input id="usd" name="usd" type="text" inputmode="decimal" value="${esc((Number(d.commissionCents) / 100).toFixed(2))}" required>
<button class="btn sm" type="submit">Save</button>
</form>
</section>

<section class="blk">
<h2>Who is owed what</h2>
<p class="lead">Payouts are sent by hand: send the USDT from your own wallet, then paste the transaction hash on that commission and press Mark paid. The site never moves money.</p>
${totalRows ? `<div class="tbl"><table class="t"><thead><tr><th>Referrer</th><th>Sales</th><th>To pay</th><th>On hold</th><th>Paid</th><th>Wallet</th></tr></thead><tbody>${totalRows}</tbody></table></div>` : '<div class="empty">No referral sales yet.</div>'}
</section>

<section class="blk">
<h2>Every commission</h2>
<p class="lead">Open ones first. A commission the referrer bought themselves is labelled "Own purchase" and pays like any other. <b>On hold</b> is only used if the team puts one there.</p>
${rows ? `<div class="tbl"><table class="t" style="min-width:900px"><thead><tr><th>Date</th><th>Referrer</th><th>Report</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">Nothing yet. A commission appears here the moment a referred buyer pays.</div>'}
</section>

<section class="blk">
<h2>Checkouts: was a referrer detected?</h2>
<p class="lead">Every checkout started for a report is recorded the moment it is created, with the referrer found (or none), whether it was paid or not.</p>
${checkoutRows ? `<div class="tbl"><table class="t"><thead><tr><th>Started</th><th>Report / buyer</th><th>Referrer</th><th>Payment</th><th>Commission</th></tr></thead><tbody>${checkoutRows}</tbody></table></div>` : '<div class="empty">No checkout started yet.</div>'}
</section>`;
  return page('Team: referrals', body, { wide: true, css: CSS });
}
