// The checkout page (/order) and the progress steps shared by the sign-in and done pages.
// Pure rendering. Every claim on this page must be true of the code: the sign-in link is single use and
// short lived (LINK_MINUTES), a new link replaces the old one, a session lasts 30 days, card details are
// entered on Stripe's own page. Change the copy here when those facts change.

import { page, esc } from './pages.js';
import { REPORT_MINUTES } from './emails.js';

const ICON = {
  lock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
};

export const HEAD_NOTE = `${ICON.lock} Secure checkout`;

const testBanner = (testMode) => testMode ? '<p class="test"><b>Test mode.</b> No real money moves. Pay with card 4242 4242 4242 4242, any future date, any CVC.</p>' : '';

// The three steps of buying. `now` = the step being done (1, 2 or 3); earlier steps show as done; 4 = all done.
export function checkoutSteps(now) {
  const items = [
    ['Your email', 'We confirm the inbox is yours'],
    ['Pay securely', "On Stripe's own page"],
    ['Report is made', `About ${REPORT_MINUTES} minutes`],
  ];
  return `<ol class="costeps" aria-label="Checkout progress">${items.map(([t, d], i) => {
    const n = i + 1;
    const state = n < now ? 'done' : n === now ? 'now' : '';
    return `<li class="${state}"${n === now ? ' aria-current="step"' : ''}><span class="n">${n < now ? ICON.check : n}</span><span class="t"><b>${t}</b><span>${d}</span></span></li>`;
  }).join('')}</ol>`;
}

export const CHECKOUT_CSS = `
.headnote { display:inline-flex; align-items:center; gap:6px; font-size:14px; font-weight:600; color:var(--good); background:var(--good-bg); padding:6px 12px; border-radius:99px; }
ol.costeps { list-style:none; margin:0 0 26px; padding:0; display:grid; grid-template-columns:repeat(3,1fr); background:var(--paper); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
ol.costeps li { display:flex; align-items:center; gap:12px; padding:16px 18px; border-left:1px solid var(--line); color:var(--grey); }
ol.costeps li:first-child { border-left:0; }
ol.costeps .n { flex:none; width:30px; height:30px; border-radius:50%; display:grid; place-items:center; font:600 14px var(--body); background:var(--band); color:var(--grey); }
ol.costeps .t { display:flex; flex-direction:column; line-height:1.3; }
ol.costeps .t b { font-size:15px; color:inherit; }
ol.costeps .t span { font-size:13px; color:var(--grey); }
ol.costeps li.now { color:var(--ink); background:#fafbfc; box-shadow:inset 0 -3px 0 var(--ink); }
ol.costeps li.now .n { background:var(--ink); color:#fff; }
ol.costeps li.done { color:var(--ink); }
ol.costeps li.done .n { background:var(--good-bg); color:var(--good); }
.cogrid { display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:28px; align-items:start; }
.cobody > section, .card { background:var(--paper); border:1px solid var(--line); border-radius:14px; padding:26px clamp(20px,3vw,32px); margin-bottom:18px; }
.cobody h1, .card h1 { font-size:clamp(28px,4vw,38px); }
.cobody h2, .card h2 { font-family:var(--display); font-weight:600; letter-spacing:-0.02em; font-size:21px; margin:0 0 6px; }
.cobody .lead { font-size:18px; margin-bottom:0; }
.kyc { border-color:var(--good) !important; background:linear-gradient(180deg,#f3fbf7,#fff 70%) !important; }
.kyc .tag { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--good); margin-bottom:8px; }
.kyc h2 { font-size:26px; }
.keypoints { list-style:none; padding:0; margin:14px 0 0; display:grid; gap:14px; }
.keypoints li { display:grid; grid-template-columns:40px 1fr; gap:12px; align-items:start; color:var(--grey); font-size:16px; }
.keypoints .ic { width:40px; height:40px; border-radius:10px; background:var(--good-bg); color:var(--good); display:grid; place-items:center; }
.keypoints li b { display:block; color:var(--ink); font-size:16px; margin-bottom:1px; }
.chapters { list-style:none; padding:0; margin:12px 0 0; }
.chapters li { display:flex; gap:12px; padding:11px 0; border-top:1px solid var(--line); color:var(--grey); font-size:16px; }
.chapters li:first-child { border-top:0; }
.chapters li .c { flex:none; width:24px; height:24px; border-radius:50%; background:var(--band); color:var(--ink); font:600 12px var(--body); display:grid; place-items:center; margin-top:2px; }
.chapters li b { color:var(--ink); }
.extras { margin:14px 0 0; padding:14px 16px; background:var(--band); border-radius:10px; font-size:15px; color:var(--grey); }
.extras b { color:var(--ink); }
ol.after { list-style:none; margin:14px 0 0; padding:0; counter-reset:a; }
ol.after li { position:relative; padding:0 0 18px 44px; color:var(--grey); font-size:16px; }
ol.after li:last-child { padding-bottom:0; }
ol.after li::before { counter-increment:a; content:counter(a); position:absolute; left:0; top:0; width:28px; height:28px; border-radius:50%; background:var(--ink); color:#fff; font:600 13px var(--body); display:grid; place-items:center; }
ol.after li::after { content:""; position:absolute; left:13.5px; top:32px; bottom:4px; width:1px; background:var(--line); }
ol.after li:last-child::after { display:none; }
ol.after li b { display:block; color:var(--ink); }
.coside { position:sticky; top:18px; }
.sumcard { background:var(--paper); border:1px solid var(--ink); border-radius:14px; padding:24px; box-shadow:0 10px 30px rgba(17,20,24,.08); }
.sumcard .lbl { font-size:13px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--grey); margin:0 0 10px; }
.sumcard .item { font-family:var(--display); font-weight:600; font-size:19px; letter-spacing:-0.02em; line-height:1.25; margin:0 0 4px; color:var(--ink); }
.sumcard .sub { font-size:14px; margin:0 0 14px; }
.sumcard .tot { display:flex; justify-content:space-between; align-items:baseline; border-top:1px solid var(--line); padding-top:14px; margin-bottom:16px; }
.sumcard .tot span { font-size:15px; color:var(--grey); }
.sumcard .tot b { font-family:var(--display); font-size:34px; letter-spacing:-0.03em; font-weight:600; }
.sumcard label.f { font-size:14px; font-weight:600; color:var(--ink); display:block; margin:0 0 6px; }
.sumcard input[type=email] { margin-bottom:10px; }
.sumcard .btn { width:100%; text-align:center; font-size:18px; padding:15px 22px; }
.sumcard .who { font-size:14px; background:var(--band); border-radius:10px; padding:10px 12px; margin:0 0 14px; color:var(--grey); word-break:break-all; }
.sumcard .who b { color:var(--ink); }
.sumcard .fine { font-size:13px; margin:12px 0 0; text-align:center; }
.sumcard ul.pledge { list-style:none; padding:14px 0 0; margin:16px 0 0; border-top:1px solid var(--line); display:grid; gap:8px; }
.sumcard ul.pledge li { display:flex; gap:8px; font-size:14px; color:var(--grey); line-height:1.4; }
.sumcard ul.pledge li svg { flex:none; color:var(--good); margin-top:1px; }
.stripeline { display:flex; align-items:center; justify-content:center; gap:6px; font-size:13px; color:var(--grey); margin-top:12px; text-align:center; }
.faq details { border-top:1px solid var(--line); padding:12px 0; }
.faq details:first-of-type { border-top:0; }
.faq summary { cursor:pointer; font-weight:600; color:var(--ink); font-size:16px; }
.faq details p { margin:8px 0 0; font-size:15px; }
.card .after-note { font-size:14px; }
.mailbox { width:56px; height:56px; border-radius:16px; background:var(--good-bg); color:var(--good); display:grid; place-items:center; margin-bottom:14px; }
.mailbox svg { width:28px; height:28px; }
.kycbar { display:none; }
@media (max-width:860px) {
  .kycbar { display:block; background:#f3fbf7; border:1px solid var(--good); border-radius:14px; padding:14px 16px; margin:0 0 18px; font-size:15px; color:var(--grey); }
  .kycbar b { color:var(--good); }
  .cogrid { grid-template-columns:1fr; }
  .coside { position:static; order:-1; }
  ol.costeps { grid-template-columns:1fr; }
  ol.costeps li { border-left:0; border-top:1px solid var(--line); padding:12px 16px; }
  ol.costeps li:first-child { border-top:0; }
  ol.costeps li.now { box-shadow:inset 3px 0 0 var(--ink); }
  ol.costeps .t { flex-direction:row; gap:8px; align-items:baseline; flex-wrap:wrap; }
}
`;

// Wraps the checkout steps pages (sign-in, check email, done) in the same look.
export function checkoutShell(title, steps, inner, { testMode, refresh } = {}) {
  return page(title, `${testBanner(testMode)}${checkoutSteps(steps)}<section class="card" style="max-width:640px;margin-left:auto;margin-right:auto">${inner}</section>`,
    { wide: true, bare: true, css: CHECKOUT_CSS, headNote: HEAD_NOTE, refresh });
}

// `email` is the signed-in account, or null. Paying needs an account, because the purchase, the invoice and
// the report link all follow the email.
// `field` is what the order is keyed on: 'dive' (a hub company dive) or 'report' (a company-diver report).
export function orderPage({ dive, price, testMode, email, field = 'dive' }) {
  const action = email
    ? `<div class="who">Signed in as <b>${esc(email)}</b></div>
<form method="post" action="/order/checkout">
<input type="hidden" name="${field}" value="${esc(dive.publicId)}">
<button class="btn" type="submit">Pay ${esc(price)} securely</button>
</form>
<p class="fine">You review and confirm on Stripe's page. <a href="/account">Your account</a></p>`
    : `<form method="post" action="/login">
<input type="hidden" name="next" value="${esc(`/order?${field}=${dive.publicId}`)}">
<label class="f" for="co-email">Enter your email to pay</label>
<input id="co-email" type="email" name="email" placeholder="you@company.com" autocomplete="email" required>
<button class="btn" type="submit">Email me my sign-in link</button>
</form>
<p class="fine"><b>Step 1 of 2 before you pay.</b> We send a link to confirm the inbox is yours. Open it, come back here and pay. No password, no ID.</p>`;

  const body = `${testBanner(testMode)}
${checkoutSteps(email ? 2 : 1)}
<p class="kycbar"><b>No KYC. Email only.</b> No ID, no documents, no password. We email you a magic sign-in link, and your account then lists every report you bought and its status.</p>
<div class="cogrid">
<div class="cobody">
<section>
<h1>Full report on ${esc(dive.company)}</h1>
<p class="lead">Everything the free preview keeps locked, plus the work done for you. One payment, one company, no subscription.</p>
</section>

<section class="kyc" aria-labelledby="h-kyc">
<span class="tag">${ICON.check} No ID check</span>
<h2 id="h-kyc">We do not do KYC. Your email is all we need.</h2>
<ul class="keypoints">
<li><span class="ic">${ICON.user}</span><span><b>No ID, no documents, no password</b>MirrorMirror asks for one thing: your email address. No identity check, no company papers, no sign-up form.</span></li>
<li><span class="ic">${ICON.mail}</span><span><b>A sign-in link arrives by email</b>First to confirm your inbox, and again when you have paid. Open it and you are signed in; your device then stays signed in for 30 days.</span></li>
<li><span class="ic">${ICON.list}</span><span><b>Locked out? Ask for a new link</b>Each link works once and is short-lived, for your safety. Need back in, or on another device? Request a new one any time at <a href="/login">mirrormirror.cloud/login</a>. A new link always replaces the one before it.</span></li>
</ul>
</section>

<section aria-labelledby="h-get">
<h2 id="h-get">What is in your report</h2>
<ul class="chapters">
<li><span class="c">1</span><span><b>Reputation.</b> What reviews and public sources say, and where they disagree</span></li>
<li><span class="c">2</span><span><b>Search and Maps.</b> Where customers find you, or do not</span></li>
<li><span class="c">3</span><span><b>AI assistants.</b> Whether they name you when asked</span></li>
<li><span class="c">4</span><span><b>Websites.</b> Broken links, contact details, legal details</span></li>
<li><span class="c">5</span><span><b>Licences and awards.</b> Claims checked against the official registers</span></li>
</ul>
<p class="extras"><b>Ready to use:</b> a rewritten homepage, review replies, pages to add, an AI plan and a 30-day plan. One link that works on desktop and mobile, and prints to A4.</p>
</section>

<section aria-labelledby="h-after">
<h2 id="h-after">What happens after you pay</h2>
<ol class="after">
<li><b>Payment confirmed</b>Stripe confirms it and we email your invoice to ${email ? `<b>${esc(email)}</b>` : 'your email address'}.</li>
<li><b>Your report starts</b>The research begins as soon as the payment goes through. We also email you a sign-in link.</li>
<li><b>About ${REPORT_MINUTES} minutes later (2 hours)</b>Your report is ready. Its link shows progress while it is made and fills in by itself.</li>
</ol>
</section>

<section aria-labelledby="h-acct">
<h2 id="h-acct">Your account keeps everything in one place</h2>
<p style="margin:0">Sign in with your email and your account lists <b>every report you have bought</b>, each with its status: <b>Being prepared</b> while we make it, <b>Ready</b> when it is done. Your invoices are there too, and you can have any of them emailed again.</p>
</section>

<section class="faq" aria-labelledby="h-faq">
<h2 id="h-faq">Questions</h2>
<details><summary>Is my card safe?</summary><p>You pay on Stripe's own page. Your card details go to Stripe, never to MirrorMirror.</p></details>
<details><summary>When am I charged?</summary><p>Only when you confirm the payment on Stripe's page. The button here takes you there; nothing is charged before that.</p></details>
<details><summary>Do I need to make an account first?</summary><p>No form to fill in. Your email is your account: it is created the first time you open a sign-in link, and your invoice and reports follow that email.</p></details>
<details><summary>Is the company told?</summary><p>No. Reports use public sources only, and the company you ask about is never told.</p></details>
<details><summary>Does this cover other companies?</summary><p>This payment is for ${esc(dive.company)} only. Another company is another report.</p></details>
</section>
</div>

<aside class="coside" aria-label="Order summary">
<div class="sumcard">
<p class="lbl">Order summary</p>
<p class="item">Full report: ${esc(dive.company)}</p>
<p class="sub">One-time payment. No subscription. The report takes about ${REPORT_MINUTES} minutes to make.</p>
<div class="tot"><span>Total</span><b>${esc(price)}</b></div>
${action}
<ul class="pledge">
<li>${ICON.check}<span>No ID check. Email only.</span></li>
<li>${ICON.check}<span>Invoice emailed after payment</span></li>
<li>${ICON.check}<span>Follow progress in your account</span></li>
</ul>
<div class="stripeline">${ICON.lock} Payments by Stripe. Card details never reach us.</div>
</div>
</aside>
</div>`;
  return page(`Full report: ${dive.company}`, body, { wide: true, bare: true, css: CHECKOUT_CSS, headNote: HEAD_NOTE });
}

// Sign-in and check-email pages when the visitor came from checkout (`next` is an /order path).
export const fromCheckout = (next) => String(next ?? '').startsWith('/order');

export function checkoutLogin({ next, email = '', error = null, testMode }) {
  return checkoutShell('Confirm your email', 1, `<h1>Confirm your email</h1>
<p>Enter your email. We send you a link that signs you in, then you go straight to payment. <b>No password, no ID, no account to set up</b>: your email is your account.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/login">
<input type="hidden" name="next" value="${esc(next ?? '')}">
<input type="email" name="email" value="${esc(email)}" placeholder="you@company.com" autocomplete="email" required>
<button class="btn" type="submit">Email me a sign-in link</button>
</form>
<p class="note">We use your email for your invoice, your report link and your sign-in links. Nothing else.</p>`, { testMode });
}

export function checkoutCheckEmail({ email, minutes, next, testMode }) {
  return checkoutShell('Check your email', 1, `<div class="mailbox">${ICON.mail}</div>
<span class="ok">Link sent</span>
<h1>Check your email</h1>
<p>We sent a sign-in link to <b>${esc(email)}</b>. Open it and press <b>Continue</b>: you will land back on checkout, ready to pay.</p>
<p class="note">The link works once and expires in ${esc(minutes)} minutes. Nothing yet? Look in spam, or <a href="/login?next=${encodeURIComponent(next ?? '')}">ask for a new link</a>. A new link cancels the earlier one, so use the newest email.</p>`, { testMode });
}
