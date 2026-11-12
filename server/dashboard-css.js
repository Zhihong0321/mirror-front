// The dashboard's shared styles: rows, badges, lists, notices, progress steps. Used by every account page and the team pages.

export const DASHBOARD_CSS = `
.top { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:6px; }
.top h1 { margin-bottom:4px; }
.top p { margin:0; }
.notice { padding:12px 16px; border-radius:10px; margin:18px 0 0; font-size:16px; background:var(--good-bg); color:var(--good); font-weight:600; }
.notice.bad { background:#fdecea; color:var(--wrong); }
.notice.info { background:var(--band); color:var(--ink); font-weight:500; }
ol.steps { list-style:none; margin:26px 0 8px; padding:0; display:grid; grid-template-columns:repeat(3,1fr); gap:12px; counter-reset:s; }
ol.steps li { border:1px solid var(--line); border-radius:12px; padding:16px; position:relative; display:flex; flex-direction:column; gap:4px; background:#fff; }
ol.steps li b { color:var(--ink); font-size:16px; }
ol.steps li span.d { font-size:14px; color:var(--grey); line-height:1.45; }
ol.steps .n { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; font:600 13px var(--body); background:var(--band); color:var(--grey); margin-bottom:6px; }
ol.steps li.now { border-color:var(--ink); box-shadow:0 0 0 1px var(--ink) inset; }
ol.steps li.now .n { background:var(--ink); color:#fff; }
ol.steps li.done .n { background:var(--good-bg); color:var(--good); }
section.blk { margin-top:34px; }
section.blk h2 { font-family:var(--display); font-weight:600; letter-spacing:-0.02em; font-size:24px; margin:0 0 6px; }
section.blk > p.lead { margin-bottom:16px; }
.ask-grid { display:grid; grid-template-columns:1fr 1fr; gap:0 14px; }
.ask-grid .full { grid-column:1 / -1; }
label.f { display:block; font-size:14px; font-weight:600; color:var(--ink); margin:0 0 6px; }
label.f small { font-weight:400; color:var(--grey); }
fieldset.who { border:0; padding:0; margin:0 0 14px; display:flex; flex-wrap:wrap; gap:8px; }
fieldset.who legend { font-size:14px; font-weight:600; padding:0; margin-bottom:8px; }
fieldset.who label { display:inline-flex; align-items:center; gap:8px; border:1px solid var(--line); border-radius:99px; padding:8px 14px; font-size:15px; cursor:pointer; color:var(--ink); }
fieldset.who input { margin:0; accent-color:var(--ink); }
fieldset.who label:has(input:checked) { border-color:var(--ink); background:var(--band); }
details.have { margin-top:16px; border-top:1px solid var(--line); padding-top:14px; }
details.have summary { cursor:pointer; font-size:15px; font-weight:600; color:var(--ink); }
details.have form { margin-top:12px; display:flex; gap:10px; flex-wrap:wrap; }
details.have input { flex:1 1 280px; margin:0; }
.list { border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:16px 18px; border-top:1px solid var(--line); flex-wrap:wrap; }
.row:first-child { border-top:0; }
.row .what b { display:block; color:var(--ink); font-size:17px; }
.row .what span { font-size:14px; color:var(--grey); }
.row .what .hint { display:block; margin-top:3px; }
.row .acts { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.row .acts form { display:inline; }
.row .acts a:not(.btn) { color:var(--ink); font-weight:600; font-size:15px; }
.btn.sm { font-size:15px; padding:10px 16px; }
.badge { display:inline-block; font-size:13px; font-weight:600; padding:4px 10px; border-radius:99px; background:var(--band); color:var(--grey); white-space:nowrap; }
.badge.ok { background:var(--good-bg); color:var(--good); }
.badge.wait { background:#fdf3e2; color:#a15c07; }
.badge.bad { background:#fdecea; color:var(--wrong); }
.row .what .hint { color:var(--ink); }
ol.prog { flex-basis:100%; list-style:none; margin:2px 0 0; padding:12px 0 0; border-top:1px dashed var(--line); display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:8px 18px; }
ol.prog li { display:flex; gap:10px; align-items:flex-start; font-size:14px; color:var(--grey); line-height:1.4; }
ol.prog li i { font-style:normal; width:20px; height:20px; border-radius:50%; display:grid; place-items:center; font-size:11px; flex:none; background:var(--band); color:var(--grey); }
ol.prog li small { display:block; font-size:13px; }
ol.prog li.done { color:var(--ink); } ol.prog li.done i { background:var(--good-bg); color:var(--good); }
ol.prog li.now { color:var(--ink); font-weight:600; } ol.prog li.now i { background:#fdf3e2; color:#a15c07; } ol.prog li.now small { font-weight:400; color:#a15c07; }
ol.prog li.bad { color:var(--wrong); font-weight:600; } ol.prog li.bad i { background:#fdecea; color:var(--wrong); }
.empty { border:1px dashed #cfd3d8; border-radius:12px; padding:22px; color:var(--grey); }
.empty b { color:var(--ink); }
@media (max-width:720px) { ol.steps { grid-template-columns:1fr; gap:8px; } ol.steps li { flex-direction:row; align-items:center; gap:12px; padding:12px 14px; } ol.steps li span.d { display:none; } ol.steps .n { margin:0; flex:none; } .ask-grid { grid-template-columns:1fr; } .top { flex-direction:column; } }
`;
