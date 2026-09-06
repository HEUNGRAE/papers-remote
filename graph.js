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

  async function mount(container, ctx) {
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
        <div class="g-hint">드래그 회전 · 핀치 줌 · 점 탭 = 상세</div>
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

    // ── ② 분류 노드 + 트리 엣지 ──
    const taxIdx = new Map(taxNodes.map((r, i) => [r[0], i]));
    const tPos = new Float32Array(taxNodes.length * 3);
    taxNodes.forEach((r, i) => { tPos[i * 3] = r[1]; tPos[i * 3 + 1] = r[2]; tPos[i * 3 + 2] = r[3]; });
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    const tMat = new THREE.PointsMaterial({
      size: 9, map: sprite, color: 0xffffff, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
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

    // ── 필터/토글 ──
    let filter = null;
    const chips = document.getElementById('gChips');
    chips.innerHTML = `<button class="g-chip on" data-l1="">전체</button>` +
      l1s.map(n => `<button class="g-chip" data-l1="${n.code}" style="--cc:#${(L1_COLOR[n.code] ?? 0xffffff).toString(16).padStart(6, '0')}">${esc(n.ko)}</button>`).join('');
    chips.addEventListener('click', e => {
      const b = e.target.closest('.g-chip');
      if (!b) return;
      filter = b.dataset.l1 || null;
      chips.querySelectorAll('.g-chip').forEach(x => x.classList.toggle('on', x === b));
      for (let i = 0; i < N; i++) {
        const on = !filter || l1Of[i] === filter;
        const f = on ? 1 : DIM;
        col[i * 3] = baseCol[i * 3] * f;
        col[i * 3 + 1] = baseCol[i * 3 + 1] * f;
        col[i * 3 + 2] = baseCol[i * 3 + 2] * f;
      }
      pGeo.attributes.color.needsUpdate = true;
      hideCard();
    });
    const tgTree = document.getElementById('gTgTree');
    const tgX = document.getElementById('gTgX');
    tgTree.onclick = () => { treeLines.visible = !treeLines.visible; taxPoints.visible = treeLines.visible; tgTree.classList.toggle('on', treeLines.visible); };
    tgX.onclick = () => { xLines.visible = !xLines.visible; tgX.classList.toggle('on', xLines.visible); };

    // ── 픽킹 ──
    const card = document.getElementById('gCard');
    const hideCard = () => { card.hidden = true; };
    const ray = new THREE.Raycaster();
    ray.params.Points = { threshold: 9 };
    const ndc = new THREE.Vector2();
    let downXY = null;
    canvas.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
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
      if (ht.length && taxPoints.visible) {
        const row = taxNodes[ht[0].index];
        const n = TAX.get(row[0]);
        if (n) {
          card.innerHTML = `<div class="g-card-k">분류 노드</div><b>${esc(n.ko)}</b>
            <div class="g-card-m">${esc(row[0])} · 하위 포함 ${num(n.tn)}편</div>
            <a class="g-card-btn" href="#/t/${encodeURIComponent(row[0])}">분류 열기 →</a>`;
          card.hidden = false;
          return;
        }
      }
      const hp = ray.intersectObject(points, false)
        .filter(h => !filter || l1Of[h.index] === filter)
        .sort((a, b) => a.distanceToRay - b.distanceToRay);
      if (hp.length) {
        const row = IDX[hp[0].index];
        const n = TAX.get(row[4]);
        card.innerHTML = `<div class="g-card-k">논문</div><b>${esc(row[1])}</b>
          <div class="g-card-m">${row[2] || '—'} · 인용 ${num(row[3])}${n ? ' · ' + esc(n.ko) : ''}</div>
          <a class="g-card-btn" href="#/p/${encodeURIComponent(row[0])}">상세 보기 →</a>`;
        card.hidden = false;
        return;
      }
      hideCard();
    });

    // ── 리사이즈/루프 ──
    const wrap = container.querySelector('.g-wrap');
    const resize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);
    S.disposables.push(() => window.removeEventListener('resize', resize));

    const v3 = new THREE.Vector3();
    const tick = () => {
      if (S !== me || !me.alive) return;
      me.raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
      const r = canvas.getBoundingClientRect();
      for (const { el, v } of labels) {
        if (!v) { el.style.display = 'none'; continue; }
        v3.copy(v).project(camera);
        if (v3.z > 1) { el.style.display = 'none'; continue; }
        el.style.display = '';
        el.style.transform = `translate(${((v3.x + 1) / 2) * r.width}px, ${((-v3.y + 1) / 2) * r.height}px)`;
      }
    };

    const loadEl = document.getElementById('gLoad');
    if (loadEl) loadEl.remove();
    me.renderer = renderer;
    tick();
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
