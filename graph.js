/* Paper Studio Remote — 3D 지식그래프 뷰 (three.js r128)
   레이어: ①논문 93k 점구름(L1 색) ②분류 트리 엣지 ③분야 간 크로스레퍼런스 링크
   전역 PSRGraph.mount(container, ctx) / PSRGraph.unmount() 노출. ctx는 app.js가 주입. */
'use strict';

(function () {
  const L1_COLOR = {
    '1': 0xff6b6b, '2': 0xffd166, '3': 0xff9f43, '4': 0x4fc3f7, '5': 0x66e08a,
    '6': 0xb388ff, '7': 0xf48fb1, '8': 0x26d0a8, '9': 0xe0e0e0, '10': 0xc5e1a5,
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
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  async function mount(container, ctx, focusPid) {
    const { META, TAX, loadIndex, esc, num } = ctx;
    const me = S = { alive: true, disposables: [], raf: 0 };

    container.innerHTML = `
      <div class="g-wrap">
        <canvas id="gCanvas"></canvas>
        <div class="g-chips" id="gChips"></div>
        <div class="g-toggles">
          <button id="gTgTree" class="g-tg on">분류망</button>
          <button id="gTgX" class="g-tg on">크로스링크</button>
        </div>
        <div class="g-labels" id="gLabels"></div>
        <div class="g-card" id="gCard" hidden></div>
        <div class="g-load" id="gLoad"><div class="spinner"></div><p id="gLoadTxt">그래프 데이터 로딩…</p></div>
        <div class="g-hint">드래그 회전 · 핀치 줌 · 점 탭 = 연결 하이라이트 · 빈 곳 탭 = 해제</div>
      </div>`;

    const setLoad = t => { const el = document.getElementById('gLoadTxt'); if (el) el.textContent = t; };

    // ── 데이터 로드 ──
    let gmeta, posBuf, taxNodes, xlinks, IDX;
    try {
      [gmeta, posBuf, taxNodes, xlinks] = await Promise.all([
        fetch('data/graph/gmeta.json').then(r => r.json()),
        fetchBin('data/graph/pos.i16'),
        fetch('data/graph/tax.json').then(r => r.json()),
        fetch('data/graph/xlinks.json').then(r => r.json()),
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
    const stopAuto = () => { controls.autoRotate = false; };
    canvas.addEventListener('pointerdown', stopAuto, { once: true });
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

    // ── ② 분류 노드 + 트리 엣지 ──
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
    const eMat = new THREE.LineBasicMaterial({ color: 0x8ca0ff, transparent: true, opacity: 0.14, depthWrite: false });
    const treeLines = new THREE.LineSegments(eGeo, eMat);
    scene.add(treeLines);
    S.disposables.push(() => { eGeo.dispose(); eMat.dispose(); });

    // ── ③ 크로스레퍼런스 링크 ──
    const xp = []; const xc = [];
    const maxW = xlinks.length ? Math.log1p(xlinks[0][2]) : 1;
    for (const [a, b, w] of xlinks) {
      xp.push(tPos[a * 3], tPos[a * 3 + 1], tPos[a * 3 + 2], tPos[b * 3], tPos[b * 3 + 1], tPos[b * 3 + 2]);
      const br = 0.25 + 0.75 * (Math.log1p(w) / maxW);
      xc.push(0.31 * br, 0.85 * br, 0.77 * br, 0.31 * br, 0.85 * br, 0.77 * br);
    }
    const xGeo = new THREE.BufferGeometry();
    xGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(xp), 3));
    xGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(xc), 3));
    const xMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending });
    const xLines = new THREE.LineSegments(xGeo, xMat);
    scene.add(xLines);
    S.disposables.push(() => { xGeo.dispose(); xMat.dispose(); });

    // ── L1 라벨 오버레이 ──
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

    // ── 연결(이웃) 맵: 트리 + 크로스링크 ──
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
    const nbrX = new Map();      // taxIdx → [[taxIdx, w], ...]
    for (const [a, b, w] of xlinks) {
      if (!nbrX.has(a)) nbrX.set(a, []);
      if (!nbrX.has(b)) nbrX.set(b, []);
      nbrX.get(a).push([b, w]);
      nbrX.get(b).push([a, w]);
    }

    // ── 선택 하이라이트 ──
    let filter = null, selCode = null, selSubtree = false;
    let HL = null, hlPulse = null, hlLabels = null, labelDirty = true;

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
      eMat.opacity = on ? 0.05 : 0.14;
      xMat.opacity = on ? 0.07 : 0.28;
      tMat.uniforms.opacity.value = on ? 0.22 : 0.5;
      labelWrap.classList.toggle('g-dim', on);
    };

    const clearHL = () => {
      if (HL) for (const o of HL) { scene.remove(o); o.geometry.dispose(); sizedMats.delete(o.material); o.material.dispose(); }
      HL = null; hlPulse = null; hlLabels = null; labelDirty = true;
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

    const highlightTax = ti => {    // 선택 노드(백) + 트리 이웃(노랑) + 크로스링크 이웃(청록) + 소속 논문 유지 발광
      clearHL();
      selCode = taxNodes[ti][0]; selSubtree = true;
      recolor(); setDim(true);
      const sel = txyz(ti);
      const tN = [...(nbrTree.get(ti) || [])];
      const xN = nbrX.get(ti) || [];
      const tE = [], tP = [], tS = [], xE = [], xP = [], xS = [];
      for (const j of tN) { tE.push(...sel, ...txyz(j)); tP.push(...txyz(j)); tS.push(tSize[j] * 1.3); }
      for (const [j] of xN) { xE.push(...sel, ...txyz(j)); xP.push(...txyz(j)); xS.push(tSize[j] * 1.25); }
      HL = [];
      if (tE.length) HL.push(mkLines(tE, 0xffd166, 0.85), mkPts(tP, tS, 0xffd166, 0.9));
      if (xE.length) HL.push(mkLines(xE, 0x4fd8c4, 0.85), mkPts(xP, xS, 0x4fd8c4, 0.9));
      const selPt = mkPts(sel, Math.max(18, tSize[ti] * 1.6), 0xffffff, 1);
      HL.push(selPt);
      hlPulse = { mat: selPt.material };
      hlLabels = [ti, ...tN, ...xN.map(x => x[0])].slice(0, 40);
      labelDirty = true;
      return { tree: tN.length, x: xN.length };
    };

    const highlightPaper = pi => {  // 논문(백) → 소속 분류(주황 엣지) → 그 분류의 연결망(옅게)
      clearHL();
      const l4 = IDX[pi][4];
      const ti = taxIdx.get(l4);
      selCode = l4; selSubtree = false;
      recolor(); setDim(true);
      const pp = [pos[pi * 3], pos[pi * 3 + 1], pos[pi * 3 + 2]];
      HL = [];
      let counts = { tree: 0, x: 0 };
      if (ti !== undefined) {
        const home = txyz(ti);
        HL.push(mkLines([...pp, ...home], 0xff9f43, 0.9), mkPts(home, Math.max(16, tSize[ti] * 1.5), 0xff9f43, 0.95));
        const tN = [...(nbrTree.get(ti) || [])];
        const xN = nbrX.get(ti) || [];
        const tE = [], tP = [], tS = [], xE = [], xP = [], xS = [];
        for (const j of tN) { tE.push(...home, ...txyz(j)); tP.push(...txyz(j)); tS.push(tSize[j] * 1.15); }
        for (const [j] of xN) { xE.push(...home, ...txyz(j)); xP.push(...txyz(j)); xS.push(tSize[j] * 1.1); }
        if (tE.length) HL.push(mkLines(tE, 0xffd166, 0.5), mkPts(tP, tS, 0xffd166, 0.6));
        if (xE.length) HL.push(mkLines(xE, 0x4fd8c4, 0.5), mkPts(xP, xS, 0x4fd8c4, 0.6));
        counts = { tree: tN.length, x: xN.length };
        hlLabels = [ti, ...tN, ...xN.map(x => x[0])].slice(0, 40);
        labelDirty = true;
      }
      const selPt = mkPts(pp, 16, 0xffffff, 1);
      HL.push(selPt);
      hlPulse = { mat: selPt.material };
      return counts;
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
    tgTree.onclick = () => { treeLines.visible = !treeLines.visible; taxPoints.visible = treeLines.visible; tgTree.classList.toggle('on', treeLines.visible); };
    tgX.onclick = () => { xLines.visible = !xLines.visible; tgX.classList.toggle('on', xLines.visible); };

    // ── 픽킹 + 선택 ──
    const card = document.getElementById('gCard');
    const hideCard = () => { card.hidden = true; };
    const selectTax = ti => {
      const row = taxNodes[ti];
      const n = TAX.get(row[0]);
      if (!n) return;
      const c = highlightTax(ti);
      card.innerHTML = `<div class="g-card-k">분류 노드 — 연결 하이라이트</div><b>${esc(n.ko)}</b>
        <div class="g-card-m">${esc(row[0])} · 하위 포함 ${num(n.tn)}편 ·
          <span class="g-ct">트리 ${c.tree}</span> <span class="g-cx">크로스링크 ${c.x}</span></div>
        <a class="g-card-btn" href="#/t/${encodeURIComponent(row[0])}">분류 열기 →</a>`;
      card.hidden = false;
    };
    const selectPaper = pi => {
      const row = IDX[pi];
      const n = TAX.get(row[4]);
      const c = highlightPaper(pi);
      card.innerHTML = `<div class="g-card-k">논문 — 소속 분야 연결 하이라이트</div><b>${esc(row[1])}</b>
        <div class="g-card-m">${row[2] || '—'} · 인용 ${num(row[3])}${n ? ' · ' + esc(n.ko) : ''} ·
          <span class="g-ct">트리 ${c.tree}</span> <span class="g-cx">크로스링크 ${c.x}</span></div>
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
      // 분류 노드 우선 (크고 적음), 그다음 논문
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

    // ── 줌 적응형 노드명 라벨: 겉보기 크기(px) 상위 노드만, 선택 중엔 연결 노드 우선 ──
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
