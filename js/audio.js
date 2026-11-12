/* PULSE — generative synth engine (Web Audio API).
   No audio files: every track is composed from its recipe in js/data.js (bpm, key, scale,
   chord progression, lead instrument) and synthesized live. A seeded random generator
   keeps each song identical on every play. */
(function () {
  'use strict';

  const U = window.PULSE_UTIL;

  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11]
  };

  const mtof = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };

  /* ---------- Instrument patches ----------
     env = [attack, decay, sustain level, release]; cutoff = [start Hz, end Hz] of the low-pass sweep;
     fm = two-operator FM; partials = additive waveform; vib = [rate Hz, depth cents];
     delay / reverb = send amounts. */
  const LEADS = {
    supersaw: { wave: 'sawtooth', voices: 3, detune: 16, cutoff: [6000, 2200], fdecay: 0.25, q: 0.8, env: [0.006, 0.14, 0.65, 0.14], gain: 0.17, delay: 0.25, reverb: 0.25 },
    chip: { wave: 'square', cutoff: [7000, 7000], q: 0.5, env: [0.002, 0.04, 0.55, 0.03], gain: 0.1, delay: 0.3, reverb: 0.1 },
    bell: { fm: { ratio: 3.5, index: 4, decay: 0.35 }, env: [0.002, 0.45, 0, 0.25], gain: 0.2, delay: 0.3, reverb: 0.4 },
    analog: { wave: 'sawtooth', voices: 2, detune: 9, cutoff: [3800, 900], fdecay: 0.3, q: 3, env: [0.012, 0.2, 0.7, 0.2], gain: 0.17, vib: [5.2, 9], delay: 0.35, reverb: 0.3 },
    square: { wave: 'square', voices: 2, detune: 6, cutoff: [2600, 1100], fdecay: 0.2, q: 1.5, env: [0.01, 0.15, 0.7, 0.15], gain: 0.12, vib: [5, 6], delay: 0.35, reverb: 0.3 },
    epiano: { fm: { ratio: 1, index: 1.6, decay: 0.5 }, env: [0.004, 0.7, 0.15, 0.3], gain: 0.2, delay: 0.15, reverb: 0.35 },
    flute: { partials: [1, 0.35, 0.12], cutoff: [3000, 3000], env: [0.05, 0.1, 0.85, 0.2], gain: 0.17, vib: [4.8, 12], delay: 0.2, reverb: 0.45 },
    pluck: { wave: 'sawtooth', cutoff: [5200, 380], fdecay: 0.14, q: 4, env: [0.002, 0.22, 0, 0.08], gain: 0.2, delay: 0.4, reverb: 0.25 },
    reed: { partials: [1, 0, 0.6, 0, 0.4, 0, 0.25], cutoff: [2400, 1300], fdecay: 0.15, q: 2.5, env: [0.02, 0.1, 0.75, 0.1], gain: 0.14, vib: [5.5, 8], delay: 0.3, reverb: 0.3 },
    glass: { fm: { ratio: 5.02, index: 2.4, decay: 1.2 }, env: [0.004, 1.6, 0, 0.8], gain: 0.15, delay: 0.45, reverb: 0.7 },
    whistle: { wave: 'sine', cutoff: [4000, 4000], env: [0.08, 0.2, 0.8, 0.5], gain: 0.14, vib: [4.5, 14], delay: 0.35, reverb: 0.7 },
    organ: { partials: [1, 0.8, 0.5, 0, 0.3, 0, 0, 0.2], cutoff: [5000, 5000], env: [0.006, 0.05, 0.9, 0.06], gain: 0.11, vib: [6, 5], delay: 0.2, reverb: 0.25 }
  };

  /* ---------- Genre styles ----------
     16-step patterns (one bar of sixteenth notes). Drums: x = hit, o = soft hit, O = open hat.
     Bass: x = chord root, o = root an octave up, 5 = fifth. */
  const STYLES = {
    hyperpop: {
      reverb: 0.5,
      kick: 'x---x---x---x---', kickAlt: 'x---x--x--x-x---', kickP: [200, 50, 0.22],
      snare: '----x-------x---', snareKind: 'clap',
      hat: 'x-xox-xox-xoxoxo',
      bass: 'x--x--x-o--x--x-', bassLen: 2,
      bassP: { wave: 'square', cutoff: [1600, 260], fdecay: 0.11, q: 3, env: [0.003, 0.12, 0.4, 0.04], gain: 0.24 },
      pad: { pat: null, p: { wave: 'sawtooth', voices: 2, detune: 18, cutoff: [3200, 2200], fdecay: 0.4, env: [0.03, 0.2, 0.8, 0.15], gain: 0.045, reverb: 0.5 } },
      arp: { every: 1, pat: [0, 1, 2, 3, 2, 1], p: { wave: 'square', cutoff: [4200, 1800], fdecay: 0.05, q: 1, env: [0.002, 0.06, 0.15, 0.03], gain: 0.045, delay: 0.35 } },
      lead: { grid: 1, density: 0.6, lens: [1, 2, 2, 3, 4] },
      fill: true
    },
    synthwave: {
      reverb: 0.7,
      kick: 'x---x---x---x---', kickP: [150, 46, 0.3],
      snare: '----x-------x---', snareKind: 'snare',
      hat: 'x-x-x-x-x-x-x-xo',
      bass: 'x-x-x-o-x-x-x-o-', bassLen: 2,
      bassP: { wave: 'sawtooth', cutoff: [1100, 320], fdecay: 0.16, q: 4, env: [0.004, 0.14, 0.5, 0.05], gain: 0.24 },
      pad: { pat: null, p: { wave: 'sawtooth', voices: 2, detune: 14, cutoff: [1500, 1100], fdecay: 0.8, q: 0.8, env: [0.25, 0.3, 0.85, 0.5], gain: 0.055, reverb: 0.6 } },
      arp: { every: 2, pat: [0, 1, 2, 3], p: { wave: 'sawtooth', cutoff: [3000, 900], fdecay: 0.1, q: 2, env: [0.003, 0.12, 0.1, 0.05], gain: 0.07, delay: 0.45, reverb: 0.2 } },
      lead: { grid: 2, density: 0.75, lens: [1, 1, 2, 2, 3, 4] },
      fill: true
    },
    lofi: {
      reverb: 0.6, swing: 0.28,
      kick: 'x------x--x-----', kickAlt: 'x-----x---x--x--', kickP: [120, 44, 0.28],
      snare: '----x-------x---', snareKind: 'snare', snareVel: 0.65,
      hat: 'x-x-x-x-x-x-x-x-', hatVel: 0.6,
      bass: 'x-----x---x-----', bassLen: 4,
      bassP: { partials: [1, 0.45, 0.2], cutoff: [900, 500], fdecay: 0.2, env: [0.01, 0.2, 0.7, 0.12], gain: 0.3 },
      pad: { pat: 'x-----x---------', len: 5, seventh: true, p: { fm: { ratio: 1, index: 1.2, decay: 0.6 }, env: [0.006, 0.9, 0.25, 0.4], gain: 0.075, reverb: 0.4 } },
      arp: null,
      lead: { grid: 2, density: 0.6, lens: [1, 2, 2, 3, 4] }
    },
    dnb: {
      reverb: 0.75,
      kick: 'x---------x-----', kickAlt: 'x--x------x-----', kickP: [180, 50, 0.2],
      snare: '----x-------x---', snareKind: 'snare',
      hat: 'x-x-x-xox-x-x-xo',
      bass: 'x-----x---x-----', bassLen: 5,
      bassP: { wave: 'sawtooth', voices: 3, detune: 24, cutoff: [900, 340], fdecay: 0.3, q: 2, env: [0.01, 0.2, 0.85, 0.08], gain: 0.26 },
      pad: { pat: null, p: { wave: 'sawtooth', voices: 2, detune: 12, cutoff: [1200, 900], fdecay: 0.6, env: [0.4, 0.4, 0.8, 0.6], gain: 0.045, reverb: 0.7 } },
      arp: { every: 3, pat: [0, 2, 1, 3], p: { wave: 'triangle', cutoff: [3600, 1200], fdecay: 0.08, q: 1, env: [0.002, 0.14, 0, 0.05], gain: 0.07, delay: 0.5, reverb: 0.3 } },
      lead: { grid: 2, density: 0.55, lens: [2, 3, 4, 6] },
      fill: true
    },
    ambient: {
      reverb: 1,
      bass: 'x---------------', bassLen: 16,
      bassP: { partials: [1, 0.5, 0.2], cutoff: [600, 600], env: [0.6, 0.5, 0.9, 1.2], gain: 0.2 },
      pad: { pat: null, seventh: true, p: { wave: 'sawtooth', voices: 3, detune: 14, cutoff: [900, 700], fdecay: 1.5, env: [1.2, 0.6, 0.9, 1.8], gain: 0.05, reverb: 0.9 } },
      arp: { every: 4, pat: [0, 2, 1, 3, 2, 1], p: { fm: { ratio: 2, index: 1.2, decay: 0.8 }, env: [0.01, 1.2, 0, 0.5], gain: 0.07, delay: 0.5, reverb: 0.8 } },
      lead: { grid: 4, density: 0.8, lens: [1, 2, 2, 3] },
      leadAlways: true
    },
    house: {
      reverb: 0.5,
      kick: 'x---x---x---x---', kickP: [160, 46, 0.26],
      snare: '----x-------x---', snareKind: 'clap',
      hat: 'o-O-o-O-o-O-o-Oo',
      bass: '--x--ox---x--ox-', bassLen: 2,
      bassP: { wave: 'sawtooth', cutoff: [1300, 300], fdecay: 0.12, q: 3, env: [0.004, 0.12, 0.4, 0.05], gain: 0.26 },
      pad: { pat: 'x--x--x---x--x--', len: 2, seventh: true, p: { wave: 'sawtooth', voices: 2, detune: 10, cutoff: [2800, 700], fdecay: 0.14, q: 2, env: [0.004, 0.16, 0.1, 0.08], gain: 0.06, delay: 0.3, reverb: 0.35 } },
      arp: null,
      lead: { grid: 1, density: 0.5, lens: [1, 2, 2, 3, 4] },
      fill: true
    }
  };

  /* ---------- Composition: recipe -> list of events per sixteenth-note step ---------- */

  function snap(d, r) {
    const tries = [0, -1, 1, -2, 2];
    for (let i = 0; i < tries.length; i++) {
      const m = (((d + tries[i] - r) % 7) + 7) % 7;
      if (m === 0 || m === 2 || m === 4) return d + tries[i];
    }
    return d;
  }

  /* An 8-bar melody: one 2-bar rhythm repeated as A B A C, pitches by a random walk
     that lands on chord tones on strong beats. */
  function melody(rnd, cfg, prog) {
    const grid = cfg.grid, rhythm = [];
    let s = 0;
    while (s < 32) {
      const strong = s % 16 === 0 ? 1.6 : s % 8 === 0 ? 1 : s % 4 === 0 ? 0.8 : s % 2 === 0 ? 0.55 : 0.3;
      if (rnd() < cfg.density * strong) {
        let len = cfg.lens[Math.floor(rnd() * cfg.lens.length)] * grid;
        len = Math.min(len, 32 - s);
        rhythm.push([s, len]);
        s += len;
      } else {
        s += grid;
      }
    }
    if (!rhythm.length) rhythm.push([0, 4 * grid]);
    const walk = function () {
      return rhythm.map(function () {
        const r = rnd();
        return r < 0.3 ? -1 : r < 0.6 ? 1 : r < 0.72 ? -2 : r < 0.84 ? 2 : r < 0.92 ? 0 : (rnd() < 0.5 ? 3 : -3);
      });
    };
    const A = walk(), B = walk(), C = walk();
    const order = [A, B, A, C];
    const start = 9 + Math.floor(rnd() * 3);
    const bars = [[], [], [], [], [], [], [], []];
    for (let rep = 0; rep < 4; rep++) {
      let d = start;
      const w = order[rep];
      for (let i = 0; i < rhythm.length; i++) {
        const st = rhythm[i][0], len = rhythm[i][1];
        const bar = rep * 2 + (st >> 4);
        d = Math.max(7, Math.min(16, d + w[i]));
        if (st % 8 === 0 || len >= 4) d = snap(d, prog[bar % prog.length]);
        bars[bar].push({ s: st & 15, len: len, d: d });
      }
    }
    return bars;
  }

  const songCache = {};

  function compile(t) {
    if (songCache[t.id]) return songCache[t.id];
    const st = STYLES[t.genre];
    const sc = SCALES[t.scale];
    const rnd = U.rng(t.seed);
    const stepDur = 60 / t.bpm / 4;
    const B = t.bars, total = B * 16;
    const steps = [];
    for (let i = 0; i < total; i++) steps.push([]);

    const deg = function (d) { return t.root + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7); };
    const fold = function (n, lo) { while (n >= lo + 12) n -= 12; while (n < lo) n += 12; return n; };
    const chord = function (r, seventh) {
      return (seventh ? [0, 2, 4, 6] : [0, 2, 4]).map(function (k) { return fold(deg(r + k), t.root); });
    };

    const lead = LEADS[t.lead];
    const melA = melody(rnd, st.lead, t.prog);
    const melB = melody(rnd, st.lead, t.prog);

    // Song form: intro (4 bars) -> build (4) -> main A -> break (4) -> main B -> outro (4)
    const bk = 8 + Math.round((B - 20) / 8) * 4;

    for (let bar = 0; bar < B; bar++) {
      const base = bar * 16;
      const r = t.prog[bar % t.prog.length];
      const intro = bar < 4, build = bar >= 4 && bar < 8;
      const brk = bar >= bk && bar < bk + 4, outro = bar >= B - 4;
      const main = !intro && !build && !brk && !outro;
      const second = bar >= bk + 4;
      const lastOfSection = bar === 7 || bar === bk - 1 || bar === bk + 3 || bar === B - 5;
      const tail = outro && bar >= B - 2;
      const on = {
        arp: !brk || bar >= bk + 2,
        hat: (intro && bar >= 2) || build || main || (brk && bar >= bk + 2) || (outro && !tail),
        kick: build || main || (outro && !tail),
        snare: (build && bar >= 6) || main,
        bass: build || main || (outro && !tail),
        lead: st.leadAlways ? (bar >= 2 && bar < B - 2) : (main || brk)
      };
      let i, c;

      // Chords
      const notes = chord(r, st.pad.seventh);
      if (!st.pad.pat) {
        notes.forEach(function (m) { steps[base].push({ k: 't', p: st.pad.p, m: m, len: 16 }); });
      } else {
        for (i = 0; i < 16; i++) {
          if (st.pad.pat[i] === 'x') {
            notes.forEach(function (m) { steps[base + i].push({ k: 't', p: st.pad.p, m: m, len: st.pad.len || 2 }); });
          }
        }
      }

      // Drums
      if (on.kick && st.kick) {
        const kp = (bar % 4 === 3 && st.kickAlt) ? st.kickAlt : st.kick;
        for (i = 0; i < 16; i++) if (kp[i] === 'x') steps[base + i].push({ k: 'kick', v: 1 });
      }
      if (on.snare && st.snare) {
        for (i = 0; i < 16; i++) if (st.snare[i] === 'x') steps[base + i].push({ k: st.snareKind, v: st.snareVel || 1 });
      }
      if (on.hat && st.hat) {
        for (i = 0; i < 16; i++) {
          c = st.hat[i];
          if (c === 'x') steps[base + i].push({ k: 'hat', v: st.hatVel || 1 });
          else if (c === 'o') steps[base + i].push({ k: 'hat', v: 0.45 * (st.hatVel || 1) });
          else if (c === 'O') steps[base + i].push({ k: 'hat', v: 0.9, open: true });
        }
      }
      if (lastOfSection && st.fill && on.kick) {
        [0.35, 0.5, 0.7, 0.9].forEach(function (v, n) { steps[base + 12 + n].push({ k: 'snare', v: v }); });
      }
      if ((bar === 8 || bar === bk + 4) && st.kick) steps[base].push({ k: 'crash' });

      // Bass
      if (on.bass && st.bass) {
        const root = fold(deg(r), 36);
        for (i = 0; i < 16; i++) {
          c = st.bass[i];
          if (c === '-') continue;
          const m = c === 'o' ? root + 12 : c === '5' ? fold(deg(r + 4), 36) : root;
          steps[base + i].push({ k: 't', p: st.bassP, m: m, len: st.bassLen });
        }
      }

      // Arpeggio
      if (on.arp && st.arp) {
        const tones = [deg(r) + 12, deg(r + 2) + 12, deg(r + 4) + 12, deg(r + 7) + 12];
        for (i = 0; i < 16; i += st.arp.every) {
          const n = Math.floor((base + i) / st.arp.every);
          steps[base + i].push({ k: 't', p: st.arp.p, m: tones[st.arp.pat[n % st.arp.pat.length]], len: st.arp.every, v: intro ? 0.7 : 1 });
        }
      }

      // Lead melody
      if (on.lead) {
        const mel = second ? melB : melA;
        const rel = bar - (brk ? bk : second ? bk + 4 : 8);
        mel[((rel % 8) + 8) % 8].forEach(function (n) {
          steps[base + n.s].push({ k: 't', p: lead, m: deg(n.d), len: n.len, v: brk ? 0.8 : 1 });
        });
      }
    }

    const song = { steps: steps, stepDur: stepDur, total: total, duration: total * stepDur, style: st };
    songCache[t.id] = song;
    return song;
  }

  /* ---------- Engine state ---------- */

  const E = {
    ctx: null, comp: null, vol: null, analyser: null, noise: null, impulse: null, waves: {},
    track: null, song: null, session: null,
    playing: false, pausedPos: 0, startCtx: 0, startPos: 0, nextStep: 0, timer: null,
    volume: 0.8, onstate: null, onended: null
  };

  const curve = function (v) { return v * v; }; // perceptual volume taper

  function init() {
    if (E.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio API is not supported in this browser');
    const ctx = E.ctx = new AC();

    E.comp = ctx.createDynamicsCompressor();
    E.comp.threshold.value = -16; E.comp.knee.value = 12; E.comp.ratio.value = 5;
    E.comp.attack.value = 0.004; E.comp.release.value = 0.18;
    E.analyser = ctx.createAnalyser();
    E.analyser.fftSize = 256;
    E.analyser.smoothingTimeConstant = 0.78;
    E.vol = ctx.createGain();
    E.vol.gain.value = curve(E.volume);
    E.comp.connect(E.analyser);
    E.analyser.connect(E.vol);
    E.vol.connect(ctx.destination);

    // White-noise buffer for drums
    const nLen = Math.floor(ctx.sampleRate * 2);
    E.noise = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nd = E.noise.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;

    // Generated reverb impulse (decaying stereo noise)
    const rLen = Math.floor(ctx.sampleRate * 2.4);
    E.impulse = ctx.createBuffer(2, rLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = E.impulse.getChannelData(ch);
      for (let i = 0; i < rLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rLen, 2.6);
    }
  }

  function periodic(partials) {
    const key = partials.join(',');
    if (!E.waves[key]) {
      const real = new Float32Array(partials.length + 1);
      const imag = new Float32Array(partials.length + 1);
      for (let i = 0; i < partials.length; i++) imag[i + 1] = partials[i];
      E.waves[key] = E.ctx.createPeriodicWave(real, imag);
    }
    return E.waves[key];
  }

  /* A session is one continuous stretch of playback. Pausing, seeking or changing track
     fades the old session out, so notes scheduled ahead never leak into the new position. */
  function newSession(song) {
    const ctx = E.ctx, now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + 0.03);
    out.connect(E.comp);

    const delayIn = ctx.createGain();
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = Math.min(1.4, song.stepDur * 3); // dotted eighth
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
    delayIn.connect(delay); delay.connect(dlp); dlp.connect(fb); fb.connect(delay); dlp.connect(out);

    const revIn = ctx.createGain();
    const rev = ctx.createConvolver(); rev.buffer = E.impulse;
    const revOut = ctx.createGain(); revOut.gain.value = song.style.reverb;
    revIn.connect(rev); rev.connect(revOut); revOut.connect(out);

    const drumRev = ctx.createGain(); drumRev.gain.value = 0.18; drumRev.connect(revIn);

    return { out: out, delayIn: delayIn, revIn: revIn, drumRev: drumRev, chans: new Map() };
  }

  function killSession(s, fade) {
    if (!s) return;
    const now = E.ctx.currentTime;
    s.out.gain.cancelScheduledValues(now);
    s.out.gain.setValueAtTime(s.out.gain.value, now);
    s.out.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(function () { try { s.out.disconnect(); } catch (e) { /* already gone */ } }, fade * 1000 + 250);
  }

  function chan(s, p) {
    let c = s.chans.get(p);
    if (!c) {
      const ctx = E.ctx;
      c = ctx.createGain();
      c.connect(s.out);
      if (p.delay) { const g = ctx.createGain(); g.gain.value = p.delay; c.connect(g); g.connect(s.delayIn); }
      if (p.reverb) { const g2 = ctx.createGain(); g2.gain.value = p.reverb; c.connect(g2); g2.connect(s.revIn); }
      s.chans.set(p, c);
    }
    return c;
  }

  /* ---------- Voices ---------- */

  function envelope(param, t, dur, env, peak) {
    const a = env[0], d = env[1], s = env[2], r = env[3];
    const hold = s === 0 ? a + d : Math.max(dur, a + 0.01);
    const tA = t + a, tD = tA + d, tOff = t + hold;
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, tA);
    if (tD <= tOff) {
      param.linearRampToValueAtTime(peak * s, tD);
      param.setValueAtTime(peak * s, tOff);
    } else {
      param.linearRampToValueAtTime(peak + (peak * s - peak) * ((tOff - tA) / d), tOff);
    }
    param.linearRampToValueAtTime(0, tOff + r);
    return tOff + r + 0.03;
  }

  function tone(s, t, midi, dur, p, vel) {
    const ctx = E.ctx, freq = mtof(midi);
    const g = ctx.createGain();
    const end = envelope(g.gain, t, dur, p.env, p.gain * (vel == null ? 1 : vel));
    const src = [];
    if (p.fm) {
      const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain();
      car.frequency.value = freq;
      mod.frequency.value = freq * p.fm.ratio;
      const depth = freq * p.fm.index;
      mg.gain.setValueAtTime(depth, t);
      mg.gain.exponentialRampToValueAtTime(Math.max(depth * 0.04, 0.5), t + p.fm.decay);
      mod.connect(mg); mg.connect(car.frequency); car.connect(g);
      src.push(car, mod);
    } else {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = p.q || 0.7;
      f.frequency.setValueAtTime(p.cutoff[0], t);
      if (p.cutoff[1] !== p.cutoff[0]) f.frequency.exponentialRampToValueAtTime(p.cutoff[1], t + (p.fdecay || 0.2));
      f.connect(g);
      const n = p.voices || 1;
      let input = f;
      if (n > 1) { input = ctx.createGain(); input.gain.value = 1 / Math.sqrt(n); input.connect(f); }
      for (let i = 0; i < n; i++) {
        const o = ctx.createOscillator();
        if (p.partials) o.setPeriodicWave(periodic(p.partials)); else o.type = p.wave;
        o.frequency.value = freq;
        if (n > 1) o.detune.value = (i - (n - 1) / 2) * (p.detune || 10);
        o.connect(input);
        src.push(o);
      }
    }
    if (p.vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = p.vib[0];
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(p.vib[1], t + 0.25);
      l.connect(lg);
      src.forEach(function (o) { lg.connect(o.detune); });
      src.push(l);
    }
    g.connect(chan(s, p));
    src.forEach(function (o) { o.start(t); o.stop(end); });
  }

  function noise(s, t, vel, dur, type, freq, q, wet) {
    const ctx = E.ctx;
    const src = ctx.createBufferSource(); src.buffer = E.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(s.out);
    if (wet) g.connect(s.drumRev);
    src.start(t, Math.random(), dur + 0.03);
  }

  function kick(s, t, vel, kp) {
    const ctx = E.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(kp[0], t);
    o.frequency.exponentialRampToValueAtTime(kp[1], t + 0.11);
    g.gain.setValueAtTime(0.9 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + kp[2]);
    o.connect(g); g.connect(s.out);
    o.start(t); o.stop(t + kp[2] + 0.02);
  }

  function snare(s, t, vel) {
    const ctx = E.ctx;
    noise(s, t, 0.36 * vel, 0.17, 'highpass', 1700, 0.7, true);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(130, t + 0.09);
    g.gain.setValueAtTime(0.28 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); g.connect(s.out);
    o.start(t); o.stop(t + 0.14);
  }

  function clap(s, t, vel) {
    noise(s, t, 0.3 * vel, 0.03, 'bandpass', 1500, 1.2, false);
    noise(s, t + 0.012, 0.3 * vel, 0.03, 'bandpass', 1500, 1.2, false);
    noise(s, t + 0.024, 0.4 * vel, 0.18, 'bandpass', 1500, 1.2, true);
  }

  function hat(s, t, vel, open) {
    noise(s, t, 0.11 * vel, open ? 0.2 : 0.04, 'highpass', 8000, 0.7, false);
  }

  function crash(s, t) {
    noise(s, t, 0.13, 1.3, 'highpass', 5000, 0.5, true);
  }

  /* ---------- Scheduler (look-ahead clock) ---------- */

  function stepTime(i) {
    const song = E.song;
    let t = E.startCtx + (i * song.stepDur - E.startPos);
    if (song.style.swing && (i & 3) >= 2) t += song.style.swing * song.stepDur;
    return t;
  }

  function schedule(i, t) {
    const s = E.session, song = E.song, evs = song.steps[i];
    for (let n = 0; n < evs.length; n++) {
      const ev = evs[n];
      switch (ev.k) {
        case 't': tone(s, t, ev.m, ev.len * song.stepDur * 0.92, ev.p, ev.v); break;
        case 'kick': kick(s, t, ev.v, song.style.kickP); break;
        case 'snare': snare(s, t, ev.v); break;
        case 'clap': clap(s, t, ev.v); break;
        case 'hat': hat(s, t, ev.v, ev.open); break;
        case 'crash': crash(s, t); break;
      }
    }
  }

  function tick() {
    if (!E.playing) return;
    const ctx = E.ctx, song = E.song;
    // Background tabs throttle timers to ~1s, so schedule further ahead when hidden.
    const horizon = ctx.currentTime + (document.hidden ? 1.8 : 0.16);
    while (E.nextStep < song.total) {
      const t = stepTime(E.nextStep);
      if (t > horizon) break;
      if (t > ctx.currentTime - 0.1) schedule(E.nextStep, Math.max(t, ctx.currentTime));
      E.nextStep++;
    }
    if (E.startPos + (ctx.currentTime - E.startCtx) >= song.duration) {
      E.playing = false;
      clearInterval(E.timer);
      E.pausedPos = 0;
      killSession(E.session, 0.5);
      E.session = null;
      if (E.onended) E.onended();
      if (!E.playing && E.onstate) E.onstate(false);
    }
  }

  /* ---------- Public API ---------- */

  function halt(fade) {
    if (!E.playing) return;
    E.playing = false;
    clearInterval(E.timer);
    killSession(E.session, fade);
    E.session = null;
  }

  function position() {
    if (!E.song) return 0;
    if (!E.playing) return E.pausedPos;
    return Math.max(0, Math.min(E.song.duration, E.startPos + (E.ctx.currentTime - E.startCtx)));
  }

  function load(track) {
    halt(0.06);
    E.track = track;
    E.song = compile(track);
    E.pausedPos = 0;
  }

  function play() {
    if (!E.song || E.playing) return true;
    try { init(); } catch (err) { return false; }
    if (E.ctx.state !== 'running') E.ctx.resume();
    if (E.pausedPos >= E.song.duration - 0.05) E.pausedPos = 0;
    E.session = newSession(E.song);
    E.startCtx = E.ctx.currentTime + 0.08;
    E.startPos = E.pausedPos;
    E.nextStep = Math.ceil(E.pausedPos / E.song.stepDur - 1e-6);
    E.playing = true;
    E.timer = setInterval(tick, 25);
    tick();
    if (E.onstate) E.onstate(true);
    return true;
  }

  function pause() {
    if (!E.playing) return;
    E.pausedPos = position();
    halt(0.05);
    if (E.onstate) E.onstate(false);
  }

  function seek(sec) {
    if (!E.song) return;
    sec = Math.max(0, Math.min(E.song.duration - 0.05, sec));
    const was = E.playing;
    halt(0.04);
    E.pausedPos = sec;
    if (was) play();
  }

  function setVolume(v) {
    E.volume = Math.max(0, Math.min(1, v));
    if (E.vol) E.vol.gain.setTargetAtTime(curve(E.volume), E.ctx.currentTime, 0.015);
  }

  document.addEventListener('visibilitychange', function () {
    if (!E.playing) return;
    if (!document.hidden && E.ctx.state !== 'running') E.ctx.resume();
    tick();
  });

  window.PulseEngine = {
    supported: !!(window.AudioContext || window.webkitAudioContext),
    load: load, play: play, pause: pause, seek: seek, setVolume: setVolume, position: position,
    toggle: function () { if (E.playing) { pause(); return true; } return play(); },
    isPlaying: function () { return E.playing; },
    duration: function () { return E.song ? E.song.duration : 0; },
    analyser: function () { return E.analyser; },
    onState: function (fn) { E.onstate = fn; },
    onEnded: function (fn) { E.onended = fn; },
    _compile: compile
  };
})();
