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
  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  const S = {
    mounted: false, root: null, video: null, canvas: null, g: null,
    chord: 0, muted: false, padMute: false, dist: false, lefty: false,
    camera: 'off',            // off | starting | loading | on | error
    error: '', stream: null, landmarker: null, raf: 0, lastVideoTime: -1, stamp: 0,
    hands: { fret: null, strum: null },       // smoothed landmark sets
    seenAt: 0, lowLight: false, lightAt: 0,
    strumY: null, strumT: 0, strumV: 0, lastStrumAt: 0, lastDir: -1,
    fistFrames: 0, openFrames: 0, lone: null, wantChord: -1,
    strings: [0, 1, 2, 3, 4, 5].map(function () { return { amp: 0, t0: 0 }; }),
    particles: [], strums: 0, last: null, status: ''
  };

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
    // Clean: straight through, with the fizz rolled off
    A.cleanG = ctx.createGain();
    const cleanLp = ctx.createBiquadFilter(); cleanLp.type = 'lowpass'; cleanLp.frequency.value = 6500;
    A.input.connect(cleanLp); cleanLp.connect(A.cleanG); A.cleanG.connect(master);
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
    A.cleanG.connect(send); A.distG.connect(send); send.connect(rev); rev.connect(master);

    // Render every note the five chords need (about 40 ms of work, once)
    CHORDS.forEach(function (ch) {
      ch.frets.forEach(function (f, s) { if (f >= 0 && !A.bufs[TUNING[s] + f]) A.bufs[TUNING[s] + f] = pluckBuffer(TUNING[s] + f); });
    });
    applyTone();
    return true;
  }

  function applyTone() {
    if (!A.ctx) return;
    const t = A.ctx.currentTime;
    A.cleanG.gain.setTargetAtTime(S.dist ? 0 : 1, t, 0.02);
    A.distG.gain.setTargetAtTime(S.dist ? 1 : 0, t, 0.02);
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
  function isFist(h) {
    const w = h[0], d = function (p) { return Math.hypot((p.x - w.x) * 1.6, p.y - w.y); };  // 1.6 ~ frame aspect
    let curled = 0;
    [[8, 6], [12, 10], [16, 14], [20, 18]].forEach(function (f) { if (d(h[f[0]]) < d(h[f[1]]) * 1.05) curled++; });
    return curled >= 3;
  }
  /* Smoothing: follow fast moves closely, average out jitter when the hand is nearly still */
  function smoothHand(prev, cur) {
    if (!prev) return cur.map(function (p) { return { x: p.x, y: p.y }; });
    return cur.map(function (p, i) {
      const q = prev[i], speed = Math.hypot(p.x - q.x, p.y - q.y);
      const a = clamp(0.35 + speed * 14, 0.35, 0.92);
      return { x: q.x + (p.x - q.x) * a, y: q.y + (p.y - q.y) * a };
    });
  }

  /* raw: array of hands, each 21 landmarks {x, y} in camera coordinates. now: seconds. */
  function processHands(raw, now) {
    // Mirror so the picture behaves like a mirror, then flip again for left-handed players
    const hands = raw.map(function (h) {
      return h.map(function (p) { const mx = 1 - p.x; return { x: S.lefty ? 1 - mx : mx, y: p.y }; });
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
      const x = palm(hands[0]).x, edge = S.lone === 'fret' ? SPLIT + 0.06 : S.lone === 'strum' ? SPLIT - 0.06 : SPLIT;
      S.lone = x < edge ? 'fret' : 'strum';
      if (S.lone === 'fret') fret = hands[0]; else strumHand = hands[0];
    } else {
      S.lone = null;
    }
    if (hands.length) S.seenAt = now;
    S.hands.fret = fret ? smoothHand(S.hands.fret, fret) : null;
    S.hands.strum = strumHand ? smoothHand(S.hands.strum, strumHand) : null;

    // Chord hand: which column is the palm in? A little hysteresis stops flicker on the borders.
    if (S.hands.fret) {
      const p = palm(S.hands.fret), w = (ZONE.x1 - ZONE.x0) / CHORDS.length;
      const pos = (p.x - ZONE.x0) / w, cur = S.chord;
      const want = (pos < cur - 0.12 || pos > cur + 1.12) ? clamp(Math.floor(pos), 0, CHORDS.length - 1) : cur;
      // ...and a new column has to show up in two frames running, so a one-frame glitch cannot change the chord
      if (want !== cur && want === S.wantChord) setChord(want);
      S.wantChord = want;
      if (isFist(S.hands.fret)) { S.fistFrames++; S.openFrames = 0; } else { S.openFrames++; S.fistFrames = 0; }
      if (!S.muted && S.fistFrames >= 3) { S.muted = true; damp(); syncPads(); }
      else if (S.muted && S.openFrames >= 3) { S.muted = false; syncPads(); }
    } else if (S.muted) {
      S.muted = false; syncPads();
    }

    // Strum hand: a fast pass across the strum line, in either direction
    if (S.hands.strum) {
      const p = palm(S.hands.strum);
      if (S.strumY !== null && now > S.strumT) {
        const dt = now - S.strumT, v = (p.y - S.strumY) / dt;          // frame heights per second
        S.strumV = S.strumV * 0.4 + v * 0.6;
        const crossedDown = S.strumY < STRUM.y && p.y >= STRUM.y, crossedUp = S.strumY > STRUM.y && p.y <= STRUM.y;
        if ((crossedDown || crossedUp) && Math.abs(S.strumV) > 0.55 && now - S.lastStrumAt > 0.11) {
          S.lastStrumAt = now;
          strum(crossedDown ? 1 : -1, (Math.abs(S.strumV) - 0.45) / 2.6, { x: clamp(p.x, STRUM.x0, STRUM.x1), y: STRUM.y });
        }
      }
      S.strumY = p.y; S.strumT = now;
    } else {
      S.strumY = null; S.strumV = 0;
    }
  }

  /* =====================================================================
     Camera + tracker
     ===================================================================== */
  async function loadTracker() {
    if (S.landmarker) return;
    const vision = await import(CFG.lib);
    const files = await vision.FilesetResolver.forVisionTasks(CFG.wasm);
    let lastErr = null;
    for (const model of CFG.models) {
      for (const delegate of CFG.delegates) {
        try {
          S.landmarker = await vision.HandLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetPath: model, delegate: delegate },
            runningMode: 'VIDEO', numHands: 2,
            minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5
          });
          return;
        } catch (e) { lastErr = e; }
      }
    }
    throw lastErr || new Error('tracker failed to load');
  }

  async function startCamera() {
    if (S.camera === 'starting' || S.camera === 'loading' || S.camera === 'on') return;
    audioInit();                                   // we are inside a click, so audio is allowed from here on
    S.error = '';
    setCamera('starting');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return fail(window.isSecureContext === false
        ? 'The camera only works on https or localhost. You can still play with the buttons and keys below.'
        : 'This browser cannot open a camera. You can still play with the buttons and keys below.');
    }
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } }, audio: false });
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
    if (S.video.videoWidth) $('#jamStage').style.setProperty('--ar', (S.video.videoWidth / S.video.videoHeight).toFixed(4));   // match the camera's shape
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
    S.hands.fret = S.hands.strum = null; S.strumY = null; S.muted = false; S.lowLight = false;
    if (S.camera !== 'error') setCamera('off');
  }
  function fail(msg) { S.error = msg; setCamera('error'); }

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
    const dpr = Math.min(window.devicePixelRatio || 1, 2), r = S.canvas.getBoundingClientRect();
    if (!r.width) return;
    S.canvas.width = Math.round(r.width * dpr); S.canvas.height = Math.round(r.height * dpr);
  }
  const fx = function (x) { return S.lefty ? 1 - x : x; };   // layout x -> screen x

  function burst(at, vel) {
    if (reduceMotion.matches) return;
    const p = at || { x: (STRUM.x0 + STRUM.x1) / 2, y: STRUM.y };
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

    // Chord zones
    const zw = (ZONE.x1 - ZONE.x0) / CHORDS.length;
    g.textAlign = 'center';
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
      g.shadowColor = '#05040F'; g.shadowBlur = 8 * u;
      g.fillText(ch.name, x + w / 2, H * 0.9);
      g.font = 13 * u + 'px "Hanken Grotesk", sans-serif';
      g.fillText('key ' + (i + 1), x + w / 2, H * 0.13);
      g.shadowBlur = 0;
    });

    // Strings and strum line
    const sa = Math.min(fx(STRUM.x0), fx(STRUM.x1)) * W, sb = Math.max(fx(STRUM.x0), fx(STRUM.x1)) * W, gap = H * 0.03;
    g.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const st = S.strings[k], age = nowSec - st.t0;
      const amp = age >= 0 ? st.amp * Math.exp(-age * 3.4) : 0;
      if (amp > 0.3) busy = true;
      const y = STRUM.y * H + (k - 2.5) * gap;
      g.strokeStyle = k % 2 ? '#2CE6D6' : '#FF3D9A';
      g.shadowColor = g.strokeStyle; g.shadowBlur = (6 + amp) * u;
      g.lineWidth = (2.2 - k * 0.2 + Math.min(3, amp * 0.12)) * u;
      g.beginPath();
      if (amp > 0.3 && !reduceMotion.matches) {
        for (let x = sa; x <= sb + 1; x += 6 * u) {
          const ph = (x - sa) / (sb - sa);
          const yy = y + Math.sin(Math.PI * ph) * Math.sin(age * (60 + k * 9)) * amp * u * 0.5;
          if (x === sa) g.moveTo(x, yy); else g.lineTo(x, yy);
        }
      } else { g.moveTo(sa, y); g.lineTo(sb, y); }
      g.stroke();
    }
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(241, 246, 252, .95)'; g.font = 13 * u + 'px Michroma, sans-serif';
    g.shadowColor = '#05040F'; g.shadowBlur = 8 * u;
    g.fillText(S.muted || S.padMute ? 'MUTED' : 'STRUM', (sa + sb) / 2, STRUM.y * H - 4.2 * gap);
    g.shadowBlur = 0;

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
        try { res = S.landmarker.detectForVideo(S.video, S.stamp); } catch (e) { res = null; }
        processHands(res && res.landmarks ? res.landmarks : [], now);
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
      '<p class="muted">Air guitar with your webcam. One hand picks the chord, the other strums.</p></div>' +
      '<button type="button" class="bubble bubble--pink" id="jamStart">Start camera</button></header>' +
      '<div class="jam__stage" id="jamStage"><video id="jamVideo" playsinline muted aria-hidden="true"></video>' +
      '<canvas id="jamCanvas" aria-hidden="true"></canvas>' +
      '<p class="jam__idle" id="jamIdle">Camera is off. Press Start camera, or play with the buttons and keys below.</p></div>' +
      '<p class="jam__status" id="jamStatus" role="status" aria-live="polite"></p>' +
      '<div class="jam__controls">' +
        '<div class="jam__group" role="group" aria-label="Chord">' + CHORDS.map(function (c, i) {
          return '<button type="button" class="jam__pad" data-chord="' + i + '" aria-pressed="' + (i === S.chord) + '"><b>' + c.name + '</b><kbd>' + (i + 1) + '</kbd></button>';
        }).join('') + '</div>' +
        '<button type="button" class="bubble bubble--pink jam__strum" id="jamStrum">Strum <kbd>Space</kbd></button>' +
        '<div class="jam__group" role="group" aria-label="Sound">' +
          '<button type="button" class="chip" id="jamClean" aria-pressed="' + !S.dist + '">Clean</button>' +
          '<button type="button" class="chip" id="jamDist" aria-pressed="' + S.dist + '">Distortion</button>' +
          '<button type="button" class="chip" id="jamMute" aria-pressed="' + S.padMute + '">Mute <kbd>M</kbd></button>' +
          '<button type="button" class="chip" id="jamLefty" aria-pressed="' + S.lefty + '">Left-handed</button>' +
        '</div>' +
      '</div>' +
      '<section class="about jam__how"><h3>How it works</h3><ol>' +
        '<li><b>Chord hand.</b> Hold one hand up on the chord side of the picture. The column your palm is in sets the chord: ' + CHORDS.map(function (c) { return c.name; }).join(', ') + '.</li>' +
        '<li><b>Strum hand.</b> Sweep your other hand quickly down or up across the glowing strings. A faster sweep is louder and brighter; down and up strums play the strings in opposite order.</li>' +
        '<li><b>Mute.</b> Close your chord hand into a fist to stop the strings. Strumming while it is closed gives a muted “chk”.</li>' +
        '<li><b>Sound.</b> Each string is a Karplus-Strong model: a burst of noise looping through a short delay, synthesized live. Distortion adds a soft-clipping stage and a speaker-style filter.</li>' +
        '<li><b>Privacy.</b> Hand tracking is MediaPipe Hand Landmarker running in your browser. Video stays on your device: nothing is recorded, stored or uploaded.</li>' +
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
      : mode === 'on' ? 'Camera on. Show your hands.'
      : 'Chord ' + CHORDS[S.chord].name + '. Press Space or Strum to play.');
    kick();
  }
  function updateStatus(now) {
    const lost = now - S.seenAt > 0.7, both = S.hands.fret && S.hands.strum;
    setStatus(lost && S.lowLight ? 'It is too dark to see your hands. Turn on a light or face a window.'
      : lost ? 'No hands in view. Hold them up, about an arm’s length from the camera.'
      : S.muted ? 'Muted: open your chord hand to let the strings ring.'
      : !both && S.hands.fret ? 'Chord ' + CHORDS[S.chord].name + '. Bring in your other hand to strum.'
      : !both ? 'Strumming ' + CHORDS[S.chord].name + '. Bring in your other hand to change chords.'
      : S.lowLight ? 'Chord ' + CHORDS[S.chord].name + '. The picture is dark, so tracking may be jumpy.'
      : 'Chord ' + CHORDS[S.chord].name + '. Sweep across the strings to strum.');
  }

  function syncPads() {
    if (!S.root) return;
    S.root.querySelectorAll('.jam__pad').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.chord) === S.chord)); });
    const set = function (id, on) { const b = $(id); if (b) b.setAttribute('aria-pressed', String(on)); };
    set('#jamClean', !S.dist); set('#jamDist', S.dist); set('#jamMute', S.padMute || S.muted); set('#jamLefty', S.lefty);
  }
  function setChord(i) {
    if (i === S.chord || !CHORDS[i]) return;
    S.chord = i;
    syncPads();
    if (S.camera !== 'on') setStatus('Chord ' + CHORDS[i].name + '. Press Space or Strum to play.');
    kick();
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
    S.status = '';
    node.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);
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
    S.mounted = false; S.root = null; S.video = null; S.canvas = null; S.g = null;
  }
  function onResize() { size(); kick(); }

  // If the tab is hidden, let go of the camera rather than keep its light on
  document.addEventListener('visibilitychange', function () { if (document.hidden && S.camera === 'on') stopCamera(); });

  window.PulseJam = {
    html: html, mount: mount, unmount: unmount, handleKey: handleKey,
    // Test hooks: feed synthetic hand landmarks and read the state back
    _feed: function (hands, now) { processHands(hands, now); kick(); },
    _state: function () { return { chord: CHORDS[S.chord].name, muted: S.muted, padMute: S.padMute, dist: S.dist, lefty: S.lefty, strums: S.strums, last: S.last, camera: S.camera, status: S.status, notes: Object.keys(A.bufs).length, ctx: A.ctx ? A.ctx.state : 'none' }; },
    _audio: function () { return A; },
    _particles: function () { return S.particles.length; },
    _hands: function () { return { fret: S.hands.fret ? palm(S.hands.fret) : null, strum: S.hands.strum ? palm(S.hands.strum) : null, v: S.strumV }; }
  };
})();
