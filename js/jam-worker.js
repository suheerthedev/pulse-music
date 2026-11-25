/* PULSE — Air Jam hand tracker, on its own thread.
   The page sends camera frames here one at a time and gets hand landmarks back, so the heavy work of
   tracking never blocks drawing or sound. Frames are used and thrown away: nothing is kept or sent anywhere.
   This is a classic worker (the MediaPipe loader needs importScripts); the library itself is an ES module,
   loaded with a dynamic import. */
'use strict';

let tracker = null, frames = 0, debug = null;

async function init(m) {
  const vision = await import(m.lib);
  const files = await vision.FilesetResolver.forVisionTasks(m.wasm);
  let last = null;
  for (const delegate of m.delegates) {
    try {
      tracker = await vision.HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetBuffer: new Uint8Array(m.model), delegate: delegate },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5
      });
      return delegate;
    } catch (e) { last = e; }
  }
  throw last || new Error('the tracker could not start');
}

self.onmessage = function (e) {
  const m = e.data;
  if (m.type === 'init') {
    debug = m.debug || null;
    init(m).then(
      function (delegate) { self.postMessage({ type: 'ready', delegate: delegate }); },
      function (err) { self.postMessage({ type: 'error', message: String((err && err.message) || err) }); }
    );
  } else if (m.type === 'frame') {
    const t0 = performance.now();
    let hands = [];
    try {
      const r = tracker.detectForVideo(m.bitmap, m.stamp);
      if (r && r.landmarks) hands = r.landmarks.map(function (h) { return h.map(function (p) { return { x: p.x, y: p.y }; }); });
    } catch (err) { hands = []; }
    try { m.bitmap.close(); } catch (err) { /* already released */ }
    if (debug && ++frames > debug.after) { const until = performance.now() + debug.ms; while (performance.now() < until) { /* test hook: pretend to slow down */ } }
    self.postMessage({ type: 'hands', hands: hands, ms: performance.now() - t0 });
  }
};
