/* PULSE — Air Jam guitars.
   Two 3D guitars, an acoustic and an electric, built from code with three.js: no model files to download
   and nothing borrowed. Everything is measured in scale lengths: the nut is at x = 0, the bridge at x = 1,
   y runs across the strings (low E on top) and z points out of the guitar's face toward the player. */
(function () {
  'use strict';

  const CFG = Object.assign({
    three: 'https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js'
  }, window.PULSE_JAM_CONFIG || {});

  let THREE = null, loading = null;
  function load() {
    if (!loading) loading = import(CFG.three).then(function (m) { THREE = m; return m; }).catch(function (e) { loading = null; throw e; });
    return loading;
  }

  const fretX = function (n) { return 1 - Math.pow(2, -n / 12); };   // where fret n sits along the string
  const lerp = function (a, b, t) { return a + (b - a) * t; };
  const NUT_W = 0.034;                                                // half-width of the neck at the nut
  const STRING_R = [0.0030, 0.0026, 0.0022, 0.0017, 0.0013, 0.0011];
  const stringY = function (s, x) { return lerp(0.028 - s * 0.0112, 0.043 - s * 0.0172, x); };
  const PINK = 0xFF3D9A, AQUA = 0x2CE6D6;

  const SPECS = {
    acoustic: {
      frets: 20, joint: 14, bodyX: fretX(14), bodyEnd: fretX(14) + 0.78, bodyHalf: 0.3, depth: 0.16, bevel: 0.006,
      head: 0.27, headTilt: -0.24, saddleZ: 0.026,
      outline: [[0, 0.06], [0.02, 0.14], [0.08, 0.205], [0.17, 0.225], [0.26, 0.21], [0.33, 0.185], [0.42, 0.215], [0.52, 0.285],
        [0.6, 0.3], [0.69, 0.27], [0.75, 0.19], [0.78, 0]],
      symmetric: true
    },
    electric: {
      frets: 22, joint: 17, bodyX: 0.6, bodyEnd: 1.225, bodyHalf: 0.255, depth: 0.066, bevel: 0.012,
      head: 0.29, headTilt: -0.1, saddleZ: 0.03,
      outline: [[0.05, 0.05], [0, 0.09], [-0.07, 0.13], [-0.11, 0.175], [-0.07, 0.215], [0.02, 0.225], [0.12, 0.215], [0.22, 0.2],
        [0.32, 0.215], [0.44, 0.245], [0.54, 0.235], [0.6, 0.18], [0.625, 0.08], [0.625, -0.06], [0.6, -0.17], [0.53, -0.235],
        [0.43, -0.255], [0.32, -0.235], [0.22, -0.2], [0.13, -0.205], [0.05, -0.215], [-0.03, -0.2], [-0.065, -0.165],
        [-0.04, -0.125], [0.01, -0.085], [0.05, -0.05]],
      symmetric: false
    }
  };

  /* ------------------------------------------------------------------ small builders */
  function std(color, rough, metal, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: rough, metalness: metal || 0 }, extra || {}));
  }
  function gloss(color) {
    return new THREE.MeshPhysicalMaterial({ color: color, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12 });
  }
  function splineShape(pts, n) {
    const curve = new THREE.CatmullRomCurve3(pts.map(function (p) { return new THREE.Vector3(p[0], p[1], 0); }), true, 'catmullrom', 0.5);
    return new THREE.Shape(curve.getPoints(n || 140).map(function (v) { return new THREE.Vector2(v.x, v.y); }));
  }
  function polyShape(pts) {
    return new THREE.Shape(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }));
  }
  /* A flat plate with the given outline: its top face ends up at z = top */
  function slab(shape, thick, top, bevel, materials) {
    const b = bevel || 0;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thick - 2 * b, bevelEnabled: b > 0, bevelSize: b, bevelThickness: b, bevelSegments: 3, curveSegments: 20, steps: 1 });
    geo.translate(0, 0, top - thick + b);
    return new THREE.Mesh(geo, materials);
  }
  /* A tapered strip along the neck, from x0 (half-width w0) to x1 (half-width w1) */
  function strip(x0, x1, w0, w1, thick, top, material) {
    return slab(polyShape([[x0, -w0], [x1, -w1], [x1, w1], [x0, w0]]), thick, top, 0, material);
  }
  function box(w, h, d, x, y, z, material) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    return m;
  }
  function decal(geo, x, y, z, material) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    return m;
  }
  function post(r, h, x, y, z, material) {                       // a cylinder standing up out of the face
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), material);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  }
  function rod(a, b, r, material) {                              // a cylinder from point a to point b
    const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8), material);
    m.scale.set(1, len, 1);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  }

  /* ------------------------------------------------------------------ the guitars */
  function buildGuitar(type) {
    const sp = SPECS[type], g = new THREE.Group(), acoustic = type === 'acoustic';
    const fbEnd = fretX(sp.frets) + 0.012;
    const neckW = function (x) { return lerp(NUT_W, 0.047, x / 0.72); };

    const wood = acoustic ? std(0x6E3B1F, 0.5) : std(0xE2C48A, 0.45);
    const dark = std(0x24140D, 0.55), bone = std(0xF4EFE2, 0.5), chrome = std(0xDCE4EE, 0.18, 1), pearl = std(0xEEF3FA, 0.3, 0.1);
    const bodyPaint = acoustic ? std(0xE0B36A, 0.5) : gloss(PINK);
    const bodySide = acoustic ? std(0x5E3019, 0.45) : bodyPaint;

    // Body
    const pts = sp.symmetric
      ? sp.outline.concat(sp.outline.slice(1, -1).reverse().map(function (p) { return [p[0], -p[1]]; }))
      : sp.outline;
    const body = slab(splineShape(pts.map(function (p) { return [p[0] + sp.bodyX, p[1]]; })), sp.depth, 0, sp.bevel, [bodyPaint, bodySide]);
    g.add(body);

    if (acoustic) {
      const hx = sp.bodyX + 0.235;
      g.add(decal(new THREE.RingGeometry(0.079, 0.1, 56), hx, 0, 0.0008, std(0x3A2114, 0.6)));
      g.add(decal(new THREE.RingGeometry(0.086, 0.0895, 56), hx, 0, 0.0012, bone));
      g.add(decal(new THREE.CircleGeometry(0.076, 56), hx, 0, 0.0016, new THREE.MeshBasicMaterial({ color: 0x090605 })));
      g.add(decal(new THREE.ShapeGeometry(splineShape([[0.7, -0.09], [0.78, -0.104], [0.86, -0.098], [0.93, -0.14], [0.9, -0.21], [0.8, -0.215], [0.72, -0.16]], 60)),
        0, 0, 0.001, std(0x2A1410, 0.25)));
      g.add(box(0.036, 0.2, 0.016, 1.006, 0, 0.008, dark));                              // bridge
      g.add(box(0.005, 0.15, 0.01, 1, 0, 0.021, bone));                                  // saddle
      for (let s = 0; s < 6; s++) g.add(decal(new THREE.SphereGeometry(0.005, 12, 8), 1.019, stringY(s, 1), 0.017, bone));   // bridge pins
      g.add(box(0.05, 0.075, 0.045, sp.bodyX - 0.022, 0, -0.03, wood));                  // heel
    } else {
      g.add(decal(new THREE.ShapeGeometry(splineShape([[0.7, 0.06], [0.8, 0.1], [0.95, 0.09], [1.02, 0.02], [1.1, -0.06], [1.13, -0.16], [1.05, -0.215],
        [0.92, -0.21], [0.8, -0.17], [0.7, -0.1], [0.665, -0.04]], 80)), 0, 0, 0.0012, pearl));
      [0.8, 0.935].forEach(function (x) {                                                // pickups
        g.add(box(0.07, 0.13, 0.004, x, 0, 0.003, dark));
        g.add(box(0.054, 0.114, 0.012, x, 0, 0.008, chrome));
      });
      g.add(box(0.03, 0.13, 0.02, 1.004, 0, 0.012, chrome));                             // bridge
      g.add(box(0.022, 0.13, 0.014, 1.07, 0, 0.008, chrome));                            // tailpiece
      const knob = std(AQUA, 0.25, 0.6);
      [[1.02, -0.15], [1.09, -0.125], [0.95, -0.16]].forEach(function (k) { g.add(post(0.02, 0.018, k[0], k[1], 0.01, knob)); });
      g.add(post(0.004, 0.03, 0.86, -0.13, 0.015, chrome));                              // pickup switch
    }

    // Neck, fretboard, frets, markers
    g.add(strip(0, sp.bodyX + (acoustic ? 0 : 0.03), NUT_W, neckW(sp.bodyX), 0.03, 0, wood));
    g.add(strip(0, fbEnd, NUT_W, neckW(fbEnd), 0.012, 0.012, std(0x2A1810, 0.6)));
    const wire = std(0xC9D2DD, 0.25, 1);
    for (let n = 1; n <= sp.frets; n++) g.add(box(0.0035, 2 * neckW(fretX(n)), 0.003, fretX(n), 0, 0.0135, wire));
    g.add(box(0.008, 2 * NUT_W, 0.008, -0.004, 0, 0.016, bone));
    [3, 5, 7, 9, 12, 15, 17, 19, 21].forEach(function (n) {
      if (n > sp.frets) return;
      const x = (fretX(n - 1) + fretX(n)) / 2, dot = new THREE.CircleGeometry(0.0065, 20);
      if (n === 12) { g.add(decal(dot, x, 0.018, 0.0124, pearl)); g.add(decal(dot, x, -0.018, 0.0124, pearl)); }
      else g.add(decal(dot, x, 0, 0.0124, pearl));
    });

    // Headstock with three tuners a side
    const head = new THREE.Group();
    head.rotation.y = sp.headTilt;
    const hs = acoustic
      ? polyShape([[0, 0.036], [-0.03, 0.05], [-0.24, 0.058], [-0.265, 0.04], [-0.272, 0], [-0.265, -0.04], [-0.24, -0.058], [-0.03, -0.05], [0, -0.036]])
      : polyShape([[0, 0.034], [-0.04, 0.05], [-0.2, 0.062], [-0.29, 0.02], [-0.27, -0.03], [-0.2, -0.05], [-0.04, -0.046], [0, -0.034]]);
    head.add(slab(hs, 0.024, 0.002, 0.003, [acoustic ? dark : bodyPaint, wood]));
    const posts = [];
    [-0.075, -0.145, -0.21].forEach(function (x, i) {
      [1, -1].forEach(function (side) {
        const y = side * 0.034;
        head.add(post(0.006, 0.02, x, y, 0.012, chrome));
        head.add(rod(new THREE.Vector3(x, side * 0.05, -0.01), new THREE.Vector3(x, side * 0.078, -0.01), 0.004, chrome));
        const button = new THREE.Mesh(new THREE.SphereGeometry(0.012, 14, 10), acoustic ? bone : chrome);
        button.scale.set(1.25, 0.8, 0.6); button.position.set(x, side * 0.084, -0.01);
        head.add(button);
        posts[side > 0 ? i : 5 - i] = new THREE.Vector3(x, y, 0.018);                    // low E, A, D on top; G, B, high E below
      });
    });
    g.add(head);

    // Strings: the playing length is lit and moves when strummed; the short ends run on to the tuners
    const strings = [], zN = 0.021;
    for (let s = 0; s < 6; s++) {
      const wound = acoustic ? s < 4 : s < 3;
      const mat = new THREE.MeshStandardMaterial({
        color: acoustic && wound ? 0xC9A45C : 0xD5DCE6, roughness: 0.3, metalness: 1,
        emissive: s % 2 ? AQUA : PINK, emissiveIntensity: 0
      });
      const a = new THREE.Vector3(0, stringY(s, 0), zN), b = new THREE.Vector3(1, stringY(s, 1), sp.saddleZ);
      const mesh = rod(a, b, STRING_R[s], mat);
      g.add(mesh);
      strings.push({ mesh: mesh, mat: mat, base: mesh.position.clone() });
      head.add(rod(new THREE.Vector3(0.002, stringY(s, 0), zN - 0.002), posts[s], STRING_R[s] * 0.8, std(0xD5DCE6, 0.3, 1)));
    }

    // Chord zones along the neck: thin dividers, and a glow over the zone being played
    const zones = [], z0 = -0.03, zw = (fbEnd - z0) / 5;
    const glow = new THREE.MeshBasicMaterial({ color: PINK, transparent: true, opacity: 0.34, depthWrite: false });
    const divider = new THREE.MeshBasicMaterial({ color: 0xF1F6FC, transparent: true, opacity: 0.75, depthWrite: false });
    for (let i = 0; i <= 5; i++) {
      const x = z0 + i * zw;
      g.add(box(0.004, 2 * neckW(Math.max(0, x)) + 0.05, 0.002, x, 0, 0.036, divider));
      if (i < 5) {
        const hi = strip(x, x + zw, neckW(Math.max(0, x)) + 0.016, neckW(x + zw) + 0.016, 0.001, 0.035, glow);
        hi.visible = false;
        g.add(hi);
        zones.push(hi);
      }
    }

    // Finger dots for the current chord
    const dots = [], dotMat = new THREE.MeshStandardMaterial({ color: AQUA, emissive: AQUA, emissiveIntensity: 0.9, roughness: 0.4 });
    for (let s = 0; s < 6; s++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 16, 12), dotMat);
      d.visible = false;
      g.add(d);
      dots.push(d);
    }

    return {
      group: g, strings: strings, zones: zones, dots: dots, spec: sp,
      zoneX: function (i) { return z0 + i * zw; },
      neckW: neckW,
      xMin: -sp.head, xMax: sp.bodyEnd, z0: z0, zw: zw
    };
  }

  function dispose(obj) {
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.dispose(); });
    });
  }

  /* ------------------------------------------------------------------ the view */
  function create(canvas) {
    // An opaque canvas: the browser can hand it straight to the screen. A see-through one has to be blended
    // with everything under it over the whole window, which on integrated graphics at a high-density
    // resolution cost more than the hand tracking itself (measured: 54 ms a look against 9).
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: false, antialias: true });
    renderer.autoClear = false;
    renderer.setClearColor(0x0C0B24, 1);
    renderer.toneMapping = THREE.NeutralToneMapping || THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    const FOV = 26, dist = 1 / Math.tan(FOV * Math.PI / 360);          // at z = 0 the picture is 2 units tall
    const camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 1, dist + 10);
    camera.position.set(0, 0, dist);

    // Light: soft sky, a key light, and pink and aqua rims to match the site
    scene.add(new THREE.HemisphereLight(0xEAF1FA, 0x17153B, 1.1));
    const key = new THREE.DirectionalLight(0xFFFFFF, 2.2); key.position.set(-1.2, 1.6, 3); scene.add(key);
    const rimA = new THREE.DirectionalLight(PINK, 1.4); rimA.position.set(3, -0.5, 1.2); scene.add(rimA);
    const rimB = new THREE.DirectionalLight(AQUA, 1.1); rimB.position.set(-3, 0.6, 1); scene.add(rimB);

    // A painted sky for reflections on the glossy and metal parts
    (function () {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const x = c.getContext('2d'), sky = x.createLinearGradient(0, 0, 0, 128);
      sky.addColorStop(0, '#F6F9FD'); sky.addColorStop(0.45, '#8E9DC2'); sky.addColorStop(0.55, '#2A2760'); sky.addColorStop(1, '#0C0B24');
      x.fillStyle = sky; x.fillRect(0, 0, 256, 128);
      [['#FF3D9A', 60, 70], ['#2CE6D6', 190, 60], ['#FFFFFF', 128, 20]].forEach(function (b) {
        const r = x.createRadialGradient(b[1], b[2], 0, b[1], b[2], 46);
        r.addColorStop(0, b[0]); r.addColorStop(1, 'rgba(0,0,0,0)');
        x.globalAlpha = 0.75; x.fillStyle = r; x.fillRect(0, 0, 256, 128);
      });
      const tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace;
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromEquirectangular(tex).texture;
      tex.dispose(); pm.dispose();
    })();

    const root = new THREE.Group();
    scene.add(root);

    /* Everything is drawn into this one canvas: a backdrop (the camera picture when it is on, a painted one
       when it is off), the guitar, and on top the flat overlay (chord names, hand skeleton, sparks) that the
       page draws on a hidden 2D canvas. */
    const bgScene = new THREE.Scene(), ovScene = new THREE.Scene(), flatCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const flat = function (tex, see) {
      tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      return new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: !!see, depthTest: false, depthWrite: false, toneMapped: false }));
    };
    const still = (function () {                                         // the page's own stage backdrop, painted once
      const c = document.createElement('canvas'); c.width = 320; c.height = 180;
      const x = c.getContext('2d');
      x.fillStyle = '#0C0B24'; x.fillRect(0, 0, 320, 180);
      [['rgba(255, 61, 154, .3)', 256, 36], ['rgba(44, 230, 214, .22)', 32, 162]].forEach(function (b) {
        const g = x.createRadialGradient(b[1], b[2], 0, b[1], b[2], 190);
        g.addColorStop(0, b[0]); g.addColorStop(0.7, 'rgba(12, 11, 36, 0)');
        x.fillStyle = g; x.fillRect(0, 0, 320, 180);
      });
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      return flat(t, false);
    })();
    bgScene.add(still);
    let bgTex = null, bgMesh = null, bgVideo = null, ovTex = null, ovMesh = null;
    function fitVideo() {
      if (!bgTex || !bgVideo || !bgVideo.videoWidth) return;
      const va = bgVideo.videoWidth / bgVideo.videoHeight, rx = Math.min(1, st.aspect / va), ry = Math.min(1, va / st.aspect);
      bgTex.repeat.set(-rx, ry); bgTex.offset.set((1 + rx) / 2, (1 - ry) / 2);      // fill the picture, mirrored
    }
    function setVideo(video) {
      if (bgMesh) { bgScene.remove(bgMesh); bgMesh.geometry.dispose(); bgMesh.material.dispose(); bgTex.dispose(); bgMesh = bgTex = bgVideo = null; }
      if (hMesh) { hScene.remove(hMesh); hMesh.material.dispose(); hMesh = null; hCount = 0; }
      still.visible = !video;
      if (!video) return;
      bgVideo = video;
      bgTex = new THREE.VideoTexture(video); bgTex.colorSpace = THREE.SRGBColorSpace;
      bgMesh = flat(bgTex, false);
      bgMesh.material.color.set(0xE2E2E2);
      bgScene.add(bgMesh);
      hMesh = new THREE.Mesh(hGeo, new THREE.MeshBasicMaterial({ map: bgTex, color: 0xE2E2E2, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false }));
      hMesh.frustumCulled = false;
      hScene.add(hMesh);
      fitVideo();
    }
    /* Hands in front. The tracker gives 21 points a hand; from them a hand-shaped patch is built (fingers and
       forearm as rounded strips, the palm filled in) and the camera picture is drawn again inside that patch,
       over the guitar. So the guitar hides the player's body but not the hands that are holding it. */
    const HMAX = 6400, hPos = new Float32Array(HMAX * 3), hUv = new Float32Array(HMAX * 2);
    const hGeo = new THREE.BufferGeometry(), hScene = new THREE.Scene();
    hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3));
    hGeo.setAttribute('uv', new THREE.BufferAttribute(hUv, 2));
    hGeo.setDrawRange(0, 0);
    let hMesh = null, hCount = 0;
    const FINGERS = [[5, 6], [6, 7], [7, 8], [9, 10], [10, 11], [11, 12], [13, 14], [14, 15], [15, 16], [17, 18], [18, 19], [19, 20]];
    const THUMB = [[1, 2], [2, 3], [3, 4]], PALM = [0, 1, 2, 5, 9, 13, 17];
    function setHands(hands) {
      if (!hMesh) { hCount = 0; return; }
      const asp = st.aspect;
      let n = 0;
      const put = function (x, y) { if (n >= HMAX) return; hPos[n * 3] = x * 2 - 1; hPos[n * 3 + 1] = 1 - y * 2; hPos[n * 3 + 2] = 0; hUv[n * 2] = x; hUv[n * 2 + 1] = 1 - y; n++; };
      const disc = function (c, r) {
        for (let k = 0; k < 10; k++) {
          const a = k * Math.PI / 5, b = (k + 1) * Math.PI / 5;
          put(c.x, c.y); put(c.x + Math.cos(a) * r / asp, c.y + Math.sin(a) * r); put(c.x + Math.cos(b) * r / asp, c.y + Math.sin(b) * r);
        }
      };
      const strip = function (a, b, r) {                                // a rounded strip from a to b, r wide each side (in picture heights)
        const dx = (b.x - a.x) * asp, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1e-6, nx = -dy / len * r / asp, ny = dx / len * r;
        put(a.x + nx, a.y + ny); put(a.x - nx, a.y - ny); put(b.x + nx, b.y + ny);
        put(a.x - nx, a.y - ny); put(b.x - nx, b.y - ny); put(b.x + nx, b.y + ny);
        disc(a, r); disc(b, r);
      };
      (hands || []).forEach(function (h) {
        if (!h || h.length < 21) return;
        const dist = function (i, j) { return Math.hypot((h[i].x - h[j].x) * asp, h[i].y - h[j].y); };
        const w = Math.max(dist(5, 17), 0.75 * dist(0, 9));              // palm width, or its length when the hand is edge-on
        let cx = 0, cy = 0;
        PALM.forEach(function (i) { cx += h[i].x; cy += h[i].y; });
        const c = { x: cx / PALM.length, y: cy / PALM.length };
        PALM.forEach(function (i, k) {                                    // the palm, filled, with a rounded rim
          const j = PALM[(k + 1) % PALM.length];
          put(c.x, c.y); put(h[i].x, h[i].y); put(h[j].x, h[j].y);
          strip(h[i], h[j], 0.14 * w);
        });
        FINGERS.forEach(function (b) { strip(h[b[0]], h[b[1]], 0.118 * w); });
        THUMB.forEach(function (b) { strip(h[b[0]], h[b[1]], 0.135 * w); });
        // the start of the forearm, away from the fingers
        const fx = (h[0].x - h[9].x) * asp, fy = h[0].y - h[9].y, fl = Math.hypot(fx, fy) || 1e-6;
        strip(h[0], { x: h[0].x + fx / fl * 0.9 * w / asp, y: h[0].y + fy / fl * 0.9 * w }, 0.36 * w);
      });
      hCount = n;
      hGeo.setDrawRange(0, n);
      hGeo.attributes.position.needsUpdate = true; hGeo.attributes.uv.needsUpdate = true;
    }
    function setOverlay(canvas2d) {
      if (ovMesh) { ovScene.remove(ovMesh); ovMesh.geometry.dispose(); ovMesh.material.dispose(); ovTex.dispose(); ovMesh = ovTex = null; }
      if (!canvas2d) return;
      ovTex = new THREE.CanvasTexture(canvas2d); ovTex.colorSpace = THREE.SRGBColorSpace;
      ovMesh = flat(ovTex, true);
      ovScene.add(ovMesh);
    }
    const st = { type: '', model: null, chord: -1, frets: null, aspect: 4 / 3, w: 0, h: 0, posed: false, ratio: 1,
      p: { x: 0.66, y: 0.52, ux: 1, uy: 0.12, L: 0.8, lefty: false } };
    const v = new THREE.Vector3();

    function setType(type) {
      if (type === st.type || !SPECS[type]) return;
      if (st.model) { root.remove(st.model.group); dispose(st.model.group); }
      st.type = type;
      st.model = buildGuitar(type);
      root.add(st.model.group);
      st.chord = -1; st.posed = false;
    }

    /* Place the guitar. p.x, p.y: where the strumming spot on the strings should be, 0..1 across and down the
       picture. p.ux, p.uy: which way the strings run from nut to bridge on screen (y down). p.L: the scale length,
       in picture heights. A little fixed tilt keeps it looking solid instead of flat. */
    const PICK = 0.88;
    function pose() {
      const p = st.p, dir = p.lefty ? -1 : 1, L = 2 * p.L;
      root.scale.set(L * dir, L, L);
      root.rotation.order = 'ZYX';
      root.rotation.set(-0.2, 0.16 * dir, dir > 0 ? Math.atan2(-p.uy, p.ux) : Math.atan2(p.uy, -p.ux));
      root.position.set(0, 0, 0);
      root.updateMatrixWorld(true);
      const w = root.localToWorld(v.set(PICK, 0, 0));
      root.position.set((p.x - 0.5) * 2 * st.aspect - w.x, (0.5 - p.y) * 2 - w.y, -w.z);
      root.updateMatrixWorld(true);
      st.posed = true;
    }
    function setPose(p) {
      const q = st.p;
      if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + Math.abs(p.ux - q.ux) + Math.abs(p.uy - q.uy) + Math.abs(p.L - q.L) < 0.0004 && p.lefty === q.lefty) return;
      st.p = { x: p.x, y: p.y, ux: p.ux, uy: p.uy, L: p.L, lefty: p.lefty };
      st.posed = false;
    }
    function toScreen(x, y, z) {                                        // guitar coordinates -> 0..1 across and down the picture
      root.localToWorld(v.set(x, y, z)).project(camera);
      return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
    }

    function update(o) {
      if (o.chord !== st.chord) {
        st.chord = o.chord; st.frets = o.frets;
        const m = st.model;
        m.zones.forEach(function (z, i) { z.visible = i === o.chord; });
        m.dots.forEach(function (d, s) {
          const f = o.frets[s];
          d.visible = f > 0;
          if (f > 0) { const x = fretX(f - 1) + (fretX(f) - fretX(f - 1)) * 0.6; d.position.set(x, stringY(s, x), 0.027); }
        });
      }
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      st.w = r.width; st.h = r.height; st.aspect = r.width / r.height;
      renderer.setPixelRatio(1);
      renderer.setSize(Math.max(2, Math.round(r.width * st.ratio)), Math.max(2, Math.round(r.height * st.ratio)), false);
      camera.aspect = st.aspect; camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);                 // labels are placed before the first render, so the camera must be ready now
      st.posed = false;
      fitVideo();
    }

    /* amps: how hard each string is ringing right now (0 = still). calm: skip the movement, keep the glow */
    function render(now, amps, calm) {
      if (!st.model || !st.w) return;
      if (!st.posed) pose();
      st.model.strings.forEach(function (s, i) {
        const a = Math.min(1, (amps[i] || 0) / 16);
        s.mat.emissiveIntensity = a * 2.2;
        const fat = calm ? 1 : 1 + a * 2.4;
        s.mesh.scale.x = fat; s.mesh.scale.z = fat;
        s.mesh.position.y = s.base.y + (calm ? 0 : Math.sin(now * (70 + i * 11)) * a * 0.0035);
      });
      renderer.clear();
      if (bgMesh) fitVideo();
      renderer.render(bgScene, flatCam);
      renderer.clearDepth();
      renderer.render(scene, camera);
      if (hMesh && hCount) { renderer.clearDepth(); renderer.render(hScene, flatCam); }
      if (ovMesh) { ovTex.needsUpdate = true; renderer.clearDepth(); renderer.render(ovScene, flatCam); }
    }

    function labels() {
      if (!st.posed) pose();
      const m = st.model, out = { zones: [], strum: toScreen(0.9, 0, 0.03), tag: toScreen(1.0, m.spec.bodyHalf + 0.035, 0) };
      for (let i = 0; i < 5; i++) {
        const x = (m.zoneX(i) + m.zoneX(i + 1)) / 2;
        out.zones.push(toScreen(x, -(m.neckW(Math.max(0, x)) + 0.085), 0.01));
      }
      return out;
    }

    return {
      setType: setType, update: update, setPose: setPose, setVideo: setVideo, setOverlay: setOverlay, setHands: setHands, resize: resize, render: render, labels: labels,
      type: function () { return st.type; },
      /* Sizes the hand logic needs, in scale lengths: where the guitar starts and ends, and the chord zones on the neck */
      extents: function () { const m = st.model; return { xMin: m.xMin, xMax: m.xMax, bodyHalf: m.spec.bodyHalf, pick: PICK, z0: m.z0, zw: m.zw }; },
      /* How many canvas pixels per page pixel: fewer = less work for the graphics card */
      setRatio: function (r) { if (r !== st.ratio) { st.ratio = r; resize(); } },
      dispose: function () {
        setVideo(null); setOverlay(null); hGeo.dispose();
        still.geometry.dispose(); still.material.map.dispose(); still.material.dispose();
        if (st.model) dispose(st.model.group);
        if (scene.environment) scene.environment.dispose();
        renderer.dispose();
      }
    };
  }

  window.PulseGuitar3D = { load: load, create: create };
})();
