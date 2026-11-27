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
  const EXT = { xMin: -0.27, xMax: 1.335, bodyHalf: 0.3, pick: 0.88, z0: -0.03, zw: 0.146 };   // guitar sizes until the model reports its own
  const ext = function () { return S.view ? S.view.extents() : EXT; };
  const turn = function (a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
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
    strumAt: null,                            // where the strumming spot is on screen (for sparks)
    chordSide: 0, shown: { fret: null, strum: null }, shownAt: { fret: -9, strum: -9 },
    pose: null, poseT: 0, heldAt: -9, gripAt: -9, lastFret: null, handSize: 0, mask: [], maskAt: -9,   // where the guitar is: it follows the hands
    lastDrawTs: 0, lastDetectTs: 0, lastTs: 0, busy: false, fresh: false, slowFor: 0, ratio: 1, budget: 1280,
    drawMs: 0, gapMax: 0, diag: [], sampleAt: 0, startAt: 0,
    fit: { sx: 1, ox: 0, sy: 1, oy: 0 },      // how the camera picture is scaled to cover the stage
    live: false, solo: null, moved: [], timer: 0, next: 0,
    camera: 'off',            // off | starting | loading | on | error
    error: '', aspect: 1.33, stream: null, landmarker: null, raf: 0, lastVideoTime: -1, stamp: 0,
    hands: { fret: null, strum: null },       // smoothed landmark sets
    seenAt: 0, lowLight: false, lightAt: 0,
    strumX: 0, strumY: null, strumT: 0, strumV: 0, lastStrumAt: 0, lastDir: -1,
    fistFrames: 0, openFrames: 0, lone: null, wantChord: -1,
    zig: { t: 0, dir: 0, lo: 0, hi: 0, loT: 0, hiT: 0, prev: 0, still: false }, rh: { times: [], dir: 0, vel: 0.5, last: 0, fills: 0, P: 0 }, filled: 0, lineY: STRUM.y,
    ms: 0, fps: 0, lastDetectAt: 0, delegate: '', bench: null,
    strings: [0, 1, 2, 3, 4, 5].map(function () { return { amp: 0, t0: 0 }; }),
    particles: [], strums: 0, last: null, status: '', statusAt: 0, pr: 1
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
    let ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }   // shortest delay between a stroke and its sound
    A.ctx = ctx;
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
    let k = 0, ringing = 0;
    for (let n = 0; n < 6; n++) {
      const s = dir > 0 ? n : 5 - n, fret = chord.frets[s];
      if (fret < 0) continue;
      const when = t + k * stagger;
      const old = A.voices[s];
      if (old) { old.g.gain.setTargetAtTime(0, when, 0.008); try { old.src.stop(when + 0.1); } catch (e) { /* already stopped */ } }
      const src = ctx.createBufferSource(); src.buffer = A.bufs[TUNING[s] + fret];
      const g = ctx.createGain();
      ringing++;
      src.onended = function () {                  // take finished notes out of the audio graph so it never piles up
        try { src.disconnect(); g.disconnect(); } catch (e) { /* already gone */ }
        if (--ringing === 0) { try { tone.disconnect(); } catch (e) { /* already gone */ } }
      };
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
  /* Where the guitar sits when nobody is holding it: centred, neck up a little, sized to the picture */
  function restPose() {
    const e = ext(), ang = 0.12;
    const L = Math.min(0.93 * S.aspect / (e.xMax - e.xMin), 0.56 / (2 * e.bodyHalf), 0.95);
    const off = (e.pick - (e.xMin + e.xMax) / 2) * L;
    return { x: 0.5 + off * Math.cos(ang) / S.aspect, y: 0.52 + off * Math.sin(ang), ang: ang, L: L };
  }
  const handSpan = function (h) {                 // palm length or palm width, whichever is less foreshortened
    const d = function (a, b) { return Math.hypot((h[a].x - h[b].x) * S.aspect, h[a].y - h[b].y); };
    return Math.max(d(0, 9), 1.25 * d(5, 17));
  };

  /* The guitar is held by the two hands. Its body sits at the strumming hand, its neck points at the chord hand,
     and its size comes from the size of the hands, so it looks the same size as the player would hold.
     P.x, P.y: the strumming spot on the strings (0..1 across and down). P.ang: which way the strings run on screen.
     P.L: the scale length in picture heights. All in "layout" coordinates (left-handed mode is mirrored later). */
  function holdGuitar(now) {
    if (!S.pose) S.pose = restPose();
    const P = S.pose, asp = S.aspect, dt = clamp(now - S.poseT, 0.001, 0.25);
    S.poseT = now;
    if (now - S.heldAt > 1.5) S.gripAt = now;       // just picked up
    const ease = function (tau) { return 1 - Math.exp(-dt / tau); };
    let ux = Math.cos(P.ang), uy = Math.sin(P.ang);
    if (S.hands.strum) {
      // The body follows the strumming hand, but not its strokes: across the strings the hand may travel
      // a stroke's width either way before the guitar moves at all, so strumming does not shake it
      const c = palm(S.hands.strum), ex = (c.x - P.x) * asp, ey = c.y - P.y;
      const slack = function (v, z) { return v > z ? v - z : v < -z ? v + z : 0; };
      const along = slack(ex * ux + ey * uy, 0.03 * P.L) * ease(0.22), across = slack(-ex * uy + ey * ux, 0.11 * P.L) * ease(0.5);
      P.x += (along * ux - across * uy) / asp; P.y += along * uy + across * ux;
    }
    if (S.hands.fret) {
      // The neck does not chase the chord hand. A hand sliding along the neck also drifts up and down, and
      // near the body a small drift is a big angle, so chasing it made the guitar droop as the hand came in.
      // Instead the guitar takes its angle from the hands when it is first picked up, kept within the range
      // a guitar is really held at (level, to neck well up), and after that only turns, slowly, if the hand
      // stays well off the line of the neck. The chord comes from how far along the neck the hand is,
      // wherever it is across it.
      const c = palm(S.hands.fret), dx = (P.x - c.x) * asp, dy = P.y - c.y, d = Math.hypot(dx, dy);
      const want = clamp(Math.atan2(dy, dx), -0.1, 0.7);
      if (now - S.gripAt < 0.6) { if (d > 0.3 * P.L) P.ang += turn(want, P.ang) * ease(0.12); }
      else if (d > 0.25 * P.L) {
        const off = Math.abs(-dx * uy + dy * ux), band = 0.14 * P.L;      // how far the hand is from the line of the neck
        if (off > band) P.ang += turn(want, P.ang) * ease(0.9) * Math.min(1, (off - band) / band);
      }
      P.ang = clamp(P.ang, -0.1, 0.7);
      S.lastFret = { x: c.x, y: c.y };
    }
    // Size: follow the biggest hand span seen lately (a flat hand); shrink only very slowly
    let span = 0;
    if (S.hands.fret) span = handSpan(S.hands.fret);
    if (S.hands.strum) span = Math.max(span, handSpan(S.hands.strum));
    if (span > S.handSize) S.handSize += (span - S.handSize) * ease(0.4); else S.handSize *= Math.exp(-dt / 45);
    if (S.handSize > 0.02) P.L += (clamp(5.4 * S.handSize, 0.5, 1.2) - P.L) * ease(0.5);
    S.heldAt = now;
  }

  /* raw: array of hands, each 21 landmarks {x, y} in camera coordinates. now: seconds. */
  function processHands(raw, now, sides) {
    // Mirror so the picture behaves like a mirror, follow the way the picture is cropped to fill the stage,
    // then flip again for left-handed players
    const f = S.fit, held = !!S.view, asp = S.aspect;
    const hands = raw.map(function (h) {
      return h.map(function (p) { const x = f.ox + (1 - p.x) * f.sx; return { x: S.lefty ? 1 - x : x, y: f.oy + p.y * f.sy }; });
    });
    if (hands.length >= 2) {
      const a = palm(hands[0]), b = palm(hands[1]);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.09) hands.length = 1;   // the tracker sometimes reports one hand twice
    }
    // The tracker also says whether each hand is a left or a right one. Which of the two is the chord hand is
    // learned while both are in view, and then settles the question whenever only one is: without it, a chord
    // hand close to the body was taken for the strumming hand each time the strumming hand blurred out.
    const side = function (i) { const c = sides && sides[i] && sides[i][0]; return c && c.score > 0.8 ? (c.categoryName || c.displayName || '') : ''; };
    let fret = null, strumHand = null;
    if (hands.length >= 2) {
      const a = hands[0], b = hands[1], aFirst = palm(a).x <= palm(b).x;
      if (aFirst) { fret = a; strumHand = b; } else { fret = b; strumHand = a; }
      const fs = side(aFirst ? 0 : 1), ss = side(aFirst ? 1 : 0);
      if (fs && ss && fs !== ss) S.chordSide = clamp(S.chordSide + (fs === 'Left' ? 1 : -1), -12, 12);
    } else if (hands.length === 1 && side(0) && Math.abs(S.chordSide) >= 4) {
      S.lone = (side(0) === 'Left') === (S.chordSide > 0) ? 'fret' : 'strum';
      if (S.lone === 'fret') fret = hands[0]; else strumHand = hands[0];
    } else if (hands.length === 1) {
      const c = palm(hands[0]);
      if (held) {
        // A lone hand takes whichever job it is nearer to: the body (strum) or where the chord hand last was
        const P = S.pose || restPose(), ds = Math.hypot((c.x - P.x) * asp, c.y - P.y);
        const df = S.lastFret ? Math.hypot((c.x - S.lastFret.x) * asp, c.y - S.lastFret.y) : (ds < 0.2 * P.L ? 9 : 0);
        S.lone = ds <= df ? 'strum' : 'fret';
      } else {
        // Flat picture: a lone hand keeps the job it had until it is clearly on the other side
        const edge = S.lone === 'fret' ? SPLIT + 0.06 : S.lone === 'strum' ? SPLIT - 0.06 : SPLIT;
        S.lone = c.x < edge ? 'fret' : 'strum';
      }
      if (S.lone === 'fret') fret = hands[0]; else strumHand = hands[0];
    } else {
      S.lone = null;
    }
    if (hands.length) {
      S.seenAt = now; S.maskAt = now;
      S.mask = hands.map(function (h) { return h.map(function (q) { return { x: S.lefty ? 1 - q.x : q.x, y: q.y }; }); });
    }
    S.hands.fret = fret ? smoothHand(S.hands.fret, fret) : null;
    S.hands.strum = strumHand ? smoothHand(S.hands.strum, strumHand) : null;
    // What is shown (skeleton, status line, mute) rides out short gaps: a hand missed for a look or two is
    // still there as far as the player is concerned
    ['fret', 'strum'].forEach(function (k) { if (S.hands[k]) { S.shown[k] = S.hands[k]; S.shownAt[k] = now; } });
    if (held && hands.length) holdGuitar(now);
    const P = held ? (S.pose || (S.pose = restPose())) : null;
    const ux = P ? Math.cos(P.ang) : 1, uy = P ? Math.sin(P.ang) : 0;   // which way the strings run

    // Chord hand: how far along the neck is the palm? A little hysteresis stops flicker on the borders.
    if (S.hands.fret) {
      const p = palm(S.hands.fret), cur = S.chord;
      let pos;
      if (P) {
        const e = ext(), along = ((P.x - p.x) * asp) * ux + (P.y - p.y) * uy;   // distance from the strumming spot, along the strings
        pos = (e.pick - along / P.L - e.z0) / e.zw;
      } else {
        const e = FLAT_EDGES;
        if (p.x < e[0]) pos = (p.x - e[0]) / (e[1] - e[0]);
        else if (p.x >= e[5]) pos = 5 + (p.x - e[5]) / (e[5] - e[4]);
        else { let i = 0; while (i < 4 && p.x >= e[i + 1]) i++; pos = i + (p.x - e[i]) / (e[i + 1] - e[i]); }
      }
      const want = (pos < cur - 0.12 || pos > cur + 1.12) ? clamp(Math.floor(pos), 0, CHORDS.length - 1) : cur;
      // ...and a new zone has to show up in two frames running, so a one-frame glitch cannot change the chord
      if (want !== cur && want === S.wantChord) setChord(want);
      S.wantChord = want;
      if (isFist(S.hands.fret)) { S.fistFrames++; S.openFrames = 0; } else { S.openFrames++; S.fistFrames = 0; }
      if (!S.muted && S.fistFrames >= 5) { S.muted = true; damp(); syncPads(); }
      else if (S.muted && S.openFrames >= 2) { S.muted = false; syncPads(); }
    } else if (S.muted && now - S.shownAt.fret > 0.4) {
      S.muted = false; syncPads();
    }

    // Strum hand: every fast stroke across the strings plays once.
    // Fast strumming is exactly when the tracker sees least: the hand is a blur and is found in some looks and
    // not in others. So strokes are not judged by speed from one look to the next, but by turning points: the
    // hand was up there, now it is down here, so there was a downstroke in between, however few looks caught
    // it. The position is the tracker's own (not smoothed), measured across the strings, so a tilted neck
    // still counts a stroke in full.
    if (strumHand) {
      const c = centre(strumHand), a = -(c.x * asp) * uy + c.y * ux, Z = S.zig;
      const T = Math.max(0.045, 0.06 * (P ? P.L : 0.8));               // how far the hand must travel to count as a stroke
      Z.still = Z.t > 0 && now - Z.t < 0.2 && Math.abs(a - Z.prev) < 0.3 * T;                // two sightings in the same place
      Z.prev = a;
      if (!Z.t || now - Z.t > 0.45) { Z.dir = 0; Z.lo = Z.hi = a; Z.loT = Z.hiT = now; }      // after a real pause, start afresh
      else {
        let fire = 0, speed = 0;
        if (Z.dir <= 0) {                           // waiting for a downstroke, from the top turning point (lo)
          if (a < Z.lo) Z.lo = a;
          if (a - Z.lo < 0.35 * T) Z.loT = now;     // still up there: the stroke has not started yet
          else if (a - Z.lo >= T) {
            speed = (a - Z.lo) / Math.max(0.02, now - Z.loT);
            if (speed >= 0.45) fire = 1;            // slower than that is the hand being moved, not a stroke
            Z.dir = 1; Z.hi = a; Z.hiT = now;
          }
        }
        if (!fire && Z.dir >= 0) {                  // waiting for an upstroke, from the bottom turning point (hi)
          if (a > Z.hi) Z.hi = a;
          if (Z.hi - a < 0.35 * T) Z.hiT = now;
          else if (Z.hi - a >= T) {
            speed = (Z.hi - a) / Math.max(0.02, now - Z.hiT);
            if (speed >= 0.45) fire = -1;
            Z.dir = -1; Z.lo = a; Z.loT = now;
          }
        }
        // A stroke that was already played on trust (see keepTime) is not played again when the hand turns up
        const R = S.rh, played = R.fills > 0 && now - R.last < 0.55 * (R.P || 0.2);
        if (fire && played) R.fills = 0;
        else if (fire && now - S.lastStrumAt > 0.07) {
          S.lastStrumAt = now;
          const q = palm(strumHand), vel = (speed - 0.4) / 2.4;
          strum(fire, vel, { x: held ? q.x : clamp(q.x, STRUM.x0, STRUM.x1), y: c.y });
          beat(now, fire, vel, false);
        }
        S.lineY += (clamp(c.y, 0.2, 0.8) - S.lineY) * Math.min(1, (now - Z.t) / 1.2);   // flat picture: strings drift to the hand
      }
      Z.t = now;
    }
    keepTime(now);
  }

  /* Keeping time. Steady fast strumming is when the camera sees least: the hand is a blur, found in some looks
     and not in others, and whole strokes go by unseen. But steady strumming is also predictable. Once the
     recent strokes fit an even pace (allowing for missed ones in between), a stroke that falls due and has not
     been seen is played anyway, in the next direction and at the same strength. Not if the hand is in view
     and holding still, and at most two in a row. If the player has in fact stopped with the hand out of view,
     that is one or two strokes too many; if not, the rhythm no longer falls apart. */
  function beat(now, dir, vel, filled) {
    const R = S.rh;
    R.times.push(now); if (R.times.length > 6) R.times.shift();
    R.dir = dir; R.vel = vel; R.last = now; R.fills = filled ? R.fills + 1 : 0;
    if (filled) return;
    // The pace: the typical recent gap, if every recent gap is that or a whole number of it (a stroke or two
    // missed). Strokes are only timed to the nearest look, so the fit allows for one look either way.
    R.P = 0;
    const n = R.times.length;
    if (n < 5) return;
    const g = [];
    for (let i = n - 4; i < n; i++) g.push(R.times[i] - R.times[i - 1]);
    const sorted = g.slice().sort(function (x, y) { return x - y; }), base = (sorted[1] + sorted[2]) / 2;
    if (base < 0.08 || base > 0.45) return;
    let span = 0, count = 0, singles = 0;
    for (let i = 0; i < g.length; i++) {
      const k = Math.max(1, Math.round(g[i] / base));
      if (k > 3 || Math.abs(g[i] - k * base) > Math.max(0.3 * base, 0.05)) return;
      span += g[i]; count += k; if (k === 1) singles++;
    }
    if (singles >= 2) R.P = span / count;
  }
  function keepTime(now) {
    const R = S.rh, Z = S.zig;
    if (!R.P) return;
    if (now - R.last > 2.6 * R.P) { R.P = 0; R.times.length = 0; R.fills = 0; return; }       // the rhythm has ended
    const resting = now - Z.t < 0.06 && Z.still;                     // in view right now, and not moving
    if (!resting && R.fills < 2 && now - R.last >= 1.2 * R.P && now - S.lastStrumAt > 0.07) {
      S.lastStrumAt = now;
      const h = S.shown.strum, q = h ? palm(h) : null;
      strum(-R.dir, R.vel, q ? { x: q.x, y: q.y } : null);
      beat(R.last + R.P, -R.dir, R.vel, true);
      S.filled++;
      Z.dir = -Z.dir;                                // the hand is now at its other turning point
    }
  }

  /* =====================================================================
     Camera + tracker
     ===================================================================== */
  /* The tracker runs here on the main thread, on the graphics card. (Measured on a laptop with integrated
     graphics: about 15 to 20 ms a look this way, against 50 ms on the processor and 50 to 150 ms from a
     worker thread, where every frame has to be copied across.) What keeps it fast over time is not asking too
     much of the graphics card: looks are spaced out (see frame), and while the camera is on, the page draws
     one small canvas and nothing else (see setLive). */
  const T = { vision: null, files: null, model: null };
  const TR = { delegate: '', busy: false, bench: null, base: 0 };
  // Lower bars than the library's defaults (0.5): a strumming hand is blurred and often edge-on, and with the
  // defaults the tracker let go of it mid-stroke. A wrong guess costs little here; a dropped hand costs a strum.
  const TRACKER_OPTIONS = { runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3 };

  async function fetchModel() {
    if (T.model) return;
    for (const url of CFG.models) {
      try { const r = await fetch(url); if (r.ok) { T.model = await r.arrayBuffer(); return; } } catch (e) { /* try the next address */ }
    }
    throw new Error('model download failed');
  }
  async function makeTracker(delegate) {
    if (!T.vision) T.vision = await import(CFG.lib);
    if (!T.files) T.files = await T.vision.FilesetResolver.forVisionTasks(CFG.wasm);
    return T.vision.HandLandmarker.createFromOptions(T.files, Object.assign({ baseOptions: { modelAssetBuffer: new Uint8Array(T.model), delegate: delegate } }, TRACKER_OPTIONS));
  }
  async function loadTracker() {
    await fetchModel();
    TR.bench = { n: 0, sum: 0 }; TR.base = 0;
    if (S.landmarker) return;
    let lastErr = null;
    for (const delegate of CFG.delegates) {
      try { S.landmarker = await makeTracker(delegate); TR.delegate = S.delegate = delegate; return; } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('tracker failed to start');
  }
  /* Time the first looks. Only if the graphics card is plainly struggling (over 110 ms a look) is the
     processor tried instead, once, and the faster of the two kept. */
  function benchmark(ms) {
    const b = TR.bench;
    if (!b || b.done || TR.busy) return;
    if (++b.n <= 3) return;                                   // let it warm up
    b.sum += ms;
    if (b.n < 15) return;
    const avg = b.sum / (b.n - 3), other = CFG.delegates.filter(function (d) { return d !== TR.delegate; })[0];
    if (b.first) {
      if (avg > b.firstAvg) {                                 // the first one was faster after all
        try { S.landmarker.close(); } catch (e) { /* ignore */ }
        S.landmarker = b.first; TR.delegate = S.delegate = b.firstDelegate; TR.base = b.firstAvg;
      } else {
        try { b.first.close(); } catch (e) { /* ignore */ }
        TR.base = avg;
      }
      b.first = null; b.done = true; S.ms = 0;
    } else if (avg > 110 && other) {
      TR.busy = true;
      makeTracker(other).then(function (lm) {
        b.first = S.landmarker; b.firstAvg = avg; b.firstDelegate = TR.delegate; b.n = 0; b.sum = 0;
        S.landmarker = lm; TR.delegate = S.delegate = other; TR.busy = false; S.ms = 0;
      }, function () { TR.busy = false; b.done = true; TR.base = avg; });
    } else { b.done = true; TR.base = avg; }
  }
  /* A look has come back */
  function onHands(hands, ms, sides) {
    const t = performance.now();
    S.ms = S.ms ? S.ms * 0.85 + ms * 0.15 : ms;
    if (S.lastDetectAt) { const f = 1000 / Math.max(1, t - S.lastDetectAt); S.fps = S.fps ? S.fps * 0.9 + f * 0.1 : f; }
    S.lastDetectAt = t;
    benchmark(ms);
    processHands(hands, t / 1000, sides);
    S.fresh = true;
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
      S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }, audio: false });
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
    // Wait for the first picture, but not for ever: a slow camera must not leave the page stuck on "Asking"
    try { await Promise.race([S.video.play(), new Promise(function (ok) { setTimeout(ok, 4000); })]); } catch (e) { /* autoplay quirks: frames are still read once playing */ }
    if (!S.mounted || !S.stream) return stopCamera();
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
    S.diag = []; S.sampleAt = 0; S.gapMax = 0; S.budget = 1280; S.slowFor = 0;
    setCamera('on');
    size();
    kick();
  }

  function stopCamera() {
    if (S.stream) S.stream.getTracks().forEach(function (t) { t.stop(); });
    S.stream = null;
    if (S.video) S.video.srcObject = null;
    S.hands.fret = S.hands.strum = null; S.zig.t = 0; S.rh.P = 0; S.rh.times.length = 0; S.rh.fills = 0; S.muted = false; S.lowLight = false; S.fps = 0; S.lineY = STRUM.y;
    S.shown.fret = S.shown.strum = null; S.shownAt.fret = S.shownAt.strum = -9; S.chordSide = 0;
    S.heldAt = -9; S.gripAt = -9; S.lastFret = null; S.handSize = 0; S.mask = []; S.maskAt = -9; S.lastDetectAt = 0; S.ms = 0; S.sampleAt = 0; S.lastTs = 0; S.lastDrawTs = 0;
    clearTimeout(S.timer); S.timer = 0;
    setLive(false);
    if (S.camera !== 'error') setCamera('off');
  }
  function fail(msg) { S.error = msg; setCamera('error'); }

  /* Live = the camera picture fills the window, with the guitar, the options and the status floating over it */
  function setLive(on) {
    if (on === S.live) return;
    S.live = on;
    if (on) S.scrollY = window.scrollY;
    if (on && S.view) enterSolo();
    else {
      leaveSolo();
      document.body.classList.toggle('jam-live', on);       // flat picture (no 3D): the stage itself fills the window
    }
    document.documentElement.classList.toggle('jam-lock', on);
    if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () { /* already out */ });
    const full = $('#jamFull');
    if (full) full.hidden = !on || !document.documentElement.requestFullscreen;
    const rep = $('#jamReport');
    if (rep) rep.hidden = !on;
    if (!on) {                                     // the rest of the page comes back: put the scroll where it was and let the app re-measure
      window.scrollTo(0, S.scrollY || 0);
      window.dispatchEvent(new Event('resize'));
    }
    size();
    kick();
  }
  /* Solo: while the camera is on, the page is one opaque canvas (camera picture, guitar and overlay all drawn
     into it) plus the few buttons, and every other part of the page is taken out of the picture altogether.
     On a laptop with integrated graphics this is the difference between 16 ms and 100 ms for each look of the
     tracker: anything else the browser has to blend into the window is paid for on the same graphics card. */
  function enterSolo() {
    if (S.solo || !S.view) return;
    const box = document.createElement('div');
    box.id = 'jamLive'; box.className = 'jam';
    S.moved = [];
    [S.gl, $('#jamStart'), $('.jam__opts'), $('#jamStatus')].forEach(function (n) {
      if (!n) return;
      const mark = document.createComment('jam');
      n.parentNode.insertBefore(mark, n); box.appendChild(n); S.moved.push([n, mark]);
    });
    box.addEventListener('click', onClick);
    document.body.style.minHeight = document.documentElement.scrollHeight + 'px';   // keep the page's length, so its scroll position survives
    document.body.appendChild(box);
    S.solo = box;
    document.body.classList.remove('jam-live');
    document.body.classList.add('jam-solo');
    S.view.setVideo(S.video);
  }
  function leaveSolo() {
    const box = S.solo;
    if (!box) return;
    S.moved.forEach(function (m) { if (m[1].parentNode) { m[1].parentNode.insertBefore(m[0], m[1]); m[1].remove(); } });
    box.remove();
    S.solo = null; S.moved = [];
    document.body.classList.remove('jam-solo');
    document.body.style.minHeight = '';
    if (S.view) S.view.setVideo(null);
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen(); }
    else { const n = S.solo || S.root; if (n && n.requestFullscreen) n.requestFullscreen().catch(function () { /* not allowed: stay in the window */ }); }
  }

  /* Low light makes tracking unreliable, so sample the picture now and then (a 32x18 thumbnail, local only) */
  let probe = null;
  function checkLight(now) {
    if (now - S.lightAt < 2) return;
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
    // How many canvas pixels to draw. Off camera: sharp (up to 1.5x). With the camera on: a fixed budget of at
    // most 1280 across (less if tracking is struggling), stretched over the window. A full-window canvas at a
    // high-density screen's own resolution is several times the work for no visible gain behind a webcam picture.
    const r = (S.solo || $('#jamStage')).getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = S.live ? Math.min(1, S.budget / r.width) : Math.min(window.devicePixelRatio || 1, 1.5);
    S.canvas.width = Math.round(r.width * dpr); S.canvas.height = Math.round(r.height * dpr);
    S.pr = dpr; S.ratio = dpr;
    S.aspect = r.width / r.height;
    const vw = S.video ? S.video.videoWidth : 0, vh = S.video ? S.video.videoHeight : 0;
    if (vw && vh) {                                  // the video covers the stage, so part of it may be cropped
      const k = Math.max(r.width / vw, r.height / vh), dw = vw * k / r.width, dh = vh * k / r.height;
      S.fit = { sx: dw, ox: (1 - dw) / 2, sy: dh, oy: (1 - dh) / 2 };
    } else S.fit = { sx: 1, ox: 0, sy: 1, oy: 0 };
    if (S.view) {
      S.view.setRatio(S.ratio); S.view.resize();
      S.view.setOverlay(S.canvas);                   // the overlay canvas changed size: its texture has to be made afresh
    }
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
      // The 3D guitar draws itself; here we say where it is and add the chord names along the neck
      if (!S.pose) S.pose = restPose();
      const P = S.pose;
      if (nowSec - S.heldAt > 1.5) {                 // nobody is holding it: float back to the middle
        const R = restPose(), k = 1 - Math.exp(-dt / 0.45);
        P.x += (R.x - P.x) * k; P.y += (R.y - P.y) * k; P.ang += turn(R.ang, P.ang) * k; P.L += (R.L - P.L) * k;
        if (Math.abs(R.x - P.x) + Math.abs(R.y - P.y) + Math.abs(R.L - P.L) + Math.abs(turn(R.ang, P.ang)) > 0.002) busy = true;
        S.lastFret = null; S.handSize = 0;
      }
      const cs = Math.cos(P.ang);
      view.setPose({ x: fx(P.x), y: P.y, ux: S.lefty ? -cs : cs, uy: Math.sin(P.ang), L: P.L, lefty: S.lefty });
      view.update({ chord: S.chord, frets: CHORDS[S.chord].frets });
      view.setHands(S.solo && nowSec - S.maskAt < 0.3 ? S.mask : []);      // the player's hands, drawn back over the guitar
      const L = view.labels();
      S.strumAt = { x: S.lefty ? 1 - L.strum.x : L.strum.x, y: L.strum.y };
      const zpx = ext().zw * P.L * H;                // names shrink with the neck when the guitar is small
      CHORDS.forEach(function (ch, i) {
        const p = L.zones[i], on = i === S.chord;
        g.fillStyle = on ? '#FFFFFF' : 'rgba(241, 246, 252, .92)';
        g.font = Math.max(10, 2 * Math.round(Math.min((on ? 27 : 18) * u, zpx * (on ? 0.42 : 0.32)) / 2)) + 'px Michroma, "Arial Black", sans-serif';
        label(ch.name, p.x * W, p.y * H);
        if (zpx < 64 * u) return;
        g.font = 12 * u + 'px "Hanken Grotesk", sans-serif';
        label('key ' + (i + 1), p.x * W, p.y * H + 17 * u);
      });
      g.fillStyle = 'rgba(241, 246, 252, .95)'; g.font = 13 * u + 'px Michroma, sans-serif';
      label(S.muted || S.padMute ? 'Muted' : 'Strum hand', clamp(L.tag.x * W, 70 * u, W - 70 * u), clamp(L.tag.y * H, 20 * u, H - 12 * u));
    } else {
    S.strumAt = null;
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
      label(nowSec - S.seenAt > 3 ? 'waiting for hands' : 'tracking ' + Math.round(S.fps) + ' fps', W - 14 * u, (S.live ? 80 : 22) * S.pr);   // under the Stop button
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
      const h = nowSec - S.shownAt[pair[0]] < 0.3 ? S.shown[pair[0]] : null;
      if (!h) return;
      const light = !!S.solo;                        // with the real hands shown over the guitar, the skeleton is only a hint
      g.strokeStyle = light ? 'rgba(241, 246, 252, .4)' : 'rgba(241, 246, 252, .9)'; g.lineWidth = (light ? 1.5 : 2.5) * u;
      g.beginPath();
      CONNECTIONS.forEach(function (c) { g.moveTo(fx(h[c[0]].x) * W, h[c[0]].y * H); g.lineTo(fx(h[c[1]].x) * W, h[c[1]].y * H); });
      g.stroke();
      g.fillStyle = pair[1];
      h.forEach(function (p) { g.beginPath(); g.arc(fx(p.x) * W, p.y * H, (light ? 2.5 : 4.5) * u, 0, 6.3); g.fill(); });
      const c = palm(h);
      g.strokeStyle = pair[1]; g.lineWidth = (light ? 2 : 3) * u;
      g.beginPath(); g.arc(fx(c.x) * W, c.y * H, (light ? 11 : 16) * u, 0, 6.3); g.stroke();
    });
    if (view) view.render(nowSec, amps, reduceMotion.matches);   // backdrop, guitar, then this overlay: all in the one canvas
    return busy;
  }

  /* While the camera is on: a steady tick, 30 times a second. Each tick may look at a camera frame, then draws
     once. How often to look: 30 times a second at most, less often if a look takes long (a 20 ms look is
     taken about 22 times a second), and 10 times a
     second while no hands are in view. The tracker shares the graphics card with everything the page draws;
     if it is driven flat out the card falls behind, every look then takes longer, and within a minute the
     picture is down to a couple of frames a second. Leaving it room is what keeps the speed steady. */
  function tick() {
    S.timer = 0;
    if (!S.mounted || S.camera !== 'on') return;
    const t = performance.now(), now = t / 1000;
    if (S.lastTs) S.gapMax = Math.max(S.gapMax, t - S.lastTs);
    S.lastTs = t;
    if (S.video.readyState >= 2) {
      const idle = now - S.seenAt > 3, every = Math.max(idle ? 100 : 33, Math.min(250, 1.9 * S.ms)) - 6;
      if (S.landmarker && !TR.busy && S.video.currentTime !== S.lastVideoTime && t - S.lastDetectTs >= every) {
        S.lastVideoTime = S.video.currentTime; S.lastDetectTs = t;
        S.stamp = Math.max(S.stamp + 1, t);                             // the tracker needs strictly increasing times
        let res = null;
        try { res = S.landmarker.detectForVideo(S.video, S.stamp); } catch (e) { res = null; }
        onHands(res && res.landmarks ? res.landmarks : [], performance.now() - t, res ? (res.handedness || res.handednesses) : null);
      }
      if (now - S.seenAt > 1.5) checkLight(now); else S.lowLight = false;   // only worth a look when no hands are being found
      updateStatus(now);
      sample(now);
    }
    const fresh = S.fresh, d0 = performance.now();
    S.fresh = false;
    S.busy = draw(now, Math.min(0.1, S.lastDrawTs ? (t - S.lastDrawTs) / 1000 : 0.05));
    S.drawMs = S.drawMs * 0.9 + (performance.now() - d0) * 0.1;
    S.lastDrawTs = t;
    if (fresh) tune(now);
    // The next tick: as soon as the next look is due (a look that takes 20 ms is taken every 38 ms), but at
    // least 15 and at most 30 times a second, so the picture keeps moving when looks are slow
    S.next = Math.max(t + clamp(now - S.seenAt > 3 ? 50 : 1.9 * S.ms, 33, 66), performance.now() + 4);
    S.timer = setTimeout(tick, S.next - performance.now());
  }
  /* With the camera off: draw on animation frames, only while something is moving */
  function frame(ts) {
    S.raf = 0;
    if (!S.mounted || S.camera === 'on') return;
    const since = ts - S.lastDrawTs;
    if (since >= 15) {
      S.busy = draw(ts / 1000, Math.min(0.1, S.lastDrawTs ? since / 1000 : 0.016));
      S.lastDrawTs = ts;
    }
    if (S.busy) kick(); else S.lastDrawTs = 0;
  }
  /* If looks stay slow while hands are in view, draw with fewer pixels to leave the graphics card more room */
  function tune(now) {
    if (!S.live || now - S.seenAt > 1 || !TR.bench || !TR.bench.done) return;
    if (S.ms > 45) S.slowFor++; else if (S.slowFor > 0) S.slowFor--;
    if (S.slowFor > 60 && S.budget > 640) { S.budget = Math.max(640, Math.round(S.budget * 0.8)); S.slowFor = 0; size(); }
  }

  /* A running record of how fast things are going, one line every 5 seconds, kept for the last 10 minutes.
     "Speed report" copies it, so a slowdown on one machine can be understood on another. Numbers only. */
  function sample(now) {
    if (now - S.sampleAt < 5) return;
    if (!S.sampleAt) { S.sampleAt = now; S.startAt = now; return; }
    S.sampleAt = now;
    const mem = window.performance && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0;
    S.diag.push([Math.round(now - S.startAt), Math.round(S.fps), Math.round(S.ms), Math.round(S.drawMs * 10) / 10, Math.round(S.gapMax),
      (S.hands.fret ? 1 : 0) + (S.hands.strum ? 1 : 0), TR.delegate, S.canvas ? S.canvas.width + 'x' + S.canvas.height : '-', mem].join(' '));
    S.gapMax = 0;
    if (S.diag.length > 120) S.diag.shift();
  }
  function report() {
    let gpu = 'unknown';
    try {
      const c = document.createElement('canvas'), gl = c.getContext('webgl'), ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    } catch (e) { /* no WebGL */ }
    return ['PULSE Air Jam speed report',
      navigator.userAgent,
      'gpu: ' + gpu + ' | cores: ' + (navigator.hardwareConcurrency || '?') + ' | pixel ratio: ' + window.devicePixelRatio + ' | window: ' + window.innerWidth + 'x' + window.innerHeight,
      'camera: ' + (S.video ? S.video.videoWidth + 'x' + S.video.videoHeight : '-') + ' | guitar: ' + S.guitar + (S.view ? ' (3D)' : ' (flat)') + ' | tracker: ' + TR.delegate + ' | first timing: ' + Math.round(TR.base) + ' ms',
      'seconds | looks a second | ms a look | draw ms | longest frame gap ms | hands | tracker | canvas | memory MB'
    ].concat(S.diag).join('\n');
  }
  function copyReport() {
    const text = report(), done = function (ok) { setStatus(ok ? 'Speed report copied. Paste it into your message.' : 'Could not copy. The report is in the browser console.'); };
    try { console.log(text); } catch (e) { /* no console */ }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }
  function kick() {
    if (!S.mounted) return;
    if (S.camera === 'on') { if (!S.timer) { S.next = performance.now(); S.timer = setTimeout(tick, 0); } }
    else if (!S.raf) S.raf = requestAnimationFrame(frame);
  }

  /* =====================================================================
     Page: markup, buttons, keys, status
     ===================================================================== */
  const $ = function (sel) { return (S.root && S.root.querySelector(sel)) || (S.solo && S.solo.querySelector(sel)) || null; };

  function html() {
    return '<section class="jam" id="jam">' +
      '<header class="jam__head"><div><h2 id="viewTitle">Air Jam</h2>' +
      '<p class="muted">Hold your hands up as if you had a guitar and it jumps into them. Slide one hand along the neck to change chord; flick the other across the strings, fast, to strum.</p></div>' +
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
            '<button type="button" class="chip" id="jamReport" hidden>Speed report</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<section class="about jam__how"><h3>How it works</h3><ol>' +
        '<li><b>Guitar.</b> Pick the acoustic or the electric. Each is a 3D model built in code, and each has its own sound; the electric adds a distortion switch.</li>' +
        '<li><b>Holding it.</b> With the camera on, the guitar sits in your hands, with your hands in front of it: its body at your strumming hand, its neck toward your other hand, sized from the size of your hands. It takes its angle when you pick it up and then holds it, so sliding along the neck does not swing it about. Move and it comes with you.</li>' +
        '<li><b>Chord hand.</b> Slide your other hand along the neck, closer to the body or further out. The neck is split into five zones, and the one your palm is over sets the chord: ' + CHORDS.map(function (c) { return c.name; }).join(', ') + '. The dots on the frets show how that chord is really fingered.</li>' +
        '<li><b>Strum hand.</b> Flick your strumming hand quickly across the strings, down or up. Any fast stroke plays; slow moves are ignored. A faster stroke is louder and brighter.</li>' +
        '<li><b>Mute.</b> Squeeze your chord hand into a tight fist to stop the strings. Strumming while it is closed gives a muted “chk”.</li>' +
        '<li><b>Sound.</b> Each string is a Karplus-Strong model: a burst of noise looping through a short delay, synthesized live. The acoustic adds the resonance of a hollow body; the electric sounds like a pickup, and its distortion adds a soft-clipping stage and a speaker-style filter.</li>' +
        '<li><b>Privacy.</b> Hand tracking is MediaPipe Hand Landmarker running in your browser. Video stays on your device: nothing is recorded, stored or uploaded.</li>' +
        '<li><b>Full window.</b> While the camera is on, the picture fills the window. Stop camera or Esc brings the page back.</li>' +
        '<li><b>No camera?</b> The chord buttons, the Strum button, keys 1 to 5, Space and M do everything the camera does.</li>' +
      '</ol></section></section>';
  }

  function setStatus(msg) {
    if (msg === S.status) return;
    S.status = msg; S.statusAt = performance.now() / 1000;
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
      : mode === 'on' ? 'Camera on. Hold both hands up as if you were holding a guitar.'
      : 'Chord ' + CHORDS[S.chord].name + '. Press Space or Strum to play.');
    kick();
  }
  function updateStatus(now) {
    const fretIn = now - S.shownAt.fret < 0.6, strumIn = now - S.shownAt.strum < 0.6;      // short gaps do not change the message
    const lost = now - S.seenAt > 0.7, both = fretIn && strumIn;
    if (S.status.indexOf('Speed report') === 0 && now - S.statusAt < 4) return;      // leave the copy message up for a moment
    setStatus(lost && S.lowLight ? 'It is too dark to see your hands. Turn on a light or face a window.'
      : lost ? 'No hands in view. Hold them up, about an arm’s length from the camera.'
      : S.muted ? 'Muted, because your chord hand is a fist. Open it to let the strings ring.'
      : !both && fretIn ? 'Chord ' + CHORDS[S.chord].name + '. Bring in your other hand to strum.'
      : !both ? 'Strumming ' + CHORDS[S.chord].name + '. Bring in your other hand to hold the neck and change chords.'
      : S.lowLight ? 'Chord ' + CHORDS[S.chord].name + '. The picture is dark, so tracking may be jumpy.'
      : 'Chord ' + CHORDS[S.chord].name + '. Flick your strum hand across the strings to play.');
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
      case 'jamReport': copyReport(); break;
      case 'jamClean': S.dist = false; audioInit(); applyTone(); syncPads(); break;
      case 'jamDist': S.dist = true; audioInit(); applyTone(); syncPads(); break;
      case 'jamMute': toggleMute(); break;
      case 'jamLefty': S.lefty = !S.lefty; S.hands.fret = S.hands.strum = null; S.chordSide = 0; syncPads(); kick(); break;
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
          S.view.setOverlay(S.canvas);
          S.root.classList.add('jam--3d');           // the 2D canvas is now drawn inside the 3D one, not shown itself
          if (S.live) enterSolo();
          size();
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
    if (S.landmarker) { try { S.landmarker.close(); } catch (e) { /* ignore */ } S.landmarker = null; }
    S.viewToken++;
    if (S.view) { try { S.view.dispose(); } catch (e) { /* context already gone */ } S.view = null; }
    S.strumAt = null; S.pose = null;
    S.mounted = false; S.root = null; S.video = null; S.canvas = null; S.g = null; S.gl = null;
  }
  function onResize() { size(); kick(); }

  // If the tab is hidden, let go of the camera rather than keep its light on
  document.addEventListener('visibilitychange', function () { if (document.hidden && S.camera === 'on') stopCamera(); });

  window.PulseJam = {
    html: html, mount: mount, unmount: unmount, handleKey: handleKey,
    // Test hooks: feed synthetic hand landmarks and read the state back
    _feed: function (hands, now, sides) { processHands(hands, now, sides); kick(); },
    _state: function () { return { chord: CHORDS[S.chord].name, muted: S.muted, padMute: S.padMute, dist: S.dist, lefty: S.lefty, chordSide: S.chordSide, rhythm: { P: Math.round(S.rh.P * 1000), fills: S.filled, times: S.rh.times.map(function (x) { return Math.round(x * 1000) / 1000; }) }, base: Math.round(TR.base), canvas: S.canvas ? [S.canvas.width, S.canvas.height] : null, drawMs: Math.round(S.drawMs * 10) / 10, guitar: S.guitar, view: S.view ? S.view.type() : null, live: S.live, edges: FLAT_EDGES, pose: S.pose, ratio: S.ratio, fit: S.fit, delegate: S.delegate, ms: Math.round(S.ms), fps: Math.round(S.fps), strums: S.strums, last: S.last, camera: S.camera, status: S.status, notes: Object.keys(A.bufs).length, ctx: A.ctx ? A.ctx.state : 'none' }; },
    _audio: function () { return A; },
    // Where the middle of chord zone i is right now, across and down the mirrored picture
    _zonePoint: function (i) {
      if (!S.view) return { x: (FLAT_EDGES[i] + FLAT_EDGES[i + 1]) / 2, y: 0.45 };
      const P = S.pose || (S.pose = restPose()), e = ext(), d = (e.pick - (e.z0 + (i + 0.5) * e.zw)) * P.L;
      return { x: P.x - Math.cos(P.ang) * d / S.aspect, y: P.y - Math.sin(P.ang) * d };
    },
    _particles: function () { return S.particles.length; },
    _report: report,
    _bench: function () { return TR.bench; },
    _hands: function () { return { fret: S.hands.fret ? palm(S.hands.fret) : null, strum: S.hands.strum ? palm(S.hands.strum) : null, v: S.strumV }; }
  };
})();
