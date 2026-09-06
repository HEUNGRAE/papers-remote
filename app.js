/* Paper Studio Remote — 정적 스냅샷 SPA (GitHub Pages) */
'use strict';

const $view = document.getElementById('view');
const PAGE = 50;
const L1_EMOJI = { '1':'🔭','2':'📐','3':'⚙️','4':'💻','5':'🧬','6':'🏛️','7':'📜','8':'🌍','9':'🔗','10':'🧰' };

let META = null;
let TAX = new Map();       // code -> {code, level, ko, en, parent, dn, tn}
let CHILDREN = new Map();  // parent -> [codes]
let IDX = null;            // [[pid, title, year, cite, l4], ...]
let idxPromise = null;

/* ── utils ── */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num = n => (n ?? 0).toLocaleString('ko-KR');

function fnv1a(str) {
  const bytes = new TextEncoder().encode(str);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const shardOf = pid => fnv1a(pid) % META.shard_n;

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

/* ── boot ── */
async function boot() {
  try {
    META = await fetchJSON('data/meta.json');
    const tax = await fetchJSON('data/taxonomy.json');
    for (const [code, level, ko, en, parent, dn, tn] of tax) {
      TAX.set(code, { code, level, ko, en, parent, dn, tn });
      if (parent) {
        if (!CHILDREN.has(parent)) CHILDREN.set(parent, []);
        CHILDREN.get(parent).push(code);
      }
    }
    const segsort = c => c.split('.').map(x => x.padStart(4, '0')).join('.');
    for (const arr of CHILDREN.values()) arr.sort((a, b) => segsort(a) < segsort(b) ? -1 : 1);
    document.getElementById('net-badge').textContent = `snapshot ${META.built.slice(0, 10)}`;
    route();
  } catch (e) {
    $view.innerHTML = `<div class="err">데이터 로딩 실패<br>${esc(e.message)}<br><br>새로고침해 주세요.</div>`;
  }
}

function loadIndex(onProgress) {
  if (IDX) return Promise.resolve(IDX);
  if (idxPromise) return idxPromise;
  idxPromise = (async () => {
    const parts = new Array(META.idx_files);
    let done = 0;
    await Promise.all(Array.from({ length: META.idx_files }, (_, i) =>
      fetchJSON(`data/index/idx_${i}.json`).then(d => {
        parts[i] = d; done++;
        if (onProgress) onProgress(done, META.idx_files);
      })
    ));
    IDX = parts.flat();
    return IDX;
  })();
  return idxPromise;
}

/* ── router ── */
window.addEventListener('hashchange', route);

function route() {
  if (window.PSRGraph) PSRGraph.unmount();
  const h = location.hash.replace(/^#\/?/, '');
  const [head, ...rest] = h.split('/');
  const arg = rest.join('/');
  window.scrollTo(0, 0);
  setTab(head);
  if (!head) return vHome();
  if (head === 'browse') return vBrowse();
  if (head === 't') return vNode(decodeURIComponent(arg));
  if (head === 'search') return vSearch('');
  if (head === 's') return vSearch(decodeURIComponent(arg));
  if (head === 'p') return vPaper(decodeURIComponent(arg));
  if (head === 'g') return vGraph(arg ? decodeURIComponent(arg) : null);
  if (head === 'about') return vAbout();
  vHome();
}

function setTab(head) {
  const map = { '': 'home', browse: 'browse', t: 'browse', search: 'search', s: 'search', p: 'browse', g: 'graph', about: 'about' };
  const tab = map[head] ?? 'home';
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
}

/* ── 3D 지식그래프 ── */
function loadScript(src, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res();
    s.onerror = () => rej(new Error(src + ' 로드 실패'));
    document.head.appendChild(s);
  });
}

async function vGraph(focusPid) {
  $view.innerHTML = `<div class="boot"><div class="spinner"></div><p>3D 엔진 로딩 중…</p></div>`;
  try {
    await loadScript('vendor/three.min.js', () => window.THREE);
    await loadScript('vendor/OrbitControls.js', () => window.THREE && THREE.OrbitControls);
    await loadScript('graph.js', () => window.PSRGraph);
  } catch (e) {
    $view.innerHTML = `<div class="err">3D 엔진 로딩 실패<br>${esc(e.message)}</div>`;
    return;
  }
  if (!location.hash.startsWith('#/g')) return;
  $view.innerHTML = '';
  PSRGraph.mount($view, { META, TAX, loadIndex, esc, num }, focusPid || null);
}

/* ── views ── */
function vHome() {
  const l1s = (CHILDREN.get(null) || CHILDREN.get('') || [...TAX.values()].filter(n => n.level === 1).map(n => n.code));
  $view.innerHTML = `
    <div class="hero">
      <h1>지식의 은하를<br><b>주머니 속에서</b></h1>
      <p>논문 ${num(META.papers)}편 · 분류 ${num(META.nodes)}개 · 한국어 심층 해설 ${META.explainer_pct}%</p>
    </div>
    <form class="searchbox" id="homeSearch">
      <input type="search" placeholder="논문 제목 검색 (한/영)" enterkeyhint="search">
      <button type="submit">검색</button>
    </form>
    <div class="stat-row">
      <div class="stat"><b>${num(META.papers)}</b><i>논문</i></div>
      <div class="stat"><b>${num(META.nodes)}</b><i>분류 노드</i></div>
      <div class="stat"><b>${META.explainer_pct}%</b><i>심층 해설</i></div>
    </div>
    <a class="graph-banner" href="#/g">
      <b>🌌 3D 지식그래프</b>
      <span>93,428편 논문 은하 · 분류망 · 분야 간 크로스레퍼런스 링크</span>
    </a>
    <div class="sec-title">대분류 탐색</div>
    <div class="l1-grid">
      ${l1s.map(c => {
        const n = TAX.get(c);
        return `<a class="l1-card" href="#/t/${encodeURIComponent(c)}">
          <span class="emj">${L1_EMOJI[c] || '📁'}</span>
          <b>${esc(n.ko)}</b>
          <i>${num(n.tn)}편</i>
        </a>`;
      }).join('')}
    </div>`;
  document.getElementById('homeSearch').addEventListener('submit', e => {
    e.preventDefault();
    const q = e.target.querySelector('input').value.trim();
    if (q) location.hash = '#/s/' + encodeURIComponent(q);
  });
}

function vBrowse() {
  const l1s = [...TAX.values()].filter(n => n.level === 1).map(n => n.code)
    .sort((a, b) => parseInt(a) - parseInt(b));
  $view.innerHTML = `
    <div class="node-head"><h2>분류 탐색</h2><div class="cnt">L1 → L4 계층 구조</div></div>
    <div class="sub-list">
      ${l1s.map(c => {
        const n = TAX.get(c);
        return `<a class="sub-item" href="#/t/${encodeURIComponent(c)}">
          <span class="nm">${L1_EMOJI[c] || ''} ${esc(n.ko)}<i>${esc(n.en)}</i></span>
          <span class="n">${num(n.tn)}편</span>
        </a>`;
      }).join('')}
    </div>`;
}

function crumbHTML(code) {
  const chain = [];
  let cur = TAX.get(code);
  while (cur) { chain.unshift(cur); cur = cur.parent ? TAX.get(cur.parent) : null; }
  const parts = [`<a href="#/browse">분류</a>`];
  for (const n of chain.slice(0, -1)) {
    parts.push(`<span class="sep">›</span><a href="#/t/${encodeURIComponent(n.code)}">${esc(n.ko)}</a>`);
  }
  return `<div class="crumb">${parts.join('')}</div>`;
}

async function vNode(code) {
  const n = TAX.get(code);
  if (!n) { $view.innerHTML = `<div class="err">분류를 찾을 수 없습니다: ${esc(code)}</div>`; return; }
  const kids = CHILDREN.get(code) || [];
  $view.innerHTML = `
    ${crumbHTML(code)}
    <div class="node-head">
      <h2>${esc(n.ko)}</h2>
      <div class="en">${esc(code)} · ${esc(n.en)}</div>
      <div class="cnt">하위 포함 ${num(n.tn)}편${n.dn ? ` · 이 노드 직접 ${num(n.dn)}편` : ''}</div>
    </div>
    ${kids.length ? `<div class="sec-title">하위 분류 ${kids.length}개</div>
    <div class="sub-list">
      ${kids.map(c => {
        const k = TAX.get(c);
        return `<a class="sub-item" href="#/t/${encodeURIComponent(c)}">
          <span class="nm">${esc(k.ko)}<i>${esc(c)} · ${esc(k.en)}</i></span>
          <span class="n">${num(k.tn)}편</span>
        </a>`;
      }).join('')}
    </div>` : ''}
    <div class="sec-title">논문 (인용순)</div>
    <div id="plist" class="paper-list"><div class="progress-note" id="pnote">인덱스 로딩 중…</div></div>`;
  const pnote = () => document.getElementById('pnote');
  try {
    await loadIndex((d, t) => { const el = pnote(); if (el) el.textContent = `인덱스 로딩 ${d}/${t}…`; });
  } catch (e) {
    const el = pnote(); if (el) el.textContent = '인덱스 로딩 실패 — 새로고침해 주세요.';
    return;
  }
  if (!location.hash.includes(encodeURIComponent(code)) && decodeURIComponent(location.hash) !== '#/t/' + code) return;
  const pref = code + '.';
  const rows = IDX.filter(r => r[4] === code || r[4].startsWith(pref));
  rows.sort((a, b) => (b[3] || 0) - (a[3] || 0));
  renderPaperRows(document.getElementById('plist'), rows);
}

function renderPaperRows(container, rows) {
  if (!container) return;
  if (!rows.length) { container.innerHTML = `<div class="hint">이 노드에 직접 배치된 논문이 없습니다.</div>`; return; }
  container.innerHTML = '';
  let shown = 0;
  const step = () => {
    const frag = document.createDocumentFragment();
    for (const r of rows.slice(shown, shown + PAGE)) {
      const div = document.createElement('div');
      div.className = 'paper-item';
      const pid = encodeURIComponent(r[0]);
      div.innerHTML = `<a class="pi-main" href="#/p/${pid}"><b>${esc(r[1])}</b>
        <div class="sub"><span>${r[2] || '—'}</span><span class="cite">인용 ${num(r[3])}</span><span>${esc(r[4])}</span></div></a>
        <a class="pi-g" href="#/g/${pid}" aria-label="그래프에서 위치 보기">🌌</a>`;
      frag.appendChild(div);
    }
    shown = Math.min(shown + PAGE, rows.length);
    container.appendChild(frag);
    const old = container.querySelector('.more-btn'); if (old) old.remove();
    if (shown < rows.length) {
      const btn = document.createElement('button');
      btn.className = 'more-btn';
      btn.textContent = `더 보기 (${num(shown)} / ${num(rows.length)})`;
      btn.onclick = step;
      container.appendChild(btn);
    }
  };
  step();
}

async function vSearch(q) {
  $view.innerHTML = `
    <form class="searchbox" id="sform">
      <input type="search" placeholder="논문 제목 검색 (한/영)" value="${esc(q)}" enterkeyhint="search">
      <button type="submit">검색</button>
    </form>
    <div id="sres">${q ? '<div class="progress-note" id="pnote">인덱스 로딩 중…</div>' : '<div class="hint">제목 일부를 입력하세요.<br>예: transformer, 양자, CRISPR, attention</div>'}</div>`;
  document.getElementById('sform').addEventListener('submit', e => {
    e.preventDefault();
    const v = e.target.querySelector('input').value.trim();
    if (v) location.hash = '#/s/' + encodeURIComponent(v);
  });
  if (!q) { document.querySelector('#sform input').focus(); return; }
  try {
    await loadIndex((d, t) => { const el = document.getElementById('pnote'); if (el) el.textContent = `인덱스 로딩 ${d}/${t}…`; });
  } catch (e) {
    const el = document.getElementById('pnote'); if (el) el.textContent = '인덱스 로딩 실패 — 새로고침해 주세요.';
    return;
  }
  const needle = q.toLowerCase();
  const hits = [];
  for (const r of IDX) {
    if (r[1].toLowerCase().includes(needle)) { hits.push(r); if (hits.length >= 2000) break; }
  }
  hits.sort((a, b) => (b[3] || 0) - (a[3] || 0));
  const res = document.getElementById('sres');
  if (!res) return;
  res.innerHTML = `<div class="sec-title">"${esc(q)}" 결과 ${num(hits.length)}건${hits.length >= 2000 ? '+' : ''}</div><div class="paper-list" id="plist"></div>`;
  renderPaperRows(document.getElementById('plist'), hits);
}

const EXPL_LABEL = { '①': '① 직관 · 비유', '②': '② 핵심 원리', '③': '③ 수식 · 도식', '④': '④ 전문용어' };

function explHTML(ex) {
  const parts = ex.split(/(?=[①②③④])/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return `<div class="body">${esc(ex)}</div>`;
  return parts.map(p => {
    const mark = p[0];
    if (EXPL_LABEL[mark]) {
      return `<div class="expl-part"><span class="pn">${EXPL_LABEL[mark]}</span><p>${esc(p.slice(1).replace(/^[\s:.·-]+/, ''))}</p></div>`;
    }
    return `<div class="expl-part"><p>${esc(p)}</p></div>`;
  }).join('');
}

async function vPaper(pid) {
  $view.innerHTML = `<div class="boot"><div class="spinner"></div><p>논문 로딩 중…</p></div>`;
  let p;
  try {
    const shard = await fetchJSON(`data/papers/p_${String(shardOf(pid)).padStart(4, '0')}.json`);
    p = shard[pid];
  } catch (e) { /* fallthrough */ }
  if (!p) { $view.innerHTML = `<div class="err">논문을 찾을 수 없습니다.<br><code>${esc(pid)}</code></div>`; return; }
  const n = TAX.get(p.l4);
  const chips = [
    p.y ? `<span class="chip">${p.y}년</span>` : '',
    `<span class="chip warn">인용 ${num(p.c)}</span>`,
    n ? `<a class="chip acc" href="#/t/${encodeURIComponent(p.l4)}">${esc(n.ko)}</a>` : `<span class="chip">${esc(p.l4)}</span>`,
  ].join('');
  const kws = (p.kw || []).filter(Boolean);
  const absKo = p.abk || '';
  const absEn = p.ab || '';
  $view.innerHTML = `
    ${n ? crumbHTML(p.l4) : ''}
    <div class="pd-title">${esc(p.t)}</div>
    <div class="pd-meta">${chips}</div>
    ${p.au ? `<div class="pd-authors">${esc(p.au)}</div>` : ''}
    <div class="pd-links">
      ${p.pl ? `<a href="${esc(p.pl)}" target="_blank" rel="noopener">📄 원문 PDF (OA)</a>` : ''}
      <a class="ghost" href="#/g/${encodeURIComponent(pid)}">🌌 그래프 위치</a>
    </div>
    ${p.ex ? `<div class="card-sec"><h3>📐 수식 · 원리 · 용어 해설</h3>${explHTML(p.ex)}
      <div class="tier-note">${p.tier === 1 ? 'AI 심층 해설 (검수 파이프라인 통과)' : '자동 생성 개요'}</div></div>` : ''}
    ${(absKo || absEn) ? `<div class="card-sec"><h3>📄 초록</h3>
      ${absKo ? `<div class="body">${esc(absKo)}</div>` : `<div class="body">${esc(absEn)}</div>`}
      ${absKo && absEn ? `<details class="abs"><summary>원문 초록 보기</summary><div class="body">${esc(absEn)}</div></details>` : ''}
    </div>` : ''}
    ${kws.length ? `<div class="card-sec"><h3>🔑 키워드</h3><div class="kw-row">${kws.map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div></div>` : ''}
    <div class="hint">paper_id: <code>${esc(pid)}</code></div>`;
}

function vAbout() {
  $view.innerHTML = `
    <div class="node-head"><h2>정보</h2></div>
    <div class="about-card">
      <h3>📚 Paper Studio Remote</h3>
      논문 분류 스튜디오의 <b>정적 스냅샷</b>입니다. 원본 PC가 꺼져 있어도
      GitHub Pages 고정 주소에서 언제든 열람할 수 있습니다.
    </div>
    <div class="about-card">
      <h3>데이터</h3>
      · 논문 ${num(META.papers)}편 / 분류 노드 ${num(META.nodes)}개 (L1–L4 계층)<br>
      · 한국어 심층 해설 커버리지 ${META.explainer_pct}%<br>
      · 스냅샷 생성: <code>${esc(META.built)}</code><br>
      · 원본: 로컬 papers_db.sqlite → JSON 샤드 export
    </div>
    <div class="about-card">
      <h3>사용 팁</h3>
      · 브라우저 메뉴에서 <b>"홈 화면에 추가"</b>를 하면 앱처럼 사용할 수 있습니다.<br>
      · 첫 검색/분류 열람 시 인덱스(약 10MB)를 내려받으며, 이후에는 캐시로 빠르게 동작합니다.<br>
      · 해설에 "(원문 확인 필요)" 표기가 있으면 DB의 분류·초록 메타데이터가 실제 저작과 다를 수 있다는 의미입니다.
    </div>`;
}

boot();
