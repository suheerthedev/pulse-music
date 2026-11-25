/* PULSE — Air Jam: play air guitar with your webcam.
   - Hand tracking: MediaPipe HandLandmarker (Tasks Vision), loaded from a CDN on demand and run locally.
     Video frames never leave the browser: nothing is recorded, stored or uploaded.
   - Sound: six Karplus-Strong plucked strings (no samples), with an optional distortion stage.
   - Everything the camera does can also be done with the on-screen buttons and the keyboard. */
(function () {
  'use strict';

  /* Pinned to 0.10.35 on purpose: from 1.0.0 the library also posts anonymous usage statistics
     (task name, timings) to a Google logging endpoint with no switch to turn it off. This version
     has the same HandLandmarker API and makes no requests besides downloading its own files. */
  const CFG = Object.assign({
    lib: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs',
    wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
    delegates: ['GPU', 'CPU'],
    models: [
      'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      'https://huggingface.co/litert-community/MediaPipe-HandLandmarker-Full/resolve/main/hand_landmarker.task'
    ]
  }, window.PULSE_JAM_CONFIG || {});

  /* Open chords in standard tuning. frets[i] is the fret on string i (low E first), -1 = string not played. */
  const TUNING = [40, 45, 50, 55, 59, 64];
  const CHORDS = [
    { name: 'Em', frets: [0, 2, 2, 0, 0, 0] },
    { name: 'G', frets: [3, 2, 0, 0, 0, 3] },
    { name: 'C', frets: [-1, 3, 2, 0, 1, 0] },
    { name: 'D', frets: [-1, -1, 0, 2, 3, 2] },
    { name: 'Am', frets: [-1, 0, 2, 2, 1, 0] }
  ];

  /* Screen layout in mirrored, normalised coordinates (0..1). Left-handed mode flips x. */
  const ZONE = { x0: 0.03, x1: 0.6 };            // chord zones: five columns
  const STRUM = { x0: 0.66, x1: 0.97, y: 0.56 }; // strings and the strum line
  const SPLIT = 0.63;                            // a single hand left of this is the chord hand

  const CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

  const clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  const FLAT_EDGES = [0, 1, 2, 3, 4, 5].map(function (i) { return ZONE.x0 + i * (ZONE.x1 - ZONE.x0) / 5; });
  const saved = function (key, value) {
    try { if (value === undefined) return window.localStorage.getItem('pulse:' + key); window.localStorage.setItem('pulse:' + key, value); } catch (e) { /* private mode */ }
    return null;
  };
  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  const S = {
    mounted: false, root: null, video: null, canvas: null, g: null,
    chord: 0, muted: false, padMute: false, dist: false, lefty: false,
    guitar: 'acoustic',       // acoustic | electric
    view: null, viewToken: 0, gl: null,       // the 3D guitar, when three.js is available
    edges: null, split: SPLIT, strumAt: null, // chord zone edges and strum point, measured on the guitar
    fit: { sx: 1, ox: 0, sy: 1, oy: 0 },      // how the camera picture is scaled to cover the stage
    live: false,
    camera: 'off',            // off | starting | loading | on | error
    error: '', aspect: 1.33, stream: null, landmarker: null, raf: 0, lastVideoTime: -1, stamp: 0,
    hands: { fret: null, strum: null },       // smoothed landmark sets
    seenAt: 0, lowLight: false, lightAt: 0,
    strumY: null, strumT: 0, strumV: 0, lastStrumAt: 0, lastDir: -1,
    fistFrames: 0, openFrames: 0, lone: null, wantChord: -1,
    stroke: { dir: 0, travel: 0, fired: false }, lineY: STRUM.y,
    ms: 0, fps: 0, lastDetectAt: 0, delegate: '', bench: null,
    strings: [0, 1, 2, 3, 4, 5].map(function () { return { amp: 0, t0: 0 }; }),
    particles: [], strums: 0, last: null, status: ''
  };
  if (saved('jam-guitar') === 'electric') S.guitar = 'electric';

  /* =====================================================================
     Sound: Karplus-Strong strings
     ===================================================================== */
  const A = { ctx: null, input: null, cleanG: null, distG: null, bufs: {}, voices: [null, null, null, null, null, null] };

  /* One plucked string, rendered to a buffer. A burst of noise circulates in a delay line whose length
     sets the pitch; a two-point average in the loop makes high harmonics die first, like a real string.
     An all-pass stage fine-tunes the delay so the note is in tune. */
  function pluckBuffer(midi) {
    const sr = A.ctx.sampleRate, freq = 440 * Math.pow(2, (midi - 69) / 12);
    const period = sr / freq;
    const n = Math.floor(period + 0.4), frac = period + 0.5 - n;      // loop delay = n - 0.5 (average of the two oldest samples) + frac (all-pass)
    const c = (1 - frac) / (1 + frac);
    const len = Math.floor(sr * (midi < 50 ? 3.6 : 3));
    const out = A.ctx.createBuffer(1, len, sr), d = out.getChannelData(0);
    const line = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {                                     // pick noise, slightly softened
      const w = Math.random() * 2 - 1;
      prev = line[i] = 0.55 * w + 0.45 * prev;
    }
    const pick = Math.max(1, Math.floor(n * 0.18));                   // pick position: comb out some harmonics
    for (let i = n - 1; i >= pick; i--) line[i] -= 0.6 * line[i - pick];
    const loss = midi < 50 ? 0.9968 : midi < 58 ? 0.9955 : 0.994;
    let idx = 0, apIn = 0, apOut = 0;
    for (let i = 0; i < len; i++) {
      const cur = line[idx], next = line[idx + 1 === n ? 0 : idx + 1];
      d[i] = cur;
      const avg = loss * 0.5 * (cur + next);
      apOut = c * avg + apIn - c * apOut;
      apIn = avg;
      line[idx] = apOut;
      idx = idx + 1 === n ? 0 : idx + 1;
    }
    const fade = Math.floor(sr * 0.25);
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
    return out;
  }

  function audioInit() {
    if (A.ctx) { if (A.ctx.state !== 'running') A.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = A.ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    const master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);

    A.input = ctx.createGain();
    // Acoustic: a hollow body. Low resonances from the soundbox, and the top end left open
    A.acG = ctx.createGain(); A.acG.gain.value = 0;
    const acHp = ctx.createBiquadFilter(); acHp.type = 'highpass'; acHp.frequency.value = 70;
    const box1 = ctx.createBiquadFilter(); box1.type = 'peaking'; box1.frequency.value = 105; box1.Q.value = 1.4; box1.gain.value = 7;
    const box2 = ctx.createBiquadFilter(); box2.type = 'peaking'; box2.frequency.value = 210; box2.Q.value = 2; box2.gain.value = 4;
    const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 4500; air.gain.value = 3;
    const acLp = ctx.createBiquadFilter(); acLp.type = 'lowpass'; acLp.frequency.value = 9500;
    A.input.connect(acHp); acHp.connect(box1); box1.connect(box2); box2.connect(air); air.connect(acLp); acLp.connect(A.acG); A.acG.connect(master);
    // Electric, clean: a magnetic pickup hears less top end, with a little bite around 2.5 kHz
    A.cleanG = ctx.createGain();
    const cleanTrim = ctx.createGain(); cleanTrim.gain.value = 0.72;
    const cleanLp = ctx.createBiquadFilter(); cleanLp.type = 'lowpass'; cleanLp.frequency.value = 4800;
    const bite = ctx.createBiquadFilter(); bite.type = 'peaking'; bite.frequency.value = 2500; bite.Q.value = 1; bite.gain.value = 3;
    A.input.connect(cleanLp); cleanLp.connect(bite); bite.connect(cleanTrim); cleanTrim.connect(A.cleanG); A.cleanG.connect(master);
    // Distortion: boost -> soft clip -> speaker-cabinet style filtering
    A.distG = ctx.createGain(); A.distG.gain.value = 0;
    const pre = ctx.createGain(); pre.gain.value = 22;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = (i / 1023.5) - 1; curve[i] = Math.tanh(2.6 * x); }
    shaper.curve = curve; shaper.oversample = '4x';
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110;
    const cab = ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 3600; cab.Q.value = 0.8;
    const post = ctx.createGain(); post.gain.value = 0.34;
    A.input.connect(hp); hp.connect(pre); pre.connect(shaper); shaper.connect(cab); cab.connect(post); post.connect(A.distG); A.distG.connect(master);
    // A little room
    const rev = ctx.createConvolver(), rLen = Math.floor(ctx.sampleRate * 1.3);
    const ir = ctx.createBuffer(2, rLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const r = ir.getChannelData(ch); for (let i = 0; i < rLen; i++) r[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rLen, 3); }
    rev.buffer = ir;
    const send = ctx.createGain(); send.gain.value = 0.16;
    const acSend = ctx.createGain(); acSend.gain.value = 1.5;          // the acoustic sits in a bit more room
    A.acG.connect(acSend); acSend.connect(send);
    A.cleanG.connect(send); A.distG.connect(send); send.connect(rev); rev.connect(master);

    // Render every note the five chords need (about 40 ms of work, once)
    CHORDS.forEach(function (ch) {
      ch.frets.forEach(function (f, s) { if (f >= 0 && !A.bufs[TUNING[s] + f]) A.bufs[TUNING[s] + f] = pluckBuffer(TUNING[s] + f); });
    });
    applyTone();
    if (ctx.state !== 'running' && ctx.resume) ctx.resume();
    return true;
  }

  function applyTone() {
    if (!A.ctx) return;
    const t = A.ctx.currentTime, ac = S.guitar === 'acoustic';
    A.acG.gain.setTargetAtTime(ac ? 1.25 : 0, t, 0.02);
    A.cleanG.gain.setTargetAtTime(!ac && !S.dist ? 1 : 0, t, 0.02);
    A.distG.gain.setTargetAtTime(!ac && S.dist ? 1 : 0, t, 0.02);
  }

  /* Stop the strings ringing (a hand laid across them) */
  function damp() {
    if (!A.ctx) return;
    const t = A.ctx.currentTime;
    A.voices.forEach(function (v) { if (v) v.g.gain.setTargetAtTime(0, t, 0.025); });
  }

  /* dir: 1 = downstroke (low string first), -1 = upstroke. vel: 0..1 */
  function strum(dir, vel, at) {
    if (!audioInit()) { setStatus('This browser has no Web Audio, so Air Jam cannot make sound.'); return; }
    const ctx = A.ctx, chord = CHORDS[S.chord], muted = S.muted || S.padMute;
    vel = clamp(vel, 0.15, 1);
    const t = ctx.currentTime + 0.01, stagger = 0.03 - 0.02 * vel;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 1500 + vel * 5500; tone.connect(A.input);
    let k = 0;
    for (let n = 0; n < 6; n++) {
      const s = dir > 0 ? n : 5 - n, fret = chord.frets[s];
      if (fret < 0) continue;
      const when = t + k * stagger;
      const old = A.voices[s];
      if (old) { old.g.gain.setTargetAtTime(0, when, 0.008); try { old.src.stop(when + 0.1); } catch (e) { /* already stopped */ } }
      const src = ctx.createBufferSource(); src.buffer = A.bufs[TUNING[s] + fret];
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * 0.5, when);
      if (muted) g.gain.setTargetAtTime(0, when + 0.02, 0.03);      // palm mute: just the percussive "chk"
      src.connect(g); g.connect(tone);
      src.start(when);
      A.voices[s] = { src: src, g: g };
      S.strings[s].amp = (muted ? 5 : 16) * (0.4 + vel); S.strings[s].t0 = performance.now() / 1000 + k * stagger;
      k++;
    }
    S.strums++;
    S.last = { dir: dir, vel: Math.round(vel * 100) / 100, chord: chord.name, muted: muted };
    S.lastDir = dir;
    burst(at, vel);
    kick();
  }

  /* =====================================================================
     Gestures: turn hand landmarks into chord, strum and mute
     ===================================================================== */
  const palm = function (h) {
    let x = 0, y = 0;
    [0, 5, 9, 13, 17].forEach(function (i) { x += h[i].x; y += h[i].y; });
    return { x: x / 5, y: y / 5 };
  };
  /* Only a tight fist counts. A hand loosely curled round an imaginary guitar neck must keep ringing,
     so every fingertip has to be pulled right back to the palm. Distances are measured in palm lengths. */
  function isFist(h) {
    const w = h[0], d = function (p) { return Math.hypot((p.x - w.x) * S.aspect, p.y - w.y); };
    const size = d(h[9]) || 1e-6;
    let tight = 0;
    [8, 12, 16, 20].forEach(function (tip) { if (d(h[tip]) / size < 1.12) tight++; });
    return tight === 4;
  }
  const centre = function (h) {                   // all 21 points: fingers move more than the palm on a wrist flick
    let x = 0, y = 0;
    h.forEach(function (p) { x += p.x; y += p.y; });
    return { x: x / h.length, y: y / h.length };
  };
  /* Smoothing: follow fast moves closely, average out jitter when the hand is nearly still */
  function smoothHand(prev, cur) {
    if (!prev) return cur.map(function (p) { return { x: p.x, y: p.y }; });
    return cur.map(function (p, i) {
      const q = prev[i], speed = Math.hypot(p.x - q.x, p.y - q.y);
      const a = clamp(0.5 + speed * 14, 0.5, 0.95);
      return { x: q.x + (p.x - q.x) * a, y: q.y + (p.y - q.y) * a };
    });
  }

  /* raw: array of hands, each 21 landmarks {x, y} in camera coordinates. now: seconds. */
  function processHands(raw, now) {
    // Mirror so the picture behaves like a mirror, follow the way the picture is cropped to fill the stage,
    // then flip again for left-handed players
    const f = S.fit;
    const hands = raw.map(function (h) {
      return h.map(function (p) { const x = f.ox + (1 - p.x) * f.sx; return { x: S.lefty ? 1 - x : x, y: f.oy + p.y * f.sy }; });
    });
    if (hands.length >= 2) {
      const a = palm(hands[0]), b = palm(hands[1]);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.09) hands.length = 1;   // the tracker sometimes reports one hand twice
    }
    let fret = null, strumHand = null;
    if (hands.length >= 2) {
      const a = hands[0], b = hands[1];
      if (palm(a).x <= palm(b).x) { fret = a; strumHand = b; } else { fret = b; strumHand = a; }
    } else if (hands.length === 1) {
      // A lone hand keeps the job it had until it is clearly on the other side
      const x = palm(hands[0]).x, edge = S.lone === 'fret' ? S.split + 0.06 : S.lone === 'strum' ? S.split - 0.06 : S.split;
      S.lone = x < edge ? 'fret' : 'strum';
      if (S.lone === 'fret') fret = hands[0]; else strumHand = hands[0];
    } else {
      S.lone = null;
    }
    if (hands.length) S.seenAt = now;
    S.hands.fret = fret ? smoothHand(S.hands.fret, fret) : null;
    S.hands.strum = strumHand ? smoothHand(S.hands.strum, strumHand) : null;

    // Chord hand: which zone of the neck is the palm over? A little hysteresis stops flicker on the borders.
    if (S.hands.fret) {
      const p = palm(S.hands.fret), e = S.edges || FLAT_EDGES, cur = S.chord;
      let pos;
      if (p.x < e[0]) pos = (p.x - e[0]) / (e[1] - e[0]);
      else if (p.x >= e[5]) pos = 5 + (p.x - e[5]) / (e[5] - e[4]);
      else { let i = 0; while (i < 4 && p.x >= e[i + 1]) i++; pos = i + (p.x - e[i]) / (e[i + 1] - e[i]); }
      const want = (pos < cur - 0.12 || pos > cur + 1.12) ? clamp(Math.floor(pos), 0, CHORDS.length - 1) : cur;
      // ...and a new column has to show up in two frames running, so a one-frame glitch cannot change the chord
      if (want !== cur && want === S.wantChord) setChord(want);
      S.wantChord = want;
      if (isFist(S.hands.fret)) { S.fistFrames++; S.openFrames = 0; } else { S.openFrames++; S.fistFrames = 0; }
      if (!S.muted && S.fistFrames >= 5) { S.muted = true; damp(); syncPads(); }
      else if (S.muted && S.openFrames >= 2) { S.muted = false; syncPads(); }
    } else if (S.muted) {
      S.muted = false; syncPads();
    }

    // Strum hand: any fast stroke down or up plays, wherever the hand is. One strum per stroke.
    // The drawn strings follow the hand, so the stroke always passes across them.
    if (S.hands.strum) {
      const p = centre(S.hands.strum);
      if (S.strumY !== null && now > S.strumT && now - S.strumT < 0.4) {
        const dy = p.y - S.strumY, v = dy / (now - S.strumT);             // frame heights per second
        S.strumV = S.strumV * 0.4 + v * 0.6;
        const dir = v > 0.25 ? 1 : v < -0.25 ? -1 : 0, k = S.stroke;
        if (!dir) { k.dir = 0; k.travel = 0; k.fired = false; }
        else if (dir !== k.dir) { k.dir = dir; k.travel = Math.abs(dy); k.fired = false; }
        else k.travel += Math.abs(dy);
        const speed = Math.max(Math.abs(S.strumV), Math.abs(v) * 0.8);
        if (dir && !k.fired && k.travel >= 0.05 && speed > 0.6 && now - S.lastStrumAt > 0.09) {
          k.fired = true; S.lastStrumAt = now;
          strum(dir, (speed - 0.5) / 2.4, { x: clamp(palm(S.hands.strum).x, STRUM.x0, STRUM.x1), y: p.y });
        }
        S.lineY += (clamp(p.y, 0.2, 0.8) - S.lineY) * Math.min(1, (now - S.strumT) / 1.2);   // strings drift to where the hand plays
      }
      S.strumY = p.y; S.strumT = now;
    } else if (S.strumY !== null && now - S.strumT > 0.4) {
      // Fast hands blur and drop out for a frame or two: only forget the stroke after a real pause
      S.strumY = null; S.strumV = 0; S.stroke.dir = 0; S.stroke.travel = 0; S.stroke.fired = false;
    }
  }

  /* =====================================================================
     Camera + tracker
     ===================================================================== */
  const T = { vision: null, files: null, model: null, spare: null };
  async function makeTracker(delegate) {
    return T.vision.HandLandmarker.createFromOptions(T.files, {
      baseOptions: { modelAssetBuffer: new Uint8Array(T.model), delegate: delegate },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5
    });
  }
  async function loadTracker() {
    if (S.landmarker) return;
    if (!T.vision) T.vision = await import(CFG.lib);
    if (!T.files) T.files = await T.vision.FilesetResolver.forVisionTasks(CFG.wasm);
    if (!T.model) {
      for (const url of CFG.models) {
        try { const r = await fetch(url); if (r.ok) { T.model = await r.arrayBuffer(); break; } } catch (e) { /* try the next address */ }
      }
      if (!T.model) throw new Error('model download failed');
    }
    let lastErr = null;
    for (const delegate of CFG.delegates) {
      try {
        S.landmarker = await makeTracker(delegate);
        S.delegate = delegate;
        S.bench = { n: 0, sum: 0, tried: [delegate], first: null, busy: false };
        return;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('tracker failed to start');
  }
  /* Graphics-card tracking is usually fastest, but on some machines it is far slower than the processor.
     Time the first frames; if they are slow, try the other one and keep whichever wins. */
  function benchmark(ms) {
    const b = S.bench;
    if (!b || b.busy || b.done) return;
    if (++b.n <= 3) return;                                   // let it warm up
    b.sum += ms;
    if (b.n < 15) return;
    const avg = b.sum / (b.n - 3);
    if (!b.first) {
      const other = CFG.delegates.filter(function (d) { return b.tried.indexOf(d) < 0; })[0];
      if (avg < 45 || !other) { b.done = true; return; }
      b.busy = true;
      makeTracker(other).then(function (lm) {
        if (!S.landmarker || S.camera !== 'on') { lm.close(); b.done = true; return; }
        b.first = { lm: S.landmarker, delegate: S.delegate, avg: avg };
        S.landmarker = lm; S.delegate = other; b.tried.push(other);
        b.n = 0; b.sum = 0; b.busy = false;
      }).catch(function () { b.done = true; b.busy = false; });
    } else {
      if (avg > b.first.avg) {                                // the first one was faster after all
        const slow = S.landmarker;
        S.landmarker = b.first.lm; S.delegate = b.first.delegate;
        try { slow.close(); } catch (e) { /* ignore */ }
      } else {
        try { b.first.lm.close(); } catch (e) { /* ignore */ }
      }
      b.first = null; b.done = true;
    }
  }

  async function startCamera() {
    if (S.camera === 'starting' || S.camera === 'loading' || S.camera === 'on') return;
    audioInit();                                   // we are inside a click, so audio is allowed from here on
    strum(1, 0.45, null);                          // sound check: you should hear one strum as the camera starts
    S.error = '';
    setCamera('starting');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return fail(window.isSecureContext === false
        ? 'The camera only works on https or localhost. You can still play with the buttons and keys below.'
        : 'This browser cannot open a camera. You can still play with the buttons and keys below.');
    }
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
    } catch (e) {
      const n = e && e.name;
      return fail(n === 'NotAllowedError' || n === 'SecurityError'
        ? 'Camera access was blocked. Allow the camera in your browser’s site settings and press Start again, or play with the buttons and keys below.'
        : n === 'NotFoundError' || n === 'OverconstrainedError'
          ? 'No camera was found. You can still play with the buttons and keys below.'
          : n === 'NotReadableError'
            ? 'The camera is busy in another app. Close it and press Start again, or play with the buttons and keys below.'
            : 'The camera could not start. You can still play with the buttons and keys below.');
    }
    if (!S.mounted) return stopCamera();
    S.video.srcObject = S.stream;
    try { await S.video.play(); } catch (e) { /* autoplay quirks: the loop below still reads frames once playing */ }
    if (S.video.videoWidth) $('#jamStage').style.setProperty('--ar', (S.video.videoWidth / S.video.videoHeight).toFixed(4));
    setLive(true);                                 // the picture takes over the whole window
    setCamera('loading');
    try { await loadTracker(); }
    catch (e) {
      stopCamera();
      return fail('The hand tracker could not be downloaded (are you offline?). You can still play with the buttons and keys below.');
    }
    if (!S.mounted || !S.stream) return stopCamera();
    S.seenAt = performance.now() / 1000;
    setCamera('on');
    size();
    kick();
  }

  function stopCamera() {
    if (S.stream) S.stream.getTracks().forEach(function (t) { t.stop(); });
    S.stream = null;
    if (S.video) S.video.srcObject = null;
    S.hands.fret = S.hands.strum = null; S.strumY = null; S.muted = false; S.lowLight = false; S.fps = 0; S.lineY = STRUM.y;
    setLive(false);
    if (S.camera !== 'error') setCamera('off');
  }
  function fail(msg) { S.error = msg; setCamera('error'); }

  /* Live = the camera picture fills the window, with the guitar, the options and the status floating over it */
  function setLive(on) {
    if (on === S.live) return;
    S.live = on;
    document.body.classList.toggle('jam-live', on);
    document.documentElement.classList.toggle('jam-lock', on);
    if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () { /* already out */ });
    const full = $('#jamFull');
    if (full) full.hidden = !on || !S.root || !S.root.requestFullscreen;
    size();
    kick();
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen(); }
    else if (S.root && S.root.requestFullscreen) S.root.requestFullscreen().catch(function () { /* not allowed: stay in the window */ });
  }

  /* Low light makes tracking unreliable, so sample the picture now and then (a 32x18 thumbnail, local only) */
  let probe = null;
  function checkLight(now) {
    if (now - S.lightAt < 1) return;
    S.lightAt = now;
    try {
      if (!probe) { probe = document.createElement('canvas'); probe.width = 32; probe.height = 18; }
      const pc = probe.getContext('2d', { willReadFrequently: true });
      pc.drawImage(S.video, 0, 0, 32, 18);
      const px = pc.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      S.lowLight = sum / (px.length / 4) < 42;
    } catch (e) { S.lowLight = false; }
  }

  /* =====================================================================
     Drawing: chord zones, neon strings, particles, hand skeletons
     ===================================================================== */
  function size() {
    if (!S.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5), r = S.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    S.canvas.width = Math.round(r.width * dpr); S.canvas.height = Math.round(r.height * dpr);
    S.aspect = r.width / r.height;
    const vw = S.video ? S.video.videoWidth : 0, vh = S.video ? S.video.videoHeight : 0;
    if (vw && vh) {                                  // the video covers the stage, so part of it may be cropped
      const k = Math.max(r.width / vw, r.height / vh), dw = vw * k / r.width, dh = vh * k / r.height;
      S.fit = { sx: dw, ox: (1 - dw) / 2, sy: dh, oy: (1 - dh) / 2 };
    } else S.fit = { sx: 1, ox: 0, sy: 1, oy: 0 };
    if (S.view) S.view.resize();
  }
  const fx = function (x) { return S.lefty ? 1 - x : x; };   // layout x -> screen x

  function burst(at, vel) {
    if (reduceMotion.matches) return;
    const p = at || S.strumAt || { x: (STRUM.x0 + STRUM.x1) / 2, y: S.lineY };
    const n = Math.round(10 + vel * 22);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.1 + Math.random() * 0.5) * (0.5 + vel);
      S.particles.push({ x: p.x, y: p.y + (Math.random() - 0.5) * 0.12, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.15, life: 1, pink: i % 2 === 0 });
    }
    if (S.particles.length > 220) S.particles.splice(0, S.particles.length - 220);
  }

  function draw(nowSec, dt) {
    const g = S.g, W = S.canvas.width, H = S.canvas.height;
    if (!g || !W) return false;
    g.clearRect(0, 0, W, H);
    const u = Math.max(1, W / 900);
    let busy = false;
    const label = function (text, x, y) {         // text with a dark outline: readable over video, much cheaper than a shadow
      g.lineJoin = 'round'; g.lineWidth = 3 * u; g.strokeStyle = 'rgba(5, 4, 15, .85)';
      g.strokeText(text, x, y); g.fillText(text, x, y);
    };

    const amps = S.strings.map(function (st) { const age = nowSec - st.t0; return age >= 0 ? st.amp * Math.exp(-age * 3.4) : 0; });
    if (amps.some(function (a) { return a > 0.3; })) busy = true;
    g.textAlign = 'center';
    const view = S.view;
    if (view) {
      // The 3D guitar: it draws itself; here we add the chord names under the neck
      view.update({ chord: S.chord, frets: CHORDS[S.chord].frets, lefty: S.lefty, y: S.lineY });
      view.render(nowSec, amps, reduceMotion.matches);
      S.edges = view.zones().map(function (x) { return S.lefty ? 1 - x : x; });
      S.split = S.edges[5] + 0.035;
      const L = view.labels();
      S.strumAt = { x: S.lefty ? 1 - L.strum.x : L.strum.x, y: L.strum.y };
      const zpx = Math.abs(S.edges[1] - S.edges[0]) * W;                 // names shrink with the neck on narrow screens
      CHORDS.forEach(function (ch, i) {
        const p = L.zones[i], on = i === S.chord;
        g.fillStyle = on ? '#FFFFFF' : 'rgba(241, 246, 252, .92)';
        g.font = Math.min((on ? 27 : 18) * u, zpx * (on ? 0.42 : 0.32)) + 'px Michroma, "Arial Black", sans-serif';
        label(ch.name, p.x * W, p.y * H);
        if (zpx < 64 * u) return;
        g.font = 12 * u + 'px "Hanken Grotesk", sans-serif';
        label('key ' + (i + 1), p.x * W, p.y * H + 17 * u);
      });
      g.fillStyle = 'rgba(241, 246, 252, .95)'; g.font = 13 * u + 'px Michroma, sans-serif';
      label(S.muted || S.padMute ? 'Muted' : 'Strum hand', clamp(L.tag.x * W, 70 * u, W - 70 * u), clamp(L.tag.y * H, 20 * u, H - 12 * u));
    } else {
    S.edges = null; S.split = SPLIT; S.strumAt = null;
    // Chord zones
    const zw = (ZONE.x1 - ZONE.x0) / CHORDS.length;
    CHORDS.forEach(function (ch, i) {
      const xa = fx(ZONE.x0 + i * zw), xb = fx(ZONE.x0 + (i + 1) * zw), x = Math.min(xa, xb) * W, w = Math.abs(xb - xa) * W;
      const on = i === S.chord;
      g.fillStyle = on ? 'rgba(255, 61, 154, .26)' : 'rgba(12, 11, 36, .28)';
      g.fillRect(x + 2 * u, H * 0.06, w - 4 * u, H * 0.88);
      g.lineWidth = (on ? 3 : 1.5) * u;
      g.strokeStyle = on ? '#FF3D9A' : 'rgba(221, 232, 245, .55)';
      g.strokeRect(x + 2 * u, H * 0.06, w - 4 * u, H * 0.88);
      g.fillStyle = on ? '#FFFFFF' : 'rgba(241, 246, 252, .9)';
      g.font = (on ? 34 : 24) * u + 'px Michroma, "Arial Black", sans-serif';
      label(ch.name, x + w / 2, H * 0.9);
      g.font = 13 * u + 'px "Hanken Grotesk", sans-serif';
      label('key ' + (i + 1), x + w / 2, H * 0.13);
    });

    // Strings and strum line
    const sa = Math.min(fx(STRUM.x0), fx(STRUM.x1)) * W, sb = Math.max(fx(STRUM.x0), fx(STRUM.x1)) * W, gap = H * 0.03;
    g.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const age = nowSec - S.strings[k].t0, amp = amps[k];
      const y = S.lineY * H + (k - 2.5) * gap, color = k % 2 ? '#2CE6D6' : '#FF3D9A';
      g.beginPath();
      if (amp > 0.3 && !reduceMotion.matches) {
        for (let x = sa; x <= sb + 1; x += 8 * u) {
          const ph = (x - sa) / (sb - sa);
          const yy = y + Math.sin(Math.PI * ph) * Math.sin(age * (60 + k * 9)) * amp * u * 0.5;
          if (x === sa) g.moveTo(x, yy); else g.lineTo(x, yy);
        }
      } else { g.moveTo(sa, y); g.lineTo(sb, y); }
      g.strokeStyle = color;
      g.globalAlpha = Math.min(0.5, 0.16 + amp * 0.03); g.lineWidth = (7 + Math.min(8, amp * 0.5)) * u; g.stroke();   // glow
      g.globalAlpha = 1; g.lineWidth = (2.2 - k * 0.2 + Math.min(3, amp * 0.12)) * u; g.stroke();                    // string
    }
    g.fillStyle = 'rgba(241, 246, 252, .95)'; g.font = 13 * u + 'px Michroma, sans-serif';
    label(S.muted || S.padMute ? 'Muted' : 'Strum hand', (sa + sb) / 2, S.lineY * H - 4.2 * gap);
    }
    if (S.camera === 'on' && S.fps) {
      g.fillStyle = 'rgba(241, 246, 252, .95)'; g.font = 12 * u + 'px "Hanken Grotesk", sans-serif'; g.textAlign = 'right';
      label('tracking ' + Math.round(S.fps) + ' fps', W - 14 * u, (S.live ? 80 : 22) * (W / S.canvas.getBoundingClientRect().width));   // under the Stop button
      g.textAlign = 'center';
    }

    // Particles
    if (S.particles.length) {
      busy = true;
      S.particles = S.particles.filter(function (p) {
        p.life -= dt * 1.7; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.9 * dt;
        if (p.life <= 0) return false;
        g.globalAlpha = p.life;
        g.fillStyle = p.pink ? '#FF3D9A' : '#2CE6D6';
        g.beginPath(); g.arc(fx(p.x) * W, p.y * H, (2 + 3 * p.life) * u, 0, 6.3); g.fill();
        return true;
      });
      g.globalAlpha = 1;
    }

    // Hands
    [['fret', '#2CE6D6'], ['strum', '#FF3D9A']].forEach(function (pair) {
      const h = S.hands[pair[0]];
      if (!h) return;
      g.strokeStyle = 'rgba(241, 246, 252, .9)'; g.lineWidth = 2.5 * u;
      g.beginPath();
      CONNECTIONS.forEach(function (c) { g.moveTo(fx(h[c[0]].x) * W, h[c[0]].y * H); g.lineTo(fx(h[c[1]].x) * W, h[c[1]].y * H); });
      g.stroke();
      g.fillStyle = pair[1];
      h.forEach(function (p) { g.beginPath(); g.arc(fx(p.x) * W, p.y * H, 4.5 * u, 0, 6.3); g.fill(); });
      const c = palm(h);
      g.strokeStyle = pair[1]; g.lineWidth = 3 * u;
      g.beginPath(); g.arc(fx(c.x) * W, c.y * H, 16 * u, 0, 6.3); g.stroke();
    });
    return busy;
  }

  /* One loop: read a camera frame, track, update gestures, draw. It sleeps when nothing is moving. */
  let lastFrame = 0;
  function frame(ts) {
    S.raf = 0;
    if (!S.mounted) return;
    const now = ts / 1000, dt = Math.min(0.05, lastFrame ? now - lastFrame : 0.016);
    lastFrame = now;
    if (S.camera === 'on' && S.landmarker && S.video.readyState >= 2) {
      if (S.video.currentTime !== S.lastVideoTime) {
        S.lastVideoTime = S.video.currentTime;
        let res = null;
        S.stamp = Math.max(S.stamp + 1, performance.now());           // the tracker needs strictly increasing times
        const t0 = performance.now();
        try { res = S.landmarker.detectForVideo(S.video, S.stamp); } catch (e) { res = null; }
        const t1 = performance.now();
        S.ms = S.ms ? S.ms * 0.9 + (t1 - t0) * 0.1 : t1 - t0;
        if (S.lastDetectAt) { const f = 1000 / Math.max(1, t1 - S.lastDetectAt); S.fps = S.fps ? S.fps * 0.9 + f * 0.1 : f; }
        S.lastDetectAt = t1;
        benchmark(t1 - t0);
        processHands(res && res.landmarks ? res.landmarks : [], t1 / 1000);
        checkLight(now);
      }
      updateStatus(now);
    }
    const busy = draw(now, dt);
    if (S.camera === 'on' || busy) kick(); else lastFrame = 0;
  }
  function kick() { if (S.mounted && !S.raf) S.raf = requestAnimationFrame(frame); }

  /* =====================================================================
     Page: markup, buttons, keys, status
     ===================================================================== */
  const $ = function (sel) { return S.root ? S.root.querySelector(sel) : null; };

  function html() {
    return '<section class="jam" id="jam">' +
      '<header class="jam__head"><div><h2 id="viewTitle">Air Jam</h2>' +
      '<p class="muted">Hold one hand over the guitar’s neck to pick the chord. Flick your other hand down or up over the body, fast, to strum.</p></div>' +
      '<button type="button" class="bubble bubble--pink" id="jamStart">Start camera</button></header>' +
      '<div class="jam__stage" id="jamStage"><video id="jamVideo" playsinline muted aria-hidden="true"></video>' +
      '<canvas id="jamGL" aria-hidden="true"></canvas><canvas id="jamCanvas" aria-hidden="true"></canvas>' +
      '<p class="jam__idle" id="jamIdle">Camera is off. Press Start camera, or play with the buttons and keys below.</p></div>' +
      '<p class="jam__status" id="jamStatus" role="status" aria-live="polite"></p>' +
      '<div class="jam__controls">' +
        '<div class="jam__group jam__pads" role="group" aria-label="Chord">' + CHORDS.map(function (c, i) {
          return '<button type="button" class="jam__pad" data-chord="' + i + '" aria-pressed="' + (i === S.chord) + '"><b>' + c.name + '</b><kbd>' + (i + 1) + '</kbd></button>';
        }).join('') + '</div>' +
        '<button type="button" class="bubble bubble--pink jam__strum" id="jamStrum">Strum <kbd>Space</kbd></button>' +
        '<div class="jam__opts">' +
          '<div class="jam__group" role="group" aria-label="Guitar">' +
            '<button type="button" class="chip" id="jamAcoustic" aria-pressed="' + (S.guitar === 'acoustic') + '">Acoustic</button>' +
            '<button type="button" class="chip" id="jamElectric" aria-pressed="' + (S.guitar === 'electric') + '">Electric</button>' +
          '</div>' +
          '<div class="jam__group" role="group" aria-label="Sound">' +
            '<button type="button" class="chip" id="jamClean" aria-pressed="' + !S.dist + '">Clean</button>' +
            '<button type="button" class="chip" id="jamDist" aria-pressed="' + S.dist + '">Distortion</button>' +
            '<button type="button" class="chip" id="jamMute" aria-pressed="' + S.padMute + '">Mute <kbd>M</kbd></button>' +
            '<button type="button" class="chip" id="jamLefty" aria-pressed="' + S.lefty + '">Left-handed</button>' +
            '<button type="button" class="chip" id="jamFull" hidden>Full screen</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<section class="about jam__how"><h3>How it works</h3><ol>' +
        '<li><b>Guitar.</b> Pick the acoustic or the electric. Each is a 3D model built in code, and each has its own sound; the electric adds a distortion switch.</li>' +
        '<li><b>Chord hand.</b> Hold one hand up over the neck. The neck is split into five zones, and the one your palm is over sets the chord: ' + CHORDS.map(function (c) { return c.name; }).join(', ') + '. The dots on the frets show how that chord is really fingered.</li>' +
        '<li><b>Strum hand.</b> Over the body, flick your other hand quickly down or up, like hitting strings. Any fast stroke plays, wherever your hand is; slow moves are ignored. A faster stroke is louder and brighter.</li>' +
        '<li><b>Mute.</b> Squeeze your chord hand into a tight fist to stop the strings. Strumming while it is closed gives a muted “chk”.</li>' +
        '<li><b>Sound.</b> Each string is a Karplus-Strong model: a burst of noise looping through a short delay, synthesized live. The acoustic adds the resonance of a hollow body; the electric sounds like a pickup, and its distortion adds a soft-clipping stage and a speaker-style filter.</li>' +
        '<li><b>Privacy.</b> Hand tracking is MediaPipe Hand Landmarker running in your browser. Video stays on your device: nothing is recorded, stored or uploaded.</li>' +
        '<li><b>Full window.</b> While the camera is on, the picture fills the window. Stop camera or Esc brings the page back.</li>' +
        '<li><b>No camera?</b> The chord buttons, the Strum button, keys 1 to 5, Space and M do everything the camera does.</li>' +
      '</ol></section></section>';
  }

  function setStatus(msg) {
    if (msg === S.status) return;
    S.status = msg;
    const el = $('#jamStatus');
    if (el) el.textContent = msg;
  }
  function setCamera(mode) {
    S.camera = mode;
    const btn = $('#jamStart'), idle = $('#jamIdle'), stage = $('#jamStage');
    if (btn) { btn.textContent = mode === 'on' || mode === 'loading' || mode === 'starting' ? 'Stop camera' : 'Start camera'; }
    if (stage) stage.dataset.camera = mode;
    if (idle) idle.hidden = mode === 'on' || mode === 'loading';
    if (idle && mode !== 'on') idle.textContent = mode === 'error' ? S.error : 'Camera is off. Press Start camera, or play with the buttons and keys below.';
    setStatus(mode === 'starting' ? 'Asking for the camera…'
      : mode === 'loading' ? 'Loading the hand tracker (a few seconds the first time)…'
      : mode === 'error' ? S.error
      : mode === 'on' ? 'Camera on. Hold both hands up so the camera can see them.'
      : 'Chord ' + CHORDS[S.chord].name + '. Press Space or Strum to play.');
    kick();
  }
  function updateStatus(now) {
    const lost = now - S.seenAt > 0.7, both = S.hands.fret && S.hands.strum;
    setStatus(lost && S.lowLight ? 'It is too dark to see your hands. Turn on a light or face a window.'
      : lost ? 'No hands in view. Hold them up, about an arm’s length from the camera.'
      : S.muted ? 'Muted, because your chord hand is a fist. Open it to let the strings ring.'
      : !both && S.hands.fret ? 'Chord ' + CHORDS[S.chord].name + '. Bring in your other hand to strum.'
      : !both ? 'Strumming ' + CHORDS[S.chord].name + '. Bring in your other hand to change chords.'
      : S.lowLight ? 'Chord ' + CHORDS[S.chord].name + '. The picture is dark, so tracking may be jumpy.'
      : 'Chord ' + CHORDS[S.chord].name + '. Flick your strum hand down or up to play.');
  }

  function syncPads() {
    if (!S.root) return;
    S.root.querySelectorAll('.jam__pad').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.chord) === S.chord)); });
    const set = function (id, on) { const b = $(id); if (b) b.setAttribute('aria-pressed', String(on)); };
    set('#jamClean', !S.dist); set('#jamDist', S.dist); set('#jamMute', S.padMute || S.muted); set('#jamLefty', S.lefty);
    set('#jamAcoustic', S.guitar === 'acoustic'); set('#jamElectric', S.guitar === 'electric');
    ['#jamClean', '#jamDist'].forEach(function (id) { const b = $(id); if (b) b.hidden = S.guitar !== 'electric'; });   // only the electric has an amp
  }
  function setChord(i) {
    if (i === S.chord || !CHORDS[i]) return;
    S.chord = i;
    syncPads();
    if (S.camera !== 'on') setStatus('Chord ' + CHORDS[i].name + '. Press Space or Strum to play.');
    kick();
  }
  function setGuitar(type) {
    if (type !== S.guitar) {
      S.guitar = type;
      saved('jam-guitar', type);
      if (S.view) S.view.setType(type);
      damp();
    }
    audioInit(); applyTone(); syncPads();
    strum(1, 0.5, null);                          // let them hear it
    if (S.camera !== 'on') setStatus((type === 'acoustic' ? 'Acoustic' : 'Electric') + ' guitar. Chord ' + CHORDS[S.chord].name + '. Press Space or Strum to play.');
  }
  function manualStrum() {
    strum(-S.lastDir || 1, 0.7, null);            // alternate down and up, like a real strumming hand
  }
  function toggleMute() {
    S.padMute = !S.padMute;
    if (S.padMute) damp();
    syncPads(); kick();
  }

  function onClick(e) {
    const t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    if (t.dataset.chord) { audioInit(); setChord(Number(t.dataset.chord)); return; }
    switch (t.id) {
      case 'jamStart': if (S.camera === 'on' || S.camera === 'loading' || S.camera === 'starting') stopCamera(); else startCamera(); break;
      case 'jamStrum': manualStrum(); break;
      case 'jamAcoustic': setGuitar('acoustic'); break;
      case 'jamElectric': setGuitar('electric'); break;
      case 'jamFull': toggleFullscreen(); break;
      case 'jamClean': S.dist = false; audioInit(); applyTone(); syncPads(); break;
      case 'jamDist': S.dist = true; audioInit(); applyTone(); syncPads(); break;
      case 'jamMute': toggleMute(); break;
      case 'jamLefty': S.lefty = !S.lefty; S.hands.fret = S.hands.strum = null; syncPads(); kick(); break;
    }
  }

  /* Returns true when the key was used. Called by the app's key handler while this page is open. */
  function handleKey(e) {
    if (!S.mounted || e.ctrlKey || e.metaKey || e.altKey) return false;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (e.key >= '1' && e.key <= String(CHORDS.length)) { audioInit(); setChord(Number(e.key) - 1); return true; }
    if (e.key === 'm' || e.key === 'M') { toggleMute(); return true; }
    if (e.key === 'Escape' && S.live && !document.fullscreenElement) { stopCamera(); return true; }
    if (e.key === ' ' || e.code === 'Space') {
      // Space strums from anywhere on the page except on the other buttons, where it keeps its usual job
      const btn = e.target.closest ? e.target.closest('button, a') : null;
      if (btn && !btn.classList.contains('jam__pad') && btn.id !== 'jamStrum') return false;
      e.preventDefault();
      if (!e.repeat) manualStrum();
      return true;
    }
    return false;
  }

  function mount(root) {
    const node = root.querySelector('#jam');
    if (!node) return;
    if (S.mounted) unmount();
    S.root = node; S.mounted = true;
    S.video = $('#jamVideo'); S.canvas = $('#jamCanvas'); S.g = S.canvas.getContext ? S.canvas.getContext('2d') : null;
    S.gl = $('#jamGL');
    S.status = '';
    node.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
    if (window.ResizeObserver) { S.ro = new ResizeObserver(onResize); S.ro.observe($('#jamStage')); }
    // The 3D guitar loads in the background; until it arrives (or if it cannot), the flat drawing is used
    if (window.PulseGuitar3D && S.gl) {
      const token = ++S.viewToken;
      window.PulseGuitar3D.load().then(function () {
        if (!S.mounted || token !== S.viewToken) return;
        try {
          S.view = window.PulseGuitar3D.create(S.gl);
          S.view.setType(S.guitar);
          S.view.resize();
        } catch (e) { S.view = null; }
        kick();
      }).catch(function () { /* no 3D here: keep the flat drawing */ });
    }
    setCamera('off');
    syncPads();
    size();
    kick();
  }
  function unmount() {
    if (!S.mounted) return;
    S.camera = 'off';
    stopCamera();
    damp();
    cancelAnimationFrame(S.raf); S.raf = 0;
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onResize);
    if (S.ro) { S.ro.disconnect(); S.ro = null; }
    S.viewToken++;
    if (S.view) { try { S.view.dispose(); } catch (e) { /* context already gone */ } S.view = null; }
    S.edges = null; S.split = SPLIT; S.strumAt = null;
    S.mounted = false; S.root = null; S.video = null; S.canvas = null; S.g = null; S.gl = null;
  }
  function onResize() { size(); kick(); }

  // If the tab is hidden, let go of the camera rather than keep its light on
  document.addEventListener('visibilitychange', function () { if (document.hidden && S.camera === 'on') stopCamera(); });

  window.PulseJam = {
    html: html, mount: mount, unmount: unmount, handleKey: handleKey,
    // Test hooks: feed synthetic hand landmarks and read the state back
    _feed: function (hands, now) { processHands(hands, now); kick(); },
    _state: function () { return { chord: CHORDS[S.chord].name, muted: S.muted, padMute: S.padMute, dist: S.dist, lefty: S.lefty, guitar: S.guitar, view: S.view ? S.view.type() : null, live: S.live, edges: S.edges || FLAT_EDGES, split: S.split, fit: S.fit, delegate: S.delegate, ms: Math.round(S.ms), fps: Math.round(S.fps), strums: S.strums, last: S.last, camera: S.camera, status: S.status, notes: Object.keys(A.bufs).length, ctx: A.ctx ? A.ctx.state : 'none' }; },
    _audio: function () { return A; },
    _particles: function () { return S.particles.length; },
    _bench: function () { return S.bench; },
    _hands: function () { return { fret: S.hands.fret ? palm(S.hands.fret) : null, strum: S.hands.strum ? palm(S.hands.strum) : null, v: S.strumV }; }
  };
})();
