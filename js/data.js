/* PULSE — sample catalog.
   Everything in this file is FICTIONAL demo data: artists, albums, tracks,
   listener counts and places are invented for a university competition. */
(function () {
  'use strict';

  /* Small seeded random helpers shared by the synth engine and the art generator,
     so every track and cover is the same on every visit. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const genres = [
    { id: 'hyperpop', name: 'Hyperpop' },
    { id: 'synthwave', name: 'Synthwave' },
    { id: 'lofi', name: 'Lo-fi' },
    { id: 'dnb', name: 'Drum & Bass' },
    { id: 'ambient', name: 'Ambient' },
    { id: 'house', name: 'House' }
  ];

  const artists = [
    {
      id: 'vanta-lux', name: 'Vanta Lux', genre: 'hyperpop', base: 'Neo Lumen City', listeners: '412K',
      colors: ['#FF3D9A', '#FFB3DA', '#2CE6D6'], look: 0,
      bio: 'Bedroom producer turned glitter-pop maximalist. Vanta Lux builds songs like pop-up ads: loud, pink and impossible to close.'
    },
    {
      id: 'kiko-halcyon', name: 'Kiko Halcyon', genre: 'synthwave', base: 'Port Halogen', listeners: '268K',
      colors: ['#17153B', '#FF3D9A', '#B7A6FF'], look: 1,
      bio: 'Writes driving music for cars that do not exist yet. Analog leads, gated drums and a permanent golden hour.'
    },
    {
      id: 'soft-modem', name: 'Soft Modem', genre: 'lofi', base: 'Stillwater Campus, Dorm 4B', listeners: '590K',
      colors: ['#DDE8F5', '#7C8CF8', '#A9B7C9'], look: 2,
      bio: 'Two flatmates and a second-hand sampler. They record between lectures and name every beat after a snack.'
    },
    {
      id: 'riot-parallax', name: 'Riot Parallax', genre: 'dnb', base: 'Overpass District', listeners: '187K',
      colors: ['#17153B', '#2CE6D6', '#FF3D9A'], look: 3,
      bio: 'Breakbeat scientist who plays at 172 bpm and insists that is a resting heart rate.'
    },
    {
      id: 'aerogel-choir', name: 'Aerogel Choir', genre: 'ambient', base: 'Cloudbase Observatory', listeners: '133K',
      colors: ['#EEF4FB', '#B7A6FF', '#2CE6D6'], look: 4,
      bio: 'A choir with no singers. Slow glass tones and long reverbs made for libraries, planetariums and 3 a.m.'
    },
    {
      id: 'dial-tone-disco', name: 'Dial Tone Disco', genre: 'house', base: 'Switchboard Row', listeners: '341K',
      colors: ['#2CE6D6', '#17153B', '#FFFFFF'], look: 5,
      bio: 'A four-on-the-floor trio who sample dead phone lines and turn hold music into dance music.'
    }
  ];

  const albums = [
    { id: 'glitter-protocol', title: 'Glitter Protocol', artist: 'vanta-lux', year: 2026, motif: 'bubbles', colors: ['#FF3D9A', '#FFB3DA', '#2CE6D6'], artDesc: 'pink bubbles and a chrome sparkle' },
    { id: 'chrome-sunset-drive', title: 'Chrome Sunset Drive', artist: 'kiko-halcyon', year: 2025, motif: 'sunset', colors: ['#17153B', '#FF3D9A', '#B7A6FF'], artDesc: 'a striped pink sun over a neon grid' },
    { id: 'dorm-room-weather', title: 'Dorm Room Weather', artist: 'soft-modem', year: 2026, motif: 'waves', colors: ['#DDE8F5', '#7C8CF8', '#A9B7C9'], artDesc: 'soft blue layered waves' },
    { id: 'zero-latency', title: 'Zero Latency', artist: 'riot-parallax', year: 2026, motif: 'glitch', colors: ['#17153B', '#2CE6D6', '#FF3D9A'], artDesc: 'aqua and pink glitch bars on indigo' },
    { id: 'cloud-storage', title: 'Cloud Storage', artist: 'aerogel-choir', year: 2024, motif: 'rings', colors: ['#EEF4FB', '#B7A6FF', '#2CE6D6'], artDesc: 'pale concentric rings around a glowing orb' },
    { id: 'call-waiting', title: 'Call Waiting', artist: 'dial-tone-disco', year: 2025, motif: 'dial', colors: ['#2CE6D6', '#17153B', '#FFFFFF'], artDesc: 'a chrome rotary dial on aqua' }
  ];

  /* Musical recipe per track. root = MIDI note of the key centre, prog = scale degrees
     (0 = tonic) one per bar, lead = instrument patch in js/audio.js, bars = song length. */
  const tracks = [
    { id: 'bubblegum-firewall', title: 'Bubblegum Firewall', artist: 'vanta-lux', album: 'glitter-protocol', genre: 'hyperpop',
      bpm: 160, root: 54, scale: 'major', keyName: 'F♯ maj', lead: 'supersaw', bars: 48, prog: [0, 4, 5, 3] },
    { id: 'sugar-rush-hour', title: 'Sugar Rush Hour', artist: 'vanta-lux', album: 'glitter-protocol', genre: 'hyperpop',
      bpm: 150, root: 57, scale: 'major', keyName: 'A maj', lead: 'chip', bars: 48, prog: [0, 5, 3, 4] },
    { id: 'heart-exe', title: 'Heart.exe', artist: 'vanta-lux', album: 'glitter-protocol', genre: 'hyperpop',
      bpm: 146, root: 48, scale: 'minor', keyName: 'C min', lead: 'bell', bars: 48, prog: [0, 5, 2, 6] },
    { id: 'midnight-monorail', title: 'Midnight Monorail', artist: 'kiko-halcyon', album: 'chrome-sunset-drive', genre: 'synthwave',
      bpm: 104, root: 50, scale: 'minor', keyName: 'D min', lead: 'analog', bars: 32, prog: [0, 3, 5, 4] },
    { id: 'laserdisc-summer', title: 'Laserdisc Summer', artist: 'kiko-halcyon', album: 'chrome-sunset-drive', genre: 'synthwave',
      bpm: 112, root: 52, scale: 'dorian', keyName: 'E dorian', lead: 'square', bars: 40, prog: [0, 6, 5, 6] },
    { id: 'library-2am', title: 'Library at 2 A.M.', artist: 'soft-modem', album: 'dorm-room-weather', genre: 'lofi',
      bpm: 78, root: 51, scale: 'major', keyName: 'E♭ maj', lead: 'epiano', bars: 24, prog: [1, 4, 0, 5] },
    { id: 'instant-noodle-sunrise', title: 'Instant Noodle Sunrise', artist: 'soft-modem', album: 'dorm-room-weather', genre: 'lofi',
      bpm: 84, root: 55, scale: 'major', keyName: 'G maj', lead: 'flute', bars: 28, prog: [0, 5, 1, 4] },
    { id: 'neon-overpass', title: 'Neon Overpass', artist: 'riot-parallax', album: 'zero-latency', genre: 'dnb',
      bpm: 172, root: 53, scale: 'minor', keyName: 'F min', lead: 'pluck', bars: 56, prog: [0, 0, 5, 6] },
    { id: 'packet-loss', title: 'Packet Loss', artist: 'riot-parallax', album: 'zero-latency', genre: 'dnb',
      bpm: 174, root: 55, scale: 'phrygian', keyName: 'G phrygian', lead: 'reed', bars: 64, prog: [0, 1, 0, 6] },
    { id: 'slow-satellite', title: 'Slow Satellite', artist: 'aerogel-choir', album: 'cloud-storage', genre: 'ambient',
      bpm: 66, root: 50, scale: 'lydian', keyName: 'D lydian', lead: 'glass', bars: 24, prog: [0, 1, 0, 4] },
    { id: 'glass-aquarium', title: 'Glass Aquarium', artist: 'aerogel-choir', album: 'cloud-storage', genre: 'ambient',
      bpm: 72, root: 57, scale: 'major', keyName: 'A maj', lead: 'whistle', bars: 24, prog: [0, 3, 5, 3] },
    { id: 'dial-up-disco', title: 'Dial-Up Disco', artist: 'dial-tone-disco', album: 'call-waiting', genre: 'house',
      bpm: 124, root: 57, scale: 'minor', keyName: 'A min', lead: 'organ', bars: 40, prog: [0, 3, 6, 2] },
    { id: 'frosted-flip-phone', title: 'Frosted Flip Phone', artist: 'dial-tone-disco', album: 'call-waiting', genre: 'house',
      bpm: 122, root: 48, scale: 'dorian', keyName: 'C dorian', lead: 'pluck', bars: 40, prog: [0, 3, 0, 4] },
    { id: 'night-bus-groove', title: 'Night Bus Groove', artist: 'dial-tone-disco', album: 'call-waiting', genre: 'house',
      bpm: 126, root: 55, scale: 'minor', keyName: 'G min', lead: 'analog', bars: 48, prog: [0, 5, 3, 6] }
  ];

  const leadNames = {
    supersaw: 'Supersaw lead', chip: 'Chiptune square', bell: 'FM bell', analog: 'Analog saw lead',
    square: 'Hollow square lead', epiano: 'FM electric piano', flute: 'Sine flute', pluck: 'Filter pluck',
    reed: 'Reed pulse', glass: 'Glass FM chime', whistle: 'Whistle sine', organ: 'Drawbar organ'
  };

  tracks.forEach(function (t) {
    t.duration = (t.bars * 4 * 60) / t.bpm; // real length of the generated song, in seconds
    t.seed = hash(t.id);
    t.leadName = leadNames[t.lead];
  });

  const playlists = [
    { id: 'all-nighter-fuel', title: 'All-Nighter Fuel', blurb: 'Fast tempos for the night before the deadline.', tint: '#FF3D9A',
      tracks: ['bubblegum-firewall', 'neon-overpass', 'sugar-rush-hour', 'packet-loss', 'dial-up-disco'] },
    { id: 'night-bus-home', title: 'Night Bus Home', blurb: 'Window seat, headphones in, city going by.', tint: '#7C6CF0',
      tracks: ['midnight-monorail', 'night-bus-groove', 'library-2am', 'slow-satellite', 'laserdisc-summer'] },
    { id: 'fresh-pressed', title: 'Fresh Pressed', blurb: 'The newest releases, straight off the disc.', tint: '#2CE6D6',
      tracks: ['heart-exe', 'frosted-flip-phone', 'glass-aquarium', 'instant-noodle-sunrise', 'neon-overpass', 'laserdisc-summer'] },
    { id: 'focus-mode', title: 'Focus Mode', blurb: 'Low-key loops for reading week.', tint: '#A9B7C9',
      tracks: ['library-2am', 'instant-noodle-sunrise', 'slow-satellite', 'glass-aquarium'] }
  ];

  /* Order the library opens in: one track per genre first, so the first screen shows variety. */
  const featured = ['midnight-monorail', 'bubblegum-firewall', 'library-2am', 'dial-up-disco', 'neon-overpass', 'slow-satellite',
    'laserdisc-summer', 'heart-exe', 'frosted-flip-phone', 'instant-noodle-sunrise', 'packet-loss', 'glass-aquarium',
    'sugar-rush-hour', 'night-bus-groove'];

  window.PULSE_UTIL = { rng: rng, hash: hash };
  window.PULSE_DATA = { genres: genres, artists: artists, albums: albums, tracks: tracks, playlists: playlists, featured: featured };
})();
