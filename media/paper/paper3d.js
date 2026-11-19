/* Real paper crumple: a Blender cloth simulation (baked vertex positions) textured with a
   snapshot of the current screen, rendered with three.js. Falls back silently if anything fails. */
(function(){
  const BASE = 'media/paper/';
  const LIBS = ['https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'];
  const SIMS = {land: null, port: null};
  let ready = null;

  const loadScript = src => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s);
  });
  async function loadSim(name){
    const meta = await (await fetch(BASE + name + '.json')).json();
    const buf = await (await fetch(BASE + name + '.bin')).arrayBuffer();
    const n = meta.verts * 3, frames = [];
    for (let f = 0; f < meta.frames; f++){
      const q = new Int16Array(buf, f * n * 2, n), p = new Float32Array(n);
      for (let i = 0; i < n; i++) p[i] = q[i] * meta.scale;
      frames.push(p);
    }
    for (let i = 2; i < n; i += 3) frames[0][i] = 0;   // the flat sheet lies exactly in the screen plane
    const idx = new Uint16Array(buf, meta.frames * n * 2, meta.tris * 3);
    SIMS[name] = {meta, frames, idx};
  }
  function preload(){
    if (!ready){
      const gl = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch(e){ return false; } })();
      ready = gl ? Promise.all([...LIBS.map(loadScript), loadSim('land'), loadSim('port')]).then(() => true).catch(() => false)
                 : Promise.resolve(false);
    }
    return ready;
  }

  /* ---------- screen snapshot ---------- */
  // grab live video frames now (synchronously), the DOM layer is rendered by html2canvas on top
  function grabVideos(){
    const out = [];
    document.querySelectorAll('#page video').forEach(v => {
      const r = v.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth || r.width < 2) return;
      if (getComputedStyle(v).display === 'none' || v.readyState < 2) return;
      const radius = parseFloat(getComputedStyle(v.closest('.scr,.reel,.wide') || v).borderRadius) || 0;
      const vw = v.videoWidth, vh = v.videoHeight, s = Math.max(r.width / vw, r.height / vh);
      const sw = r.width / s, sh = r.height / s;
      const c = document.createElement('canvas'); c.width = Math.ceil(r.width); c.height = Math.ceil(r.height);
      try { c.getContext('2d').drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, c.width, c.height); } catch(e){ return; }
      out.push({c, x: r.left, y: r.top, w: r.width, h: r.height, radius});
    });
    return out;
  }
  async function snapshot(){
    const vids = grabVideos(), dpr = Math.min(devicePixelRatio || 1, 1.5);
    // the page must stay in normal flow (not pinned) until this resolves: crumple() waits for it
    const W = innerWidth, H = innerHeight, x0 = scrollX, y0 = scrollY;
    // mark blocks that are fully off screen right now: skipping them makes the snapshot much faster
    const marked = [];
    document.querySelectorAll('[data-offscreen],[data-above]').forEach(el => { el.removeAttribute('data-offscreen'); el.removeAttribute('data-above'); });
    document.querySelectorAll('section, footer, .project, figure').forEach(el => {
      const r = el.getBoundingClientRect();
      // below the screen: dropped from the clone; above: kept for layout but hidden (not painted)
      if (r.top > H + 40){ el.setAttribute('data-offscreen', ''); marked.push(el); }
      else if (r.bottom < -40){ el.setAttribute('data-above', ''); marked.push(el); }
    });
    // sticky blocks (series titles): html2canvas ignores sticky, so pass the current shift to the clone
    document.querySelectorAll('.series-txt').forEach(el => {
      if (getComputedStyle(el).position !== 'sticky') return;
      const stuck = el.getBoundingClientRect().top;
      el.style.position = 'static'; const flat = el.getBoundingClientRect().top; el.style.position = '';
      if (Math.abs(stuck - flat) > 1){ el.setAttribute('data-dy', Math.round(stuck - flat)); marked.push(el); }
    });
    const top = await html2canvas(document.body, {
      x: x0, y: y0, scrollX: 0, scrollY: 0, width: W, height: H, windowWidth: document.documentElement.clientWidth, windowHeight: H,
      scale: dpr, backgroundColor: null, useCORS: true, logging: false,
      // skip everything off screen: the clone and render get several times faster on long pages
      // (visibility is measured on the live page beforehand: inside the clone the scroll is 0)
      ignoreElements: el => ['nope', 'cur', 'lagtoast', 'pre', 'joke', 'lb', 'ballshadow'].includes(el.id)
        || el.tagName === 'CANVAS' || (el.hasAttribute && el.hasAttribute('data-offscreen')),
      onclone: doc => {
        const st = doc.createElement('style');
        st.textContent = `html,body{background:transparent!important}body::after{display:none!important}
          #page{transform:none!important;filter:none!important;opacity:1!important}
          nav{position:absolute!important;top:${y0}px!important}
          [data-above]{visibility:hidden!important}
          video{visibility:hidden!important}.reel,.wide,.phone .scr{background:transparent!important}
          .phone{background:none!important;box-shadow:none!important;border:7px solid #1d191b;padding:0!important}
          nav{mix-blend-mode:normal!important}`;
        doc.head.append(st);
        doc.querySelectorAll('[data-dy]').forEach(e => { e.style.position = 'relative'; e.style.top = e.getAttribute('data-dy') + 'px'; });
      }
    });
    marked.forEach(el => { el.removeAttribute('data-offscreen'); el.removeAttribute('data-above'); el.removeAttribute('data-dy'); });
    const c = document.createElement('canvas'); c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const g = c.getContext('2d');
    g.fillStyle = '#0b0a0b'; g.fillRect(0, 0, c.width, c.height);
    g.scale(dpr, dpr);
    vids.forEach(v => {
      g.save(); g.beginPath();
      if (g.roundRect) g.roundRect(v.x, v.y, v.w, v.h, v.radius); else g.rect(v.x, v.y, v.w, v.h);
      g.clip(); g.drawImage(v.c, v.x, v.y, v.w, v.h); g.restore();
    });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(top, 0, 0, c.width, c.height);
    return c;
  }

  /* ---------- 3D scene ---------- */
  let S = null;   // {renderer, scene, camera, mesh, geo, sim, sx, group, floor}
  function build(texCanvas){
    const T = THREE, W = innerWidth, H = innerHeight, aspect = W / H;
    const sim = aspect >= 1 ? SIMS.land : SIMS.port;
    const renderer = new T.WebGLRenderer({antialias: true, alpha: true});
    const small = Math.min(W, H) < 600;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.NoToneMapping;
    Object.assign(renderer.domElement.style, {position: 'fixed', inset: '0', zIndex: '31', pointerEvents: 'none'});
    document.body.append(renderer.domElement);

    const scene = new T.Scene();
    const fov = 30, dist = 0.5 / Math.tan(fov * Math.PI / 360);
    const camera = new T.PerspectiveCamera(fov, aspect, 0.05, 20);
    camera.position.set(0, 0, dist);

    // key light top-left, weak pink fill from the "table", soft rim from the right
    scene.add(new T.HemisphereLight(0xffffff, 0xff9cc6, 0.28));
    const sun = new T.DirectionalLight(0xffffff, 1.25);
    sun.position.set(-0.7, 0.9, 1.9); sun.castShadow = true;
    const rim = new T.DirectionalLight(0xffe6f0, 0.35); rim.position.set(1.2, -0.4, 0.8); scene.add(rim);
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(sun.shadow.camera, {left: -1.2, right: 1.2, top: 1.2, bottom: -1.2, near: .1, far: 6});
    sun.shadow.radius = 6; sun.shadow.bias = -0.0008;
    scene.add(sun);

    // table under the paper: only receives the shadow, page background (pink) shows through
    const floor = new T.Mesh(new T.PlaneGeometry(8, 8), new T.ShadowMaterial({opacity: .28}));
    floor.position.z = -0.02; floor.receiveShadow = true; scene.add(floor);

    // non-indexed mesh: every triangle corner gets its own normal, so flat areas stay smooth
    // and only real folds (> ~30° between faces) become sharp creases
    const base = sim.frames[0], n = sim.meta.verts, idx = sim.idx, nt = idx.length / 3, a = sim.meta.aspect;
    const geo = new T.BufferGeometry();
    const pos = new Float32Array(nt * 9), nor = new Float32Array(nt * 9), uv = new Float32Array(nt * 6);
    for (let c = 0; c < nt * 3; c++){ const v = idx[c]; uv[c * 2] = base[v * 3] / a + .5; uv[c * 2 + 1] = base[v * 3 + 1] + .5; }
    // vertex -> faces (CSR)
    const cnt = new Uint32Array(n + 1);
    for (let c = 0; c < nt * 3; c++) cnt[idx[c] + 1]++;
    for (let v = 0; v < n; v++) cnt[v + 1] += cnt[v];
    const vf = new Uint32Array(nt * 3), fill = cnt.slice(0, n);
    for (let c = 0; c < nt * 3; c++) vf[fill[idx[c]]++] = (c / 3) | 0;
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    const P = new Float32Array(n * 3), FN = new Float32Array(nt * 3);

    const tex = new T.CanvasTexture(texCanvas);
    tex.encoding = T.sRGBEncoding; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = new T.MeshStandardMaterial({map: tex, roughness: .62, metalness: 0, side: T.DoubleSide});
    // the back of the sheet is plain off-white paper
    // uLit: 0 = unlit (flat sheet looks exactly like the page), 1 = fully lit paper
    const uLit = {value: 0};
    mat.onBeforeCompile = sh => {
      sh.uniforms.uLit = uLit;
      sh.fragmentShader = 'uniform float uLit;\n' + sh.fragmentShader
        // back of thin paper: warm off-white with the print faintly showing through (mirrored)
        .replace('#include <map_fragment>', `#include <map_fragment>
 if (!gl_FrontFacing) {
   vec3 thru = texture2D(map, vec2(1.0 - vUv.x, vUv.y)).rgb;
   diffuseColor.rgb = mix(vec3(0.87, 0.85, 0.80), thru, 0.32);
 }`)
        .replace('#include <output_fragment>', 'outgoingLight = mix(diffuseColor.rgb, outgoingLight, uLit);\n#include <output_fragment>');
    };
    const mesh = new T.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const sx = aspect / a;                  // stretch the sim sheet to the exact screen shape
    mesh.scale.set(sx, 1, Math.sqrt(sx));
    const group = new T.Group(); group.add(mesh); scene.add(group);

    S = {renderer, scene, camera, mesh, geo, sim, group, floor, tex, uLit, P, FN, cnt, vf, idx, nt};
    setFrame(0); render();
  }
  // p: 0 flat .. 1 fully crumpled
  function setFrame(p){
    const fr = S.sim.frames, f = Math.max(0, Math.min(1, p)) * (fr.length - 1);
    const i = Math.floor(f), k = f - i, A = fr[i], B = fr[Math.min(fr.length - 1, i + 1)];
    const {P, FN, cnt, vf, idx, nt} = S;
    for (let j = 0; j < P.length; j++) P[j] = A[j] + (B[j] - A[j]) * k;
    // face normals
    for (let t = 0; t < nt; t++){
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      FN[t * 3] = nx / l; FN[t * 3 + 1] = ny / l; FN[t * 3 + 2] = nz / l;
    }
    // corner normals: average neighbouring faces that bend less than ~30°
    const pos = S.geo.attributes.position.array, nor = S.geo.attributes.normal.array, COS = 0.866;
    for (let c = 0; c < nt * 3; c++){
      const v = idx[c], t = (c / 3) | 0, fx = FN[t * 3], fy = FN[t * 3 + 1], fz = FN[t * 3 + 2];
      let sx = 0, sy = 0, sz = 0;
      for (let q = cnt[v]; q < cnt[v + 1]; q++){
        const f = vf[q] * 3, gx = FN[f], gy = FN[f + 1], gz = FN[f + 2];
        if (fx * gx + fy * gy + fz * gz > COS){ sx += gx; sy += gy; sz += gz; }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      nor[c * 3] = sx / l; nor[c * 3 + 1] = sy / l; nor[c * 3 + 2] = sz / l;
      pos[c * 3] = P[v * 3]; pos[c * 3 + 1] = P[v * 3 + 1]; pos[c * 3 + 2] = P[v * 3 + 2];
    }
    S.geo.attributes.position.needsUpdate = true;
    S.geo.attributes.normal.needsUpdate = true;
    S.geo.computeBoundingSphere();
    // crumpled ball lifts off the table a little so it rests on its shadow
    S.mesh.position.z = 0.03 * p;
    const l = Math.min(1, p / 0.18); S.uLit.value = l * l * (3 - 2 * l);
  }
  function render(){ S && S.renderer.render(S.scene, S.camera); }
  function destroy(){
    if (!S) return;
    S.renderer.domElement.remove(); S.geo.dispose(); S.mesh.material.dispose(); S.tex.dispose(); S.renderer.dispose();
    S = null;
  }

  window.Paper3D = {
    preload, snapshot, build, setFrame, render, destroy,
    get group(){ return S && S.group; },
    get mesh(){ return S && S.mesh; }
  };
})();
