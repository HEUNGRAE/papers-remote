/* Paper Studio Remote — 3D 지식그래프 뷰 (three.js r128)
   레이어: ①논문 93k 점구름(L1 색) ②분류 노드(크기∝편수) ③관계 엣지 풀
   관계 정의(REL): hier 계층(상·하위) / xref 융합 참조 / wref 인접 참조 / member 소속
   — data/graph/edges.json의 방향 가중치([a,b,w_ab,w_ba]) 기반, 선택 시 엣지에 관계 라벨 표시.
   전역 PSRGraph.mount(container, ctx, focusPid) / PSRGraph.unmount() 노출. ctx는 app.js가 주입. */
'use strict';

(function () {
  const L1_COLOR = {
    '1': 0xff6b6b, '2': 0xffd166, '3': 0xff9f43, '4': 0x4fc3f7, '5': 0x66e08a,
    '6': 0xb388ff, '7': 0xf48fb1, '8': 0x26d0a8, '9': 0xe0e0e0, '10': 0xc5e1a5,
  };
  // 노드 간 관계 체계 — export의 edges.json types와 동기 유지
  const REL = {
    hier:   { hex: 0xffd166, css: '#ffd166', ko: '계층' },
    xref:   { hex: 0x4fd8c4, css: '#4fd8c4', ko: '융합' },
    wref:   { hex: 0xb388ff, css: '#b388ff', ko: '인접' },
    member: { hex: 0xff9f43, css: '#ff9f43', ko: '소속' },
  };
  const DIM = 0.07; // 필터 제외 점 밝기 배율

  let S = null; // 세션 상태 (mount마다 새로)

  async function fetchBin(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return r.arrayBuffer();
  }

  function circleSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  async function mount(container, ctx, focusPid) {
    const { META, TAX, loadIndex, esc, num } = ctx;
    const me = S = { alive: true, disposables: [], raf: 0 };

    container.innerHTML = `
      <div class="g-wrap">
        <canvas id="gCanvas"></canvas>
        <div class="g-chips" id="gChips"></div>
        <div class="g-toggles">
          <button id="gTgTree" class="g-tg on" style="--tc:${REL.hier.css}">계층</button>
          <button id="gTgX" class="g-tg on" style="--tc:${REL.xref.css}">융합</button>
          <button id="gTgW" class="g-tg on" style="--tc:${REL.wref.css}">인접</button>
        </div>
        <div class="g-labels" id="gLabels"></div>
        <div class="g-card" id="gCard" hidden></div>
        <div class="g-load" id="gLoad"><div class="spinner"></div><p id="gLoadTxt">그래프 데이터 로딩…</p></div>
        <div class="g-hint">드래그 회전 · 핀치 줌 · 점 탭 = 관계 하이라이트 · 빈 곳 탭 = 해제</div>
      </div>`;

    const setLoad = t => { const el = document.getElementById('gLoadTxt'); if (el) el.textContent = t; };

    // ── 데이터 로드 ──
    let gmeta, posBuf, taxNodes, EDGES, IDX;
    try {
      [gmeta, posBuf, taxNodes, EDGES] = await Promise.all([
        fetch('data/graph/gmeta.json').then(r => r.json()),
        fetchBin('data/graph/pos.i16'),
        fetch('data/graph/tax.json').then(r => r.json()),
        fetch('data/graph/edges.json').then(r => r.json()),
      ]);
      setLoad('논문 인덱스 로딩…');
      IDX = await loadIndex((d, t) => setLoad(`논문 인덱스 ${d}/${t}…`));
    } catch (e) {
      setLoad('로딩 실패 — 새로고침해 주세요');
      return;
    }
    if (S !== me || !me.alive) return;
    const N = gmeta.papers;
    const i16 = new Int16Array(posBuf);
    const inv = 1 / gmeta.scale;

    // ── three 셋업 ──
    const canvas = document.getElementById('gCanvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, 1, 1, 30000);
    camera.position.set(0, 700, 2500);
    const controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controls.minDistance = 60;
    controls.maxDistance = 9000;
    canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; }, { once: true });
    S.disposables.push(() => controls.dispose());

    const sprite = circleSprite();

    // ── ① 논문 점구름 ──
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pos[i] = i16[i] * inv;
    const baseCol = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const l1Of = new Array(N);
    const tmp = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const l4 = IDX[i][4];
      const l1 = l4.slice(0, l4.indexOf('.') > 0 ? l4.indexOf('.') : l4.length);
      l1Of[i] = l1;
      tmp.setHex(L1_COLOR[l1] ?? 0x8899ff);
      baseCol[i * 3] = tmp.r; baseCol[i * 3 + 1] = tmp.g; baseCol[i * 3 + 2] = tmp.b;
    }
    col.set(baseCol);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pMat = new THREE.PointsMaterial({
      size: 3.2, map: sprite, vertexColors: true, transparent: true, opacity: 0.85,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const points = new THREE.Points(pGeo, pMat);
    scene.add(points);
    S.disposables.push(() => { pGeo.dispose(); pMat.dispose(); sprite.dispose(); });

    // ── per-point 크기 셰이더 (노드 크기 ∝ 편수) ──
    const sizedMats = new Set();
    let uScaleVal = 400;
    const sizedMat = (hex, op) => {
      const m = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: sprite },
          color: { value: new THREE.Color(hex) },
          opacity: { value: op },
          uMul: { value: 1 },
          uScale: { value: uScaleVal },
        },
        vertexShader: `
          attribute float size;
          uniform float uScale, uMul;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * uMul * uScale / max(1.0, -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform sampler2D map;
          uniform vec3 color;
          uniform float opacity;
          void main() {
            vec4 t = texture2D(map, gl_PointCoord);
            gl_FragColor = vec4(color * t.rgb, opacity * t.a);
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      sizedMats.add(m);
      return m;
    };

    // ── ② 분류 노드 + 계층 엣지 ──
    const taxIdx = new Map(taxNodes.map((r, i) => [r[0], i]));
    const tPos = new Float32Array(taxNodes.length * 3);
    taxNodes.forEach((r, i) => { tPos[i * 3] = r[1]; tPos[i * 3 + 1] = r[2]; tPos[i * 3 + 2] = r[3]; });
    const tSize = new Float32Array(taxNodes.length);       // 크기 = 4 + 2.2·log₂(편수), 5~36 클램프
    taxNodes.forEach((r, i) => {
      const tn = (TAX.get(r[0]) || {}).tn || 1;
      tSize[i] = Math.min(36, Math.max(5, 4 + 2.2 * Math.log2(tn + 1)));
    });
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    tGeo.setAttribute('size', new THREE.BufferAttribute(tSize, 1));
    const tMat = sizedMat(0xffffff, 0.5);
    const taxPoints = new THREE.Points(tGeo, tMat);
    scene.add(taxPoints);
    S.disposables.push(() => { tGeo.dispose(); tMat.dispose(); });

    const segs = [];
    for (const [code] of taxNodes) {
      const n = TAX.get(code);
      if (!n || !n.parent) continue;
      const pi = taxIdx.get(n.parent), ci = taxIdx.get(code);
      if (pi === undefined) continue;
      segs.push(tPos[pi * 3], tPos[pi * 3 + 1], tPos[pi * 3 + 2], tPos[ci * 3], tPos[ci * 3 + 1], tPos[ci * 3 + 2]);
    }
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
    const eMat = new THREE.LineBasicMaterial({ color: REL.hier.hex, transparent: true, opacity: 0.1, depthWrite: false });
    const treeLines = new THREE.LineSegments(eGeo, eMat);
    scene.add(treeLines);
    S.disposables.push(() => { eGeo.dispose(); eMat.dispose(); });

    // ── ③ 관계 풀 레이어 (융합 xref / 인접 wref) ──
    const mkPoolLines = (pool, hex, op) => {
      const P = [], C = [];
      const c0 = new THREE.Color(hex);
      const maxW = pool.length ? Math.log1p(pool[0][2] + pool[0][3]) : 1;   // export가 총가중치 desc 정렬
      for (const [a, b, wab, wba] of pool) {
        P.push(tPos[a * 3], tPos[a * 3 + 1], tPos[a * 3 + 2], tPos[b * 3], tPos[b * 3 + 1], tPos[b * 3 + 2]);
        const br = 0.25 + 0.75 * (Math.log1p(wab + wba) / maxW);
        C.push(c0.r * br, c0.g * br, c0.b * br, c0.r * br, c0.g * br, c0.b * br);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
      const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending });
      const o = new THREE.LineSegments(g, m);
      scene.add(o);
      S.disposables.push(() => { g.dispose(); m.dispose(); });
      return o;
    };
    const xLines = mkPoolLines(EDGES.xref, REL.xref.hex, 0.26);
    const wLines = mkPoolLines(EDGES.wref, REL.wref.hex, 0.18);
    const xMat = xLines.material, wMat = wLines.material;

    // ── L1 라벨 + 라벨 풀 ──
    const labelWrap = document.getElementById('gLabels');
    const l1s = [...TAX.values()].filter(n => n.level === 1).sort((a, b) => parseInt(a.code) - parseInt(b.code));
    const labels = l1s.map(n => {
      const i = taxIdx.get(n.code);
      const el = document.createElement('div');
      el.className = 'g-l1';
      el.textContent = n.ko;
      el.style.color = '#' + (L1_COLOR[n.code] ?? 0xffffff).toString(16).padStart(6, '0');
      labelWrap.appendChild(el);
      return { el, v: i === undefined ? null : new THREE.Vector3(tPos[i * 3], tPos[i * 3 + 1], tPos[i * 3 + 2]) };
    });
    const nlPool = Array.from({ length: 36 }, () => {   // 줌 적응형 노드명 라벨 풀 (L2~L4)
      const el = document.createElement('div');
      el.className = 'g-nl';
      el.style.display = 'none';
      labelWrap.appendChild(el);
      return el;
    });
    const elPool = Array.from({ length: 28 }, () => {   // 활성 엣지 관계 라벨 풀
      const el = document.createElement('div');
      el.className = 'g-el';
      el.style.display = 'none';
      labelWrap.appendChild(el);
      return el;
    });

    // ── 연결(이웃) 맵: 계층 + 관계 풀 ──
    const nbrTree = new Map();   // taxIdx → Set(taxIdx)
    const addT = (a, b) => {
      if (!nbrTree.has(a)) nbrTree.set(a, new Set());
      nbrTree.get(a).add(b);
    };
    for (const [code] of taxNodes) {
      const n = TAX.get(code);
      if (!n || !n.parent) continue;
      const pi = taxIdx.get(n.parent), ci = taxIdx.get(code);
      if (pi === undefined) continue;
      addT(pi, ci); addT(ci, pi);
    }
    const nbrEdges = new Map();  // taxIdx → [{j, type, out, inn, tot}]  out = 이 노드 → j 참조 가중치
    const addE = (i, j, type, out, inn) => {
      if (!nbrEdges.has(i)) nbrEdges.set(i, []);
      nbrEdges.get(i).push({ j, type, out, inn, tot: out + inn });
    };
    for (const type of ['xref', 'wref']) {
      for (const [a, b, wab, wba] of EDGES[type]) {
        addE(a, b, type, wab, wba);
        addE(b, a, type, wba, wab);
      }
    }

    // ── 선택 하이라이트 ──
    let filter = null, selCode = null, selSubtree = false;
    let HL = null, hlPulse = null, hlLabels = null, hlEdgeLabels = null, labelDirty = true;

    const recolor = () => {
      const pre = selCode ? selCode + '.' : null;
      for (let i = 0; i < N; i++) {
        let f = (!filter || l1Of[i] === filter) ? 1 : DIM;
        if (selCode) {
          const l4 = IDX[i][4];
          f *= (l4 === selCode || (selSubtree && l4.startsWith(pre))) ? 1 : 0.1;
        }
        col[i * 3] = baseCol[i * 3] * f;
        col[i * 3 + 1] = baseCol[i * 3 + 1] * f;
        col[i * 3 + 2] = baseCol[i * 3 + 2] * f;
      }
      pGeo.attributes.color.needsUpdate = true;
    };

    const setDim = on => {          // 선택 중엔 배경 레이어를 가라앉혀 하이라이트 대비 확보
      eMat.opacity = on ? 0.04 : 0.1;
      xMat.opacity = on ? 0.06 : 0.26;
      wMat.opacity = on ? 0.05 : 0.18;
      tMat.uniforms.opacity.value = on ? 0.22 : 0.5;
      labelWrap.classList.toggle('g-dim', on);
    };

    const clearHL = () => {
      if (HL) for (const o of HL) { scene.remove(o); o.geometry.dispose(); sizedMats.delete(o.material); o.material.dispose(); }
      HL = null; hlPulse = null; hlLabels = null; hlEdgeLabels = null; labelDirty = true;
      if (selCode) { selCode = null; selSubtree = false; recolor(); }
      setDim(false);
    };
    S.disposables.push(clearHL);

    const mkPts = (arr, sizes, hex, op) => {   // sizes: number(전체 동일) 또는 per-point 배열
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
      const n = arr.length / 3;
      const sz = typeof sizes === 'number' ? new Float32Array(n).fill(sizes) : new Float32Array(sizes);
      g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
      const o = new THREE.Points(g, sizedMat(hex, op)); o.renderOrder = 3; scene.add(o); return o;
    };
    const mkLines = (arr, hex, op) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
      const m = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending });
      const o = new THREE.LineSegments(g, m); o.renderOrder = 2; scene.add(o); return o;
    };
    const txyz = i => [tPos[i * 3], tPos[i * 3 + 1], tPos[i * 3 + 2]];
    const midOf = (A, B) => [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    const relText = e => {          // 방향: → 내가 참조 / ← 참조받음 / ↔ 쌍방
      const ko = REL[e.type].ko;
      return e.out && e.inn ? `${ko} ↔${e.out + e.inn}` : e.out ? `${ko} →${e.out}` : `${ko} ←${e.inn}`;
    };

    // 노드 origin 기준: 계층(상·하위) + 관계 풀 엣지·마커·라벨 생성. faint=논문 선택 시 2차 연결용.
    const buildNodeLinks = (ti, origin, faint) => {
      const node = TAX.get(taxNodes[ti][0]);
      const pIdx = node && node.parent ? taxIdx.get(node.parent) : undefined;
      const kids = [...(nbrTree.get(ti) || [])].filter(j => j !== pIdx);
      const typed = (nbrEdges.get(ti) || []).slice().sort((a, b) => b.tot - a.tot);
      const opL = faint ? 0.5 : 0.85, opP = faint ? 0.6 : 0.9, szF = faint ? 1.12 : 1.3;
      const labelCap = faint ? 6 : 14;
      const hE = [], hP = [], hS = [];
      const pushHier = (j, lbl) => {
        const T = txyz(j);
        hE.push(...origin, ...T); hP.push(...T); hS.push(tSize[j] * szF);
        const m = midOf(origin, T);
        hlEdgeLabels.push({ x: m[0], y: m[1], z: m[2], t: lbl, c: REL.hier.css });
      };
      if (pIdx !== undefined) pushHier(pIdx, '상위');
      for (const j of kids) pushHier(j, '하위');
      if (hE.length) HL.push(mkLines(hE, REL.hier.hex, opL), mkPts(hP, hS, REL.hier.hex, opP));
      const grp = { xref: { E: [], P: [], Sz: [] }, wref: { E: [], P: [], Sz: [] } };
      typed.forEach((e, rank) => {
        const T = txyz(e.j);
        const g = grp[e.type];
        g.E.push(...origin, ...T); g.P.push(...T); g.Sz.push(tSize[e.j] * (szF - 0.05));
        if (rank < labelCap) {
          const m = midOf(origin, T);
          hlEdgeLabels.push({ x: m[0], y: m[1], z: m[2], t: relText(e), c: REL[e.type].css });
        }
      });
      for (const k of ['xref', 'wref']) {
        const g = grp[k];
        if (g.E.length) HL.push(mkLines(g.E, REL[k].hex, opL), mkPts(g.P, g.Sz, REL[k].hex, opP));
      }
      return {
        nbrs: [...(pIdx !== undefined ? [pIdx] : []), ...kids, ...typed.map(e => e.j)],
        hier: (pIdx !== undefined ? 1 : 0) + kids.length,
        x: typed.filter(e => e.type === 'xref').length,
        w: typed.filter(e => e.type === 'wref').length,
      };
    };

    const highlightTax = ti => {
      clearHL();
      selCode = taxNodes[ti][0]; selSubtree = true;
      recolor(); setDim(true);
      HL = []; hlEdgeLabels = [];
      const sel = txyz(ti);
      const r = buildNodeLinks(ti, sel, false);
      const selPt = mkPts(sel, Math.max(18, tSize[ti] * 1.6), 0xffffff, 1);
      HL.push(selPt);
      hlPulse = { mat: selPt.material };
      hlLabels = [ti, ...r.nbrs].slice(0, 40);
      labelDirty = true;
      return r;
    };

    const highlightPaper = pi => {  // 논문(백) —소속(주황)→ 분류, 그 분류의 관계망은 옅게
      clearHL();
      const l4 = IDX[pi][4];
      const ti = taxIdx.get(l4);
      selCode = l4; selSubtree = false;
      recolor(); setDim(true);
      const pp = [pos[pi * 3], pos[pi * 3 + 1], pos[pi * 3 + 2]];
      HL = []; hlEdgeLabels = [];
      let r = { hier: 0, x: 0, w: 0 };
      if (ti !== undefined) {
        const home = txyz(ti);
        HL.push(mkLines([...pp, ...home], REL.member.hex, 0.9), mkPts(home, Math.max(16, tSize[ti] * 1.5), REL.member.hex, 0.95));
        const m = midOf(pp, home);
        hlEdgeLabels.push({ x: m[0], y: m[1], z: m[2], t: REL.member.ko, c: REL.member.css });
        r = buildNodeLinks(ti, home, true);
        hlLabels = [ti, ...r.nbrs].slice(0, 40);
      }
      const selPt = mkPts(pp, 16, 0xffffff, 1);
      HL.push(selPt);
      hlPulse = { mat: selPt.material };
      labelDirty = true;
      return r;
    };

    // ── 필터/토글 ──
    const chips = document.getElementById('gChips');
    chips.innerHTML = `<button class="g-chip on" data-l1="">전체</button>` +
      l1s.map(n => `<button class="g-chip" data-l1="${n.code}" style="--cc:#${(L1_COLOR[n.code] ?? 0xffffff).toString(16).padStart(6, '0')}">${esc(n.ko)}</button>`).join('');
    chips.addEventListener('click', e => {
      const b = e.target.closest('.g-chip');
      if (!b) return;
      filter = b.dataset.l1 || null;
      chips.querySelectorAll('.g-chip').forEach(x => x.classList.toggle('on', x === b));
      clearHL();
      recolor();
      hideCard();
    });
    const tgTree = document.getElementById('gTgTree');
    const tgX = document.getElementById('gTgX');
    const tgW = document.getElementById('gTgW');
    tgTree.onclick = () => { treeLines.visible = !treeLines.visible; taxPoints.visible = treeLines.visible; tgTree.classList.toggle('on', treeLines.visible); };
    tgX.onclick = () => { xLines.visible = !xLines.visible; tgX.classList.toggle('on', xLines.visible); };
    tgW.onclick = () => { wLines.visible = !wLines.visible; tgW.classList.toggle('on', wLines.visible); };

    // ── 픽킹 + 선택 ──
    const card = document.getElementById('gCard');
    const hideCard = () => { card.hidden = true; };
    const countsHTML = r =>
      `<span class="g-ch">계층 ${r.hier}</span> <span class="g-cx">융합 ${r.x}</span> <span class="g-cw">인접 ${r.w}</span>`;
    const selectTax = ti => {
      const row = taxNodes[ti];
      const n = TAX.get(row[0]);
      if (!n) return;
      const r = highlightTax(ti);
      card.innerHTML = `<div class="g-card-k">분류 노드 — 관계 하이라이트</div><b>${esc(n.ko)}</b>
        <div class="g-card-m">${esc(row[0])} · 하위 포함 ${num(n.tn)}편 · ${countsHTML(r)}</div>
        <a class="g-card-btn" href="#/t/${encodeURIComponent(row[0])}">분류 열기 →</a>`;
      card.hidden = false;
    };
    const selectPaper = pi => {
      const row = IDX[pi];
      const n = TAX.get(row[4]);
      const r = highlightPaper(pi);
      card.innerHTML = `<div class="g-card-k">논문 — 소속 분류의 관계 하이라이트</div><b>${esc(row[1])}</b>
        <div class="g-card-m">${row[2] || '—'} · 인용 ${num(row[3])}${n ? ' · ' + esc(n.ko) : ''} · ${countsHTML(r)}</div>
        <a class="g-card-btn" href="#/p/${encodeURIComponent(row[0])}">상세 보기 →</a>`;
      card.hidden = false;
    };

    // 카메라 플라이투 (smoothstep, 사용자 터치 시 취소)
    let fly = null;
    const flyTo = (target, dist) => {
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
      if (!dir.lengthSq()) dir.set(0, 0.3, 1).normalize();
      fly = {
        t0: performance.now(), dur: 1400,
        p0: camera.position.clone(), q0: controls.target.clone(),
        p1: target.clone().add(dir.multiplyScalar(dist)), q1: target.clone(),
      };
    };

    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: 9 };
    const ndc = new THREE.Vector2();
    let downXY = null;
    canvas.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; fly = null; });
    canvas.addEventListener('pointerup', e => {
      if (!downXY) return;
      const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
      downXY = null;
      if (moved > 8) return;
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const ht = ray.intersectObject(taxPoints, false);
      if (ht.length && taxPoints.visible && TAX.get(taxNodes[ht[0].index][0])) {
        selectTax(ht[0].index);
        return;
      }
      const hp = ray.intersectObject(points, false)
        .filter(h => !filter || l1Of[h.index] === filter)
        .sort((a, b) => a.distanceToRay - b.distanceToRay);
      if (hp.length) {
        selectPaper(hp[0].index);
        return;
      }
      clearHL();
      hideCard();
    });

    // ── 줌 적응형 노드명 라벨 + 활성 엣지 관계 라벨 ──
    let lastLbl = 0;
    const nv = new THREE.Vector3();
    const updateLabels = () => {
      const r = canvas.getBoundingClientRect();
      if (!r.height) return;
      const halfH = r.height * 0.5;
      const pre = filter ? filter + '.' : null;
      const cand = [];
      const consider = (i, force) => {
        const code = taxNodes[i][0];
        const n = TAX.get(code);
        if (!n || n.level < 2) return;                    // L1은 상시 라벨이 따로 있음
        if (!force && filter && !(code === filter || code.startsWith(pre))) return;
        nv.set(tPos[i * 3], tPos[i * 3 + 1], tPos[i * 3 + 2]);
        const px = tSize[i] * halfH / camera.position.distanceTo(nv);
        if (!force && px < 11) return;                    // 줌인해서 커 보일 때만
        nv.project(camera);
        if (nv.z > 1 || nv.x < -1.05 || nv.x > 1.05 || nv.y < -1.05 || nv.y > 1.05) return;
        cand.push({ n, px, sx: (nv.x + 1) / 2 * r.width, sy: (-nv.y + 1) / 2 * r.height });
      };
      if (hlLabels) for (const i of hlLabels) consider(i, true);
      else for (let i = 0; i < taxNodes.length; i++) consider(i, false);
      cand.sort((a, b) => b.px - a.px);
      const used = new Set();
      let k = 0;
      for (const c of cand) {                             // 화면 격자당 1개로 겹침 방지
        if (k >= nlPool.length) break;
        const cell = ((c.sx / 92) | 0) + ':' + ((c.sy / 44) | 0);
        if (used.has(cell)) continue;
        used.add(cell);
        const el = nlPool[k++];
        el.textContent = c.n.ko;
        el.dataset.lv = c.n.level;
        el.style.display = '';
        el.style.transform = `translate(${c.sx}px, ${c.sy}px) translate(-50%, -145%)`;
      }
      for (; k < nlPool.length; k++) nlPool[k].style.display = 'none';
      // 활성 엣지 관계 라벨 (선택 중에만)
      let ek = 0;
      if (hlEdgeLabels) {
        const eus = new Set();
        for (const L of hlEdgeLabels) {
          if (ek >= elPool.length) break;
          nv.set(L.x, L.y, L.z).project(camera);
          if (nv.z > 1 || nv.x < -1.02 || nv.x > 1.02 || nv.y < -1.02 || nv.y > 1.02) continue;
          const sx = (nv.x + 1) / 2 * r.width, sy = (-nv.y + 1) / 2 * r.height;
          const cell = ((sx / 72) | 0) + ':' + ((sy / 28) | 0);
          if (eus.has(cell)) continue;
          eus.add(cell);
          const el = elPool[ek++];
          el.textContent = L.t;
          el.style.color = L.c;
          el.style.display = '';
          el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
        }
      }
      for (; ek < elPool.length; ek++) elPool[ek].style.display = 'none';
    };

    // ── 리사이즈/루프 ──
    const wrap = container.querySelector('.g-wrap');
    const resize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      uScaleVal = h * renderer.getPixelRatio() * 0.5;   // gl_PointSize 감쇠 기준 (물리 px)
      for (const m of sizedMats) m.uniforms.uScale.value = uScaleVal;
    };
    resize();
    window.addEventListener('resize', resize);
    S.disposables.push(() => window.removeEventListener('resize', resize));

    const v3 = new THREE.Vector3();
    const tick = () => {
      if (S !== me || !me.alive) return;
      me.raf = requestAnimationFrame(tick);
      if (fly) {
        const k = Math.min(1, (performance.now() - fly.t0) / fly.dur);
        const e = k * k * (3 - 2 * k);
        camera.position.lerpVectors(fly.p0, fly.p1, e);
        controls.target.lerpVectors(fly.q0, fly.q1, e);
        if (k >= 1) fly = null;
      }
      controls.update();
      if (hlPulse) hlPulse.mat.uniforms.uMul.value = 1 + 0.22 * Math.sin(performance.now() * 0.005);
      renderer.render(scene, camera);
      const r = canvas.getBoundingClientRect();
      for (const { el, v } of labels) {
        if (!v) { el.style.display = 'none'; continue; }
        v3.copy(v).project(camera);
        if (v3.z > 1) { el.style.display = 'none'; continue; }
        el.style.display = '';
        el.style.transform = `translate(${((v3.x + 1) / 2) * r.width}px, ${((-v3.y + 1) / 2) * r.height}px)`;
      }
      const now = performance.now();
      if (labelDirty || now - lastLbl > 170) { lastLbl = now; labelDirty = false; updateLabels(); }
    };

    const loadEl = document.getElementById('gLoad');
    if (loadEl) loadEl.remove();
    me.renderer = renderer;
    tick();

    // ── 리스트/상세에서 넘어온 논문 포커스 (#/g/<pid>) ──
    if (focusPid) {
      const pi = IDX.findIndex(r => r[0] === focusPid);
      if (pi >= 0) {
        controls.autoRotate = false;
        selectPaper(pi);
        flyTo(new THREE.Vector3(pos[pi * 3], pos[pi * 3 + 1], pos[pi * 3 + 2]), 280);
      }
    }
  }

  function unmount() {
    if (!S) return;
    S.alive = false;
    cancelAnimationFrame(S.raf);
    for (const d of S.disposables) { try { d(); } catch (_) {} }
    if (S.renderer) { try { S.renderer.dispose(); } catch (_) {} }
    S = null;
  }

  window.PSRGraph = { mount, unmount };
})();
