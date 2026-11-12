/* PULSE — interface logic.
   1. helpers, icons, generated artwork
   2. views + router (home, search, library, liked, playlist, album, artist)
   3. sidebar, now-playing panel, player bar
   4. scroll journey (vinyl loading screen -> 3D record library -> app) */
(function () {
  'use strict';

  const D = window.PULSE_DATA, U = window.PULSE_UTIL, Engine = window.PulseEngine;

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  const esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const index = function (list) { const o = {}; list.forEach(function (x) { o[x.id] = x; }); return o; };
  const n1 = function (v) { return Math.round(v * 10) / 10; };
  const clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  const smooth = function (a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  const TRACK = index(D.tracks), ARTIST = index(D.artists), ALBUM = index(D.albums),
    GENRE = index(D.genres), PLAYLIST = index(D.playlists);
  D.albums.forEach(function (a) { a.genre = ARTIST[a.artist].genre; });
  const lum = function (hex) {
    const c = [1, 3, 5].map(function (i) { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const inkOn = function (hex) { return lum(hex) > 0.2 ? '#17153B' : '#FFFFFF'; };
  const GENRE_TINT = { hyperpop: '#FF3D9A', synthwave: '#B7A6FF', lofi: '#DDE8F5', dnb: '#2CE6D6', ambient: '#A9B7C9', house: '#FF9CCB' };

  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  const store = {
    get: function (k, fallback) {
      try { const v = localStorage.getItem('pulse:' + k); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set: function (k, v) { try { localStorage.setItem('pulse:' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  const state = {
    route: { name: 'home' },
    genre: 'all',
    query: '',
    likedOnly: false,
    liked: new Set((store.get('liked', []) || []).filter(function (id) { return TRACK[id]; })),
    queue: D.featured.slice(),
    currentId: null,
    volume: clamp(Number(store.get('volume', 80)) || 0, 0, 100),
    lastVolume: 80
  };

  const fmt = function (sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  };
  const mins = function (ids) {
    const total = ids.reduce(function (s, id) { return s + TRACK[id].duration; }, 0);
    return Math.max(1, Math.round(total / 60)) + ' min';
  };
  const plural = function (n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); };
  const idsOf = function (list) { return list.map(function (t) { return t.id; }); };
  const likedIds = function () { return D.featured.filter(function (id) { return state.liked.has(id); }); };

  /* ---------- Icons ---------- */
  const svg = function (inner) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + inner + '</svg>'; };
  const ICON = {
    play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.52.86l10.4-6.5a1 1 0 0 0 0-1.72L9.52 4.64A1 1 0 0 0 8 5.5z"/>'),
    pause: svg('<rect x="6" y="5" width="4.6" height="14" rx="1.3"/><rect x="13.4" y="5" width="4.6" height="14" rx="1.3"/>'),
    heart: svg('<path d="M12 20.4s-7.6-4.6-7.6-10.3A4.3 4.3 0 0 1 12 7.5a4.3 4.3 0 0 1 7.6 2.6c0 5.7-7.6 10.3-7.6 10.3z"/>'),
    volume: svg('<path class="solid" d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.6a7.6 7.6 0 0 1 0 10.8"/>'),
    muted: svg('<path class="solid" d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
    eq: '<span class="eq"><i></i><i></i><i></i></span>'
  };

  /* ---------- Generated artwork (SVG, no image files) ---------- */
  let uid = 0;
  const STAR = 'M50 0C52 38 62 48 100 50 62 52 52 62 50 100 48 62 38 52 0 50 38 48 48 38 50 0Z';
  const star = function (x, y, size, fill, op) {
    return '<path d="' + STAR + '" transform="translate(' + n1(x - size / 2) + ' ' + n1(y - size / 2) + ') scale(' + (size / 100) + ')" fill="' + fill + '" opacity="' + (op == null ? 1 : op) + '"/>';
  };
  const wrapArt = function (defs, body, label) {
    const a11y = label ? 'role="img" aria-label="' + esc(label) + '"' : 'aria-hidden="true"';
    return '<svg class="art" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" focusable="false" ' + a11y + '><defs>' + defs + '</defs>' + body + '</svg>';
  };

  function coverArt(al, label) {
    const id = 'c' + (++uid), c1 = al.colors[0], c2 = al.colors[1], c3 = al.colors[2];
    const r = U.rng(U.hash(al.id));
    let defs = '', b = '', i;
    switch (al.motif) {
      case 'bubbles':
        defs = '<linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c2 + '"/><stop offset="1" stop-color="' + c1 + '"/></linearGradient>';
        b = '<rect width="100" height="100" fill="url(#' + id + ')"/>';
        for (i = 0; i < 9; i++) {
          const x = n1(8 + r() * 84), y = n1(8 + r() * 84), rad = n1(6 + r() * 16), aq = i % 3 === 0;
          b += '<circle cx="' + x + '" cy="' + y + '" r="' + rad + '" fill="' + (aq ? c3 : '#fff') + '" opacity="' + (aq ? 0.75 : 0.38) + '"/>' +
            '<ellipse cx="' + n1(x - rad * 0.35) + '" cy="' + n1(y - rad * 0.4) + '" rx="' + n1(rad * 0.28) + '" ry="' + n1(rad * 0.15) + '" fill="#fff" opacity=".9" transform="rotate(-30 ' + x + ' ' + y + ')"/>';
        }
        b += star(74, 26, 30, '#fff', 0.95);
        break;
      case 'sunset':
        defs = '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="#3A2F8C"/></linearGradient>' +
          '<linearGradient id="' + id + 's" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + c3 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient>';
        b = '<rect width="100" height="100" fill="url(#' + id + ')"/><circle cx="50" cy="46" r="27" fill="url(#' + id + 's)"/>';
        [[49, 1.6], [55, 2.4], [61, 3.2], [67, 4]].forEach(function (s) { b += '<rect x="20" y="' + s[0] + '" width="60" height="' + s[1] + '" fill="#2B2470"/>'; });
        b += '<rect y="71" width="100" height="29" fill="' + c1 + '"/>';
        [74, 79, 87, 98].forEach(function (y) { b += '<path d="M0 ' + y + 'H100" stroke="' + c2 + '" stroke-width=".9"/>'; });
        for (i = -3; i <= 3; i++) b += '<path d="M50 71L' + (50 + i * 30) + ' 100" stroke="' + c3 + '" stroke-width=".8"/>';
        b += star(18, 18, 12, '#fff', 0.9) + star(84, 30, 7, '#fff', 0.8);
        break;
      case 'waves':
        defs = '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="' + c1 + '"/></linearGradient>';
        b = '<rect width="100" height="100" fill="url(#' + id + ')"/><circle cx="72" cy="26" r="11" fill="#fff"/><circle cx="72" cy="26" r="16" fill="none" stroke="' + c2 + '" stroke-width=".8" opacity=".6"/>';
        [[44, c3, 0.55], [56, c2, 0.5], [68, c2, 0.8], [81, '#17153B', 0.85]].forEach(function (w, k) {
          const y = w[0], a = k % 2 ? 7 : -7;
          b += '<path d="M0 ' + y + 'C17 ' + (y + a) + ' 33 ' + (y - a) + ' 50 ' + y + 'S83 ' + (y + a) + ' 100 ' + y + 'V100H0Z" fill="' + w[1] + '" opacity="' + w[2] + '"/>';
        });
        break;
      case 'glitch':
        b = '<rect width="100" height="100" fill="' + c1 + '"/>';
        for (i = 0; i < 16; i++) {
          const gy = n1(6 + i * 5.6), gw = n1(10 + r() * 60), gx = n1(r() * (100 - gw)), col = r() < 0.5 ? c2 : r() < 0.7 ? c3 : '#fff';
          b += '<rect x="' + gx + '" y="' + gy + '" width="' + gw + '" height="' + n1(1.5 + r() * 3) + '" fill="' + col + '" opacity="' + n1(0.55 + r() * 0.45) + '"/>';
        }
        b += '<path d="M-10 78L70 -10M30 110L110 22" stroke="#fff" stroke-width=".7" opacity=".5"/>' + star(78, 76, 22, c3, 1);
        break;
      case 'rings':
        defs = '<radialGradient id="' + id + '" cx=".5" cy=".54" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></radialGradient>' +
          '<radialGradient id="' + id + 'o"><stop offset="0" stop-color="' + c3 + '"/><stop offset="1" stop-color="' + c3 + '" stop-opacity="0"/></radialGradient>';
        b = '<rect width="100" height="100" fill="url(#' + id + ')"/>';
        for (i = 1; i <= 6; i++) b += '<circle cx="50" cy="54" r="' + (i * 8) + '" fill="none" stroke="' + (i % 2 ? c2 : '#17153B') + '" stroke-width="' + (i % 2 ? 1.4 : 0.5) + '" opacity="' + n1(0.9 - i * 0.1) + '"/>';
        b += '<circle cx="50" cy="54" r="20" fill="url(#' + id + 'o)"/><circle cx="50" cy="54" r="4" fill="#fff"/>';
        break;
      default: // dial
        defs = '<linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#A9B7C9"/><stop offset="1" stop-color="#6E7D93"/></linearGradient>';
        b = '<rect width="100" height="100" fill="' + c1 + '"/><circle cx="50" cy="50" r="40" fill="' + c2 + '"/>';
        for (i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 1.7 - Math.PI * 1.1;
          b += '<circle cx="' + n1(50 + Math.cos(ang) * 27) + '" cy="' + n1(50 + Math.sin(ang) * 27) + '" r="5.4" fill="' + c1 + '"/>';
        }
        b += '<circle cx="50" cy="50" r="13" fill="url(#' + id + ')"/><path d="M78 74l10 4-6 6z" fill="' + c3 + '"/>';
    }
    return wrapArt(defs, b, label);
  }

  /* Artist portraits: abstract chrome mannequins, one accessory each. Not real people. */
  function avatar(ar, label) {
    const id = 'p' + (++uid), c1 = ar.colors[0], c2 = ar.colors[1], c3 = ar.colors[2];
    const defs = '<linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient>' +
      '<linearGradient id="' + id + 'm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#C5D0DF"/><stop offset="1" stop-color="#6E7D93"/></linearGradient>' +
      '<linearGradient id="' + id + 'v" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FF3D9A"/><stop offset="1" stop-color="#2CE6D6"/></linearGradient>';
    const ink = '#17153B', metal = 'url(#' + id + 'm)';
    let b = '<rect width="100" height="100" fill="url(#' + id + ')"/>' + star(16, 20, 12, '#fff', 0.85) + star(86, 62, 8, '#fff', 0.7);
    let extra = '';
    switch (ar.look) {
      case 0: extra = '<path d="M41 25L34 8M59 25L66 8" stroke="' + ink + '" stroke-width="2" stroke-linecap="round"/><circle cx="34" cy="8" r="4" fill="#FF3D9A" stroke="' + ink + '"/><circle cx="66" cy="8" r="4" fill="#2CE6D6" stroke="' + ink + '"/>'; break;
      case 1: extra = '<path d="M28 44a22 24 0 0 1 44 0" fill="none" stroke="' + ink + '" stroke-width="4"/><rect x="23" y="38" width="9" height="17" rx="4" fill="' + c3 + '" stroke="' + ink + '"/><rect x="68" y="38" width="9" height="17" rx="4" fill="' + c3 + '" stroke="' + ink + '"/>'; break;
      case 2: extra = '<path d="M33 25Q40 9 50 22 60 9 67 25 58 16 50 28 42 16 33 25Z" fill="' + c2 + '" stroke="' + ink + '"/>'; break;
      case 3: extra = '<path d="M34 28L38 8 44 22 50 4 56 22 62 8 66 28Z" fill="' + c2 + '" stroke="' + ink + '" stroke-linejoin="round"/>'; break;
      case 4: extra = '<ellipse cx="50" cy="13" rx="20" ry="5" fill="none" stroke="#fff" stroke-width="3"/><ellipse cx="50" cy="13" rx="20" ry="5" fill="none" stroke="' + c3 + '" stroke-width="1"/>'; break;
      default: extra = '<path d="M30 34a20 16 0 0 1 40 0z" fill="' + c2 + '" stroke="' + ink + '"/><rect x="52" y="30" width="28" height="5" rx="2.5" fill="' + c2 + '" stroke="' + ink + '"/>';
    }
    b += '<path d="M12 100c2-21 17-31 38-31s36 10 38 31z" fill="' + metal + '" stroke="' + ink + '"/>' +
      '<rect x="44" y="60" width="12" height="12" fill="' + metal + '" stroke="' + ink + '"/>' +
      '<ellipse cx="50" cy="44" rx="19" ry="22" fill="' + metal + '" stroke="' + ink + '"/>' +
      '<rect x="30" y="37" width="40" height="11" rx="5.5" fill="url(#' + id + 'v)" stroke="' + ink + '" stroke-width="1.2"/>' +
      '<path d="M35 40.5h12" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>' + extra;
    return wrapArt(defs, b, label);
  }

  const mdArt = function (p) {
    return '<div class="md" style="--tint:' + p.tint + '" aria-hidden="true"><span class="md__label"></span><span class="md__window"><span class="md__disc"></span><span class="md__shutter"></span></span></div>';
  };
  const heartArt = function () { return '<div class="heartart" aria-hidden="true">' + ICON.heart + '</div>'; };
  const sleeveArt = function (al) {
    return '<div class="sleeve" aria-hidden="true"><span class="vinyl"></span><span class="sleeve__cover">' + coverArt(al) + '</span></div>';
  };

  /* ---------- Templates ---------- */
  function likeBtn(t) {
    return '<button type="button" class="like" data-action="like" data-id="' + t.id + '" aria-pressed="' + state.liked.has(t.id) +
      '" aria-label="Like ' + esc(t.title) + '">' + ICON.heart + '</button>';
  }
  const playBtn = function (ctx, label, extra) {
    return '<button type="button" class="bubble bubble--pink ' + (extra || '') + '" data-action="play-list" data-ctx="' + ctx + '" aria-label="Play ' + esc(label) + '">' + ICON.play + '</button>';
  };

  function trackRow(t, ctx, n) {
    const a = ARTIST[t.artist], al = ALBUM[t.album];
    return '<li class="track" data-track="' + t.id + '">' +
      '<span class="track__num" aria-hidden="true">' + n + '</span>' +
      '<button type="button" class="track__main" data-action="play-track" data-id="' + t.id + '" data-ctx="' + ctx + '">' +
        '<span class="track__art">' + coverArt(al) + '<span class="track__state" aria-hidden="true">' + ICON.play + '</span></span>' +
        '<span class="track__text"><span class="track__title">' + esc(t.title) + '</span>' +
        '<span class="track__artist">' + esc(a.name) + ' · ' + esc(GENRE[t.genre].name) + '</span></span>' +
      '</button>' +
      '<a class="track__album" href="#/album/' + al.id + '">' + esc(al.title) + '</a>' +
      '<span class="track__bpm">' + t.bpm + ' BPM · ' + esc(t.keyName) + '</span>' +
      '<span class="track__dur"><span class="sr-only">Length </span>' + fmt(Math.round(t.duration)) + '</span>' +
      likeBtn(t) +
    '</li>';
  }
  const trackList = function (ids, ctx, label) {
    return '<ul class="tracks" aria-label="' + esc(label || 'Tracks') + '">' + ids.map(function (id, i) { return trackRow(TRACK[id], ctx, i + 1); }).join('') + '</ul>';
  };

  function card(o) {
    return '<article class="card ' + (o.cls || '') + '">' +
      '<a class="card__link" href="' + o.href + '"><div class="card__art ' + (o.artCls || '') + '">' + o.art + '</div>' +
      '<h4 class="card__title">' + esc(o.title) + '</h4><p class="card__sub">' + esc(o.sub) + '</p></a>' +
      (o.ctx ? playBtn(o.ctx, o.title, 'card__play') : '') + '</article>';
  }
  const playlistCard = function (p) { return card({ href: '#/playlist/' + p.id, art: mdArt(p), title: p.title, sub: p.blurb, ctx: 'playlist:' + p.id }); };
  const albumCard = function (al) { return card({ cls: 'card--album', href: '#/album/' + al.id, art: sleeveArt(al), artCls: 'card__art--pad', title: al.title, sub: ARTIST[al.artist].name + ' · ' + al.year, ctx: 'album:' + al.id }); };
  const artistCard = function (ar) { return card({ cls: 'card--artist', href: '#/artist/' + ar.id, art: avatar(ar), title: ar.name, sub: 'Artist · ' + GENRE[ar.genre].name, ctx: 'artist:' + ar.id }); };
  const section = function (title, body, link) {
    return '<section><div class="sec__head"><h3>' + esc(title) + '</h3>' + (link ? '<a href="' + link[0] + '">' + esc(link[1]) + '</a>' : '') + '</div>' + body + '</section>';
  };
  const row = function (cards) { return '<div class="row">' + cards.join('') + '</div>'; };

  /* ---------- Filtering (search view) ---------- */
  function words() { return state.query.toLowerCase().split(/\s+/).filter(Boolean); }
  function hit(hay) { hay = hay.toLowerCase(); return words().every(function (w) { return hay.indexOf(w) !== -1; }); }
  function matchTrack(t) {
    if (state.genre !== 'all' && t.genre !== state.genre) return false;
    if (state.likedOnly && !state.liked.has(t.id)) return false;
    return hit([t.title, ARTIST[t.artist].name, ALBUM[t.album].title, GENRE[t.genre].name, t.keyName, t.bpm + ' bpm', t.leadName].join(' '));
  }
  function visibleTracks() { return D.featured.map(function (id) { return TRACK[id]; }).filter(matchTrack); }
  function matchAlbum(al) {
    if (state.genre !== 'all' && al.genre !== state.genre) return false;
    return hit([al.title, ARTIST[al.artist].name, GENRE[al.genre].name, al.year].join(' '));
  }
  function matchArtist(ar) {
    if (state.genre !== 'all' && ar.genre !== state.genre) return false;
    return hit([ar.name, GENRE[ar.genre].name, ar.base].join(' '));
  }
  function filterNote() {
    let s = '';
    if (state.genre !== 'all') s += ' in ' + GENRE[state.genre].name;
    if (state.query) s += ' matching “' + state.query + '”';
    return s;
  }
  const filtering = function () { return state.genre !== 'all' || !!state.query || state.likedOnly; };

  /* ---------- Views ---------- */
  const el = {
    view: $('#view'), search: $('#search'), toast: $('#toast'), player: $('#player'), app: $('#app'),
    seek: $('#seek'), volume: $('#volume'), mute: $('#mute'), pCur: $('#pCur'), pDur: $('#pDur'),
    pTitle: $('#pTitle'), pArtist: $('#pArtist'), pArt: $('#pArt'), pLike: $('#pLike'), pPlay: $('#pPlay'),
    side: $('#sideList'), now: $('#nowPanel'),
    journey: $('#journey'), pin: $('#pin'), intro: $('#intro'), stage: $('#introStage'), wedges: $('#introWedges'), rays: $('#introRays'),
    ring: $('.intro__ring'), dot: $('.intro__dot'), introHint: $('#introHint'), grooves: $('#grooves'), groovesPlane: $('#groovesPlane'), mag: $('#mag'), magNum: $('#magNum'),
    stack: $('#stack'), stackRow: $('#stackRow'), stackCap: $('#stackCap'), stackHint: $('#stackHint'),
    aisle: $('#aisle'), env: $('#aisleEnv'), world: $('#aisleWorld'),
    heroPlay: $('#heroPlay'), hudTitle: $('#hudTitle'), hudMeta: $('#hudMeta'), hudLike: $('#hudLike'), hudTicks: $('#hudTicks'),
    hudPrev: $('#hudPrev'), hudNext: $('#hudNext'), hudHint: $('#hudHint')
  };

  const genreTiles = function () {
    return '<div class="genres">' + D.genres.map(function (g) {
      const al = D.albums.filter(function (a) { return a.genre === g.id; })[0];
      return '<a class="gt" href="#/genre/' + g.id + '" style="--tint:' + GENRE_TINT[g.id] + '">' + esc(g.name) + '<span class="gt__art" aria-hidden="true">' + coverArt(al) + '</span></a>';
    }).join('') + '</div>';
  };

  const VIEWS = {
    home: function () {
      const h = new Date().getHours();
      const hello = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      const pick = D.albums[new Date().getDate() % D.albums.length], par = ARTIST[pick.artist];
      const quick = [{ href: '#/liked', art: heartArt(), name: 'Liked Songs', ctx: 'liked' }]
        .concat(D.playlists.map(function (p) { return { href: '#/playlist/' + p.id, art: mdArt(p), name: p.title, ctx: 'playlist:' + p.id }; }))
        .concat([{ href: '#/album/' + pick.id, art: coverArt(pick), name: pick.title, ctx: 'album:' + pick.id }]);
      return '<section class="home-deck" data-slot="deck"></section>' +
      '<section><h2 id="viewTitle">' + hello + '. What goes on the platter?</h2><div class="quick">' + quick.map(function (q) {
        return '<div class="qt"><a class="qt__link" href="' + q.href + '"><span class="qt__art">' + q.art + '</span><span class="qt__name">' + esc(q.name) + '</span></a>' +
          playBtn(q.ctx, q.name, 'bubble--sm qt__play') + '</div>';
      }).join('') + '</div></section>' +

      '<section class="feature"><div class="feature__art">' + sleeveArt(pick) + '</div><div>' +
        '<p class="feature__kicker">Record of the day</p><h3>' + esc(pick.title) + '</h3>' +
        '<p>' + esc(par.name) + ' · ' + esc(GENRE[pick.genre].name) + '. ' + esc(par.bio) + '</p>' +
        '<div class="feature__actions"><button type="button" class="bubble bubble--pink" data-action="play-list" data-ctx="album:' + pick.id + '">' + ICON.play + '<span>Play album</span></button>' +
        '<a class="ghost" href="#/album/' + pick.id + '">Open album</a></div></div></section>' +

      section('Mixtapes for late nights', row(D.playlists.map(playlistCard)), ['#/library', 'Open the crate']) +
      section('Fresh off the press', row(D.albums.map(albumCard)), ['#/library', 'Open the crate']) +
      section('Browse by genre', genreTiles()) +
      section('Artists on the wall', row(D.artists.map(artistCard))) +
      section('Heavy rotation', trackList(D.featured.slice(0, 8), 'all', 'Heavy rotation'), ['#/search', 'See every track']);
    },

    search: function () {
      const list = visibleTracks(), albums = D.albums.filter(matchAlbum), artists = D.artists.filter(matchArtist);
      const chips = '<div class="chips" role="group" aria-label="Filter by genre">' +
        [{ id: 'all', name: 'All' }].concat(D.genres).map(function (g) {
          return '<button type="button" class="chip" data-action="genre" data-id="' + g.id + '" data-fkey="g-' + g.id + '" aria-pressed="' + (state.genre === g.id) + '">' + esc(g.name) + '</button>';
        }).join('') +
        '<button type="button" class="chip" data-action="liked-only" data-fkey="liked" aria-pressed="' + state.likedOnly + '">' + ICON.heart + '<span>Liked</span><span class="chip__count">' + state.liked.size + '</span></button></div>';
      let body;
      if (list.length) body = trackList(idsOf(list), 'search', 'Tracks');
      else if (state.likedOnly && !state.liked.size) body = '<div class="empty"><strong>No liked tracks yet</strong><p>Tap the heart on any track and it will show up here.</p><button type="button" class="textbtn" data-action="clear">Show all tracks</button></div>';
      else body = '<div class="empty"><strong>' + (state.likedOnly ? 'No liked tracks' : 'Nothing found') + esc(filterNote()) + '</strong><p>Try an artist name, a genre like “house”, or a tempo like “172 bpm”.</p><button type="button" class="textbtn" data-action="clear">Clear filters</button></div>';
      return '<section><div class="sec__head"><h2 id="viewTitle">Search</h2>' +
        (filtering() ? '<button type="button" class="textbtn" data-action="clear" data-fkey="clear">Clear filters</button>' : '') + '</div>' + chips + '</section>' +
        (filtering() ? '' : section('Browse all', genreTiles())) +
        '<section><div class="sec__head"><h3>Tracks</h3><p class="count" role="status" aria-live="polite">' + plural(list.length, 'track') + (state.likedOnly ? ' you liked' : '') + esc(filterNote()) + '</p></div>' + body + '</section>' +
        (artists.length ? section('Artists', row(artists.map(artistCard))) : '') +
        (albums.length ? section('Albums', row(albums.map(albumCard))) : '');
    },

    library: function () {
      const n = state.liked.size;
      return '<section><h2 id="viewTitle">Your crate</h2><p class="muted">Everything you can pull off the shelf.</p></section>' +
        section('Playlists', '<div class="grid">' +
          card({ href: '#/liked', art: heartArt(), title: 'Liked Songs', sub: plural(n, 'liked track'), ctx: n ? 'liked' : '' }) +
          D.playlists.map(playlistCard).join('') + '</div>') +
        section('Albums', '<div class="grid">' + D.albums.map(albumCard).join('') + '</div>') +
        section('Artists', '<div class="grid">' + D.artists.map(artistCard).join('') + '</div>');
    },

    liked: function () {
      const ids = likedIds();
      return detailHead({ kind: 'Playlist', title: 'Liked Songs', tint: '#FF3D9A', art: heartArt(), meta: plural(ids.length, 'track') + (ids.length ? ' · ' + mins(ids) : ''), ctx: ids.length ? 'liked' : '' }) +
        (ids.length ? trackList(ids, 'liked', 'Liked Songs')
          : '<div class="empty"><strong>Nothing liked yet</strong><p>Tap the heart on any track and it will be saved here.</p><a class="textbtn" href="#/search">Find something to like</a></div>');
    },

    playlist: function (id) {
      const p = PLAYLIST[id];
      return detailHead({ kind: 'Playlist', title: p.title, tint: p.tint, art: mdArt(p), bare: true, meta: esc(p.blurb) + ' ' + plural(p.tracks.length, 'track') + ' · ' + mins(p.tracks) + '.', ctx: 'playlist:' + id }) +
        trackList(p.tracks, 'playlist:' + id, p.title);
    },

    album: function (id) {
      const al = ALBUM[id], ar = ARTIST[al.artist], ids = queueFor('album:' + id);
      const more = D.albums.filter(function (a) { return a.id !== id; });
      return detailHead({ kind: 'Album', title: al.title, tint: al.colors[1] === '#17153B' ? al.colors[0] : al.colors[1], art: coverArt(al, 'Cover of ' + al.title + ': ' + al.artDesc),
        meta: '<a href="#/artist/' + ar.id + '">' + esc(ar.name) + '</a> · ' + al.year + ' · ' + plural(ids.length, 'track') + ' · ' + mins(ids), ctx: 'album:' + id }) +
        trackList(ids, 'album:' + id, al.title) +
        section('About the artist', aboutCard(ar)) +
        section('More records', row(more.map(albumCard)));
    },

    artist: function (id) {
      const ar = ARTIST[id], ids = queueFor('artist:' + id);
      const albums = D.albums.filter(function (al) { return al.artist === id; });
      const others = D.artists.filter(function (a) { return a.id !== id; });
      return detailHead({ kind: 'Artist', title: ar.name, tint: GENRE_TINT[ar.genre], round: true, art: avatar(ar, 'Illustrated chrome avatar of ' + ar.name),
        meta: esc(ar.listeners) + ' monthly listeners (fictional) · ' + esc(GENRE[ar.genre].name), ctx: 'artist:' + id }) +
        section('Popular', trackList(ids, 'artist:' + id, 'Popular tracks by ' + ar.name)) +
        section('About', aboutCard(ar, true)) +
        section('Discography', '<div class="grid">' + albums.map(albumCard).join('') + '</div>') +
        section('Fans also like', row(others.map(artistCard)));
    }
  };

  function detailHead(o) {
    return '<header class="dh" style="--tint:' + o.tint + '"><div class="dh__art' + (o.round ? ' is-round' : '') + (o.bare ? ' is-bare' : '') + '">' + o.art + '</div>' +
      '<div><p class="dh__kind">' + o.kind + '</p><h2 id="viewTitle">' + esc(o.title) + '</h2><p class="dh__meta">' + o.meta + '</p></div></header>' +
      (o.ctx ? '<div class="dactions"><button type="button" class="bubble bubble--pink bubble--lg" data-action="play-list" data-ctx="' + o.ctx + '" aria-label="Play ' + esc(o.title) + '">' + ICON.play + '</button><span class="muted">Play all</span></div>' : '');
  }
  function aboutCard(ar, full) {
    const sounds = Array.from(new Set(queueFor('artist:' + ar.id).map(function (i) { return TRACK[i].leadName; }))).join(', ');
    return '<div class="about"><p>' + esc(ar.bio) + '</p><dl class="facts"><dt>Home base</dt><dd>' + esc(ar.base) + '</dd>' +
      '<dt>Monthly listeners</dt><dd>' + esc(ar.listeners) + ' (fictional)</dd><dt>Signature sound</dt><dd>' + esc(sounds) + '</dd></dl>' +
      (full ? '' : '<a class="textbtn" href="#/artist/' + ar.id + '">Open ' + esc(ar.name) + '</a>') + '</div>';
  }

  /* ---------- Router ---------- */
  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/'), name = parts[0], id = parts[1];
    if (name === 'genre' && GENRE[id]) { state.genre = id; state.likedOnly = false; return { name: 'search' }; }
    if ((name === 'playlist' && PLAYLIST[id]) || (name === 'album' && ALBUM[id]) || (name === 'artist' && ARTIST[id])) return { name: name, id: id };
    if (name === 'search' || name === 'library' || name === 'liked') return { name: name };
    return { name: 'home' };
  }
  const TITLES = { home: 'Home', search: 'Search', library: 'Your Crate', liked: 'Liked Songs' };

  function render() {
    const r = state.route, active = document.activeElement;
    const fkey = active && el.view.contains(active) ? active.getAttribute('data-fkey') : null;
    el.view.innerHTML = VIEWS[r.name](r.id);
    if (fkey) { const again = $('[data-fkey="' + fkey + '"]', el.view) || $('[data-fkey="g-all"]', el.view); if (again) again.focus(); }
    const navKey = r.name === 'liked' || r.name === 'playlist' || r.name === 'album' || r.name === 'artist' ? 'library' : r.name;
    $$('[data-nav]').forEach(function (a) { if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $$('a', el.side).forEach(function (a) { if (a.getAttribute('href') === location.hash) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const t = TRACK[state.currentId];
    if (t) $$('[data-slot="deck"]', el.view).forEach(function (slot) { slot.innerHTML = deckHTML(t); });
    findCanvases();
    syncTracks();
    setTitle();
  }
  function viewName() {
    const r = state.route;
    return r.name === 'playlist' ? PLAYLIST[r.id].title : r.name === 'album' ? ALBUM[r.id].title : r.name === 'artist' ? ARTIST[r.id].name : TITLES[r.name];
  }
  function setTitle() {
    const t = TRACK[state.currentId];
    document.title = (Engine.isPlaying() && t ? '▶ ' + t.title + ' · ' : viewName() + ' · ') + 'PULSE';
  }
  const appTop = function () { return el.app.getBoundingClientRect().top + window.pageYOffset; };
  function toApp(smoothly) {
    if (smoothly) tweenTo(Math.ceil(appTop()), 900); else { cancelAnimationFrame(tween.raf); tween.on = false; window.scrollTo(0, Math.ceil(appTop())); }
  }
  /* jump = scroll to the top of the app (used for real navigation, not for live search typing) */
  function onRoute(jump) {
    state.route = parseHash();
    render();
    if (jump) {
      toApp(window.pageYOffset < appTop() - 4);
      if (document.activeElement !== el.search) { try { el.view.focus({ preventScroll: true }); } catch (e) { el.view.focus(); } }
    }
  }
  window.addEventListener('hashchange', function () { onRoute(true); });

  /* ---------- Sidebar + now playing ---------- */
  /* The crate: every playlist and album as a record spine you can pull out */
  function renderSide() {
    const spine = function (href, name, sub, color, extra) {
      return '<li><a class="spine" href="' + href + '" style="--c:' + color + ';--ink:' + inkOn(color) + '"><span class="spine__name">' + esc(name) + '</span><span class="spine__sub"' + (extra || '') + '>' + esc(sub) + '</span></a></li>';
    };
    el.side.innerHTML = spine('#/liked', 'Liked Songs', plural(state.liked.size, 'track'), '#FF3D9A', ' id="sideCount"') +
      D.playlists.map(function (p) { return spine('#/playlist/' + p.id, p.title, 'Mix · ' + p.tracks.length, p.tint); }).join('') +
      D.albums.map(function (al) { return spine('#/album/' + al.id, al.title, 'LP · ' + al.year, al.colors[0]); }).join('');
  }

  /* The turntable: record spins and the tonearm drops while music plays */
  function deckHTML(t) {
    const a = ARTIST[t.artist], al = ALBUM[t.album];
    return '<div class="deck"><div class="deck__head"><h2 class="now__h">On the platter</h2><span class="deck__rpm" aria-hidden="true">33⅓ RPM</span></div>' +
      '<div class="tt"><div class="tt__platter"><div class="tt__rec"><div class="tt__lbl">' + coverArt(al, 'Cover of ' + al.title + ': ' + al.artDesc) + '</div></div></div>' +
      '<div class="tt__arm" aria-hidden="true"><i></i></div><span class="tt__knob" aria-hidden="true"></span><span class="tt__knob tt__knob--b" aria-hidden="true"></span></div>' +
      '<div class="now__row"><div style="flex:1;min-width:0"><p class="now__title">' + esc(t.title) + '</p><a class="now__artist" href="#/artist/' + a.id + '">' + esc(a.name) + '</a></div>' +
      '<button type="button" class="bubble bubble--pink bubble--round" data-action="toggle" aria-label="Play or pause ' + esc(t.title) + '"><span class="js-play-icon" aria-hidden="true">' + (Engine.isPlaying() ? ICON.pause : ICON.play) + '</span></button>' + likeBtn(t) + '</div>' +
      '<div class="lcd"><canvas class="viz" data-cols="24" data-rows="6" width="280" height="52" aria-hidden="true"></canvas><p>' + t.bpm + ' BPM · ' + esc(t.keyName) + ' · ' + esc(t.leadName) + '</p></div></div>';
  }

  function renderNow() {
    const t = TRACK[state.currentId];
    if (!t) return;
    const a = ARTIST[t.artist], al = ALBUM[t.album];
    const q = state.queue, at = q.indexOf(t.id), next = [];
    for (let k = 1; k <= Math.min(3, q.length - 1); k++) next.push(TRACK[q[(at + k + q.length) % q.length]]);
    $$('[data-slot="deck"]').forEach(function (slot) { slot.innerHTML = deckHTML(t); });
    el.now.innerHTML = '<div class="now__in">' + deckHTML(t) +
      '<div class="now__card"><h3>About the artist</h3><a class="now__who" href="#/artist/' + a.id + '"><span>' + avatar(a) + '</span><span>' + esc(a.name) + '</span></a>' +
      '<p>' + esc(a.bio) + '</p><p class="muted">' + esc(a.listeners) + ' monthly listeners (fictional)</p></div>' +
      (next.length ? '<div class="now__card"><h3>Up next on the stack</h3><div class="queue">' + next.map(function (n) {
        return '<button type="button" data-action="play-track" data-id="' + n.id + '" data-ctx="queue" aria-label="Play ' + esc(n.title) + ' by ' + esc(ARTIST[n.artist].name) + '">' +
          '<span class="queue__art">' + coverArt(ALBUM[n.album]) + '</span><span><span class="queue__t">' + esc(n.title) + '</span><span class="queue__a">' + esc(ARTIST[n.artist].name) + '</span></span></button>';
      }).join('') + '</div></div>' : '') + '</div>';
    findCanvases();
    paint();
  }

  /* Mark the current track everywhere it appears */
  function syncTracks() {
    const playing = Engine.isPlaying();
    $$('.track').forEach(function (li) {
      const t = TRACK[li.dataset.track], cur = t.id === state.currentId, on = cur && playing;
      li.classList.toggle('is-current', cur);
      if (cur) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
      $('.track__main', li).setAttribute('aria-label', (on ? 'Pause ' : 'Play ') + t.title + ' by ' + ARTIST[t.artist].name);
      $('.track__state', li).innerHTML = on ? ICON.eq : ICON.play;
    });
    $$('.sc').forEach(function (c) {
      const cur = c.dataset.id === state.currentId;
      c.classList.toggle('is-current', cur);
      c.classList.toggle('is-spinning', cur && playing);
      c.setAttribute('aria-label', (cur && playing ? 'Pause ' : 'Play ') + c.dataset.title);
    });
    if (el.stackCap && J.capDefault) J.capDefault();
  }

  function syncPlayButtons() {
    const playing = Engine.isPlaying(), t = TRACK[state.currentId];
    document.body.classList.toggle('is-playing', playing);
    $$('.js-play-icon').forEach(function (s) { s.innerHTML = playing ? ICON.pause : ICON.play; });
    el.pPlay.setAttribute('aria-label', (playing ? 'Pause' : 'Play') + (t ? ' ' + t.title : ''));
    syncAisle();
    setTitle();
  }

  function updateNowPlaying() {
    const t = TRACK[state.currentId];
    if (!t) return;
    const a = ARTIST[t.artist], al = ALBUM[t.album];
    el.pTitle.textContent = t.title;
    el.pArtist.textContent = a.name;
    el.pArtist.setAttribute('href', '#/artist/' + a.id);
    el.pArtist.setAttribute('aria-label', 'Artist: ' + a.name);
    el.pArt.innerHTML = coverArt(al, 'Cover of ' + al.title + ': ' + al.artDesc);
    el.pLike.innerHTML = likeBtn(t);
    el.seek.max = String(n1(t.duration));
    el.pDur.textContent = fmt(Math.round(t.duration));
    lastSec = -1;
    renderNow();
  }

  /* ---------- Playback ---------- */
  function queueFor(ctx) {
    const parts = String(ctx || 'all').split(':'), kind = parts[0], id = parts[1];
    if (kind === 'playlist' && PLAYLIST[id]) return PLAYLIST[id].tracks.slice();
    if (kind === 'album') return idsOf(D.tracks.filter(function (t) { return t.album === id; }));
    if (kind === 'artist') return idsOf(D.tracks.filter(function (t) { return t.artist === id; }));
    if (kind === 'liked') return likedIds();
    if (kind === 'search') return idsOf(visibleTracks());
    if (kind === 'queue') return state.queue.slice();
    return D.featured.slice();
  }
  function startPlayback() {
    if (Engine.play() === false) toast('This browser does not support Web Audio, so playback is unavailable.');
  }
  function loadTrack(id, autoplay) {
    state.currentId = id;
    Engine.load(TRACK[id]);
    updateNowPlaying();
    if (autoplay) startPlayback();
    syncPlayButtons();
    syncTracks();
  }
  function togglePlay() { if (Engine.isPlaying()) Engine.pause(); else startPlayback(); }
  function playTrack(id, ctx) {
    const q = queueFor(ctx);
    state.queue = q.indexOf(id) !== -1 ? q : [id];
    if (id === state.currentId) { togglePlay(); renderNow(); } else loadTrack(id, true);
  }
  function playList(ctx) {
    const q = queueFor(ctx);
    if (!q.length) { toast('Nothing to play here yet'); return; }
    state.queue = q;
    loadTrack(q[0], true);
  }
  function step(dir) {
    const q = state.queue.length ? state.queue : D.featured;
    let i = q.indexOf(state.currentId);
    if (dir < 0 && Engine.position() > 3) { Engine.seek(0); if (!Engine.isPlaying()) startPlayback(); paint(); return; }
    i = i === -1 ? 0 : (i + dir + q.length) % q.length;
    loadTrack(q[i], true);
  }
  Engine.onState(function () { syncPlayButtons(); syncTracks(); if (Engine.isPlaying()) startLoop(); else paint(); });
  Engine.onEnded(function () { step(1); });

  /* ---------- Progress + visualizer loop ---------- */
  let raf = 0, lastSec = -1, scrubbing = false, bins = null, canvases = [];

  function setFill(input, ratio) { input.style.setProperty('--fill', (clamp(ratio, 0, 1) * 100).toFixed(2) + '%'); }
  function showTime(pos) {
    const s = Math.floor(pos);
    if (s === lastSec) return;
    lastSec = s;
    el.pCur.textContent = fmt(s);
    el.seek.setAttribute('aria-valuetext', fmt(s) + ' of ' + fmt(Math.round(Engine.duration())));
  }
  function findCanvases() {
    canvases = $$('canvas.viz').map(function (c) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
      if (w && h) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      return { c: c, ctx: c.getContext ? c.getContext('2d') : null, cols: Number(c.dataset.cols) || 24, rows: Number(c.dataset.rows) || 6 };
    });
  }
  /* LCD-style segmented spectrum. With reduced motion it shows a still level pattern instead. */
  function drawViz() {
    const playing = Engine.isPlaying(), an = Engine.analyser();
    const live = playing && an && !reduceMotion.matches;
    if (live) {
      if (!bins) bins = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(bins);
    }
    canvases.forEach(function (v) {
      if (!v.ctx || !v.c.clientWidth) return;
      const W = v.c.width, H = v.c.height, N = v.cols, ROWS = v.rows;
      const gap = Math.max(1, Math.round(W * 0.01));
      const bw = (W - gap * (N - 1)) / N, bh = (H - gap * (ROWS - 1)) / ROWS;
      v.ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < N; i++) {
        let level = 1;
        if (live) {
          const a = Math.floor(Math.pow(i / N, 1.6) * 88) + 1, b = Math.floor(Math.pow((i + 1) / N, 1.6) * 88) + 2;
          let m = 0;
          for (let k = a; k < b; k++) if (bins[k] > m) m = bins[k];
          level = clamp(Math.round((m / 255) * ROWS * (1 + (i / N) * 0.7)), 1, ROWS);
        } else if (playing) {
          level = 1 + ((i * 7) % Math.max(2, ROWS - 2));
        }
        for (let r = 0; r < ROWS; r++) {
          v.ctx.fillStyle = r < level ? (r >= ROWS - Math.ceil(ROWS / 3) ? '#FF3D9A' : '#2CE6D6') : 'rgba(44, 230, 214, .16)';
          v.ctx.fillRect(i * (bw + gap), H - (r + 1) * bh - r * gap, bw, bh);
        }
      }
    });
  }
  function paint() {
    const pos = Engine.position(), dur = Engine.duration() || 1;
    if (!scrubbing) {
      el.seek.value = String(pos);
      setFill(el.seek, pos / dur);
      showTime(pos);
    }
    drawViz();
  }
  function loop() {
    paint();
    raf = Engine.isPlaying() ? requestAnimationFrame(loop) : 0;
  }
  function startLoop() { if (!raf) raf = requestAnimationFrame(loop); }

  /* Seek slider: preview while dragging, commit on release. Arrow keys jump 5 seconds. */
  el.seek.addEventListener('input', function () {
    scrubbing = true;
    const v = Number(el.seek.value);
    setFill(el.seek, v / (Engine.duration() || 1));
    showTime(v);
  });
  function commitSeek() {
    if (!scrubbing) return;
    Engine.seek(Number(el.seek.value));
    scrubbing = false;
    paint();
  }
  ['change', 'pointerup', 'touchend', 'blur'].forEach(function (type) { el.seek.addEventListener(type, commitSeek); });
  el.seek.addEventListener('keydown', function (e) {
    const jump = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 15, PageDown: -15 }[e.key];
    let to = null;
    if (jump) to = Engine.position() + jump;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = Engine.duration() - 1;
    if (to === null) return;
    e.preventDefault();
    Engine.seek(to);
    scrubbing = false;
    paint();
  });

  /* Volume */
  function applyVolume(v, save) {
    state.volume = v;
    Engine.setVolume(v / 100);
    el.volume.value = String(v);
    setFill(el.volume, v / 100);
    el.volume.setAttribute('aria-valuetext', v + '%');
    el.mute.innerHTML = v === 0 ? ICON.muted : ICON.volume;
    el.mute.setAttribute('aria-pressed', String(v === 0));
    if (save) store.set('volume', v);
  }
  el.volume.addEventListener('input', function () {
    const v = Number(el.volume.value);
    if (v > 0) state.lastVolume = v;
    applyVolume(v, true);
  });
  function toggleMute() {
    if (state.volume > 0) { state.lastVolume = state.volume; applyVolume(0, true); toast('Muted'); }
    else { applyVolume(state.lastVolume || 80, true); toast('Sound on'); }
  }

  /* ---------- Likes ---------- */
  function toggleLike(id, btn) {
    const t = TRACK[id];
    if (!t) return;
    const liked = !state.liked.has(id);
    if (liked) state.liked.add(id); else state.liked.delete(id);
    store.set('liked', Array.from(state.liked));
    $$('[data-action="like"][data-id="' + id + '"]').forEach(function (b) { b.setAttribute('aria-pressed', String(liked)); });
    if (liked && btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
    const n = state.liked.size;
    $$('.chip__count').forEach(function (c) { c.textContent = String(n); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); });
    const sc = $('#sideCount');
    if (sc) sc.textContent = plural(n, 'track');
    toast(liked ? 'Added “' + t.title + '” to Liked Songs · ' + plural(n, 'track') : 'Removed “' + t.title + '” from Liked Songs');
    // Views that list liked tracks need a refresh; keep keyboard focus somewhere sensible
    const name = state.route.name, inView = btn && el.view.contains(btn);
    if (name === 'liked' || name === 'library' || (name === 'search' && state.likedOnly)) {
      render();
      if (inView) { const again = $('[data-action="like"][data-id="' + id + '"]', el.view) || el.view; again.focus({ preventScroll: true }); }
    }
  }

  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('is-on'); }, 2400);
  }

  /* ---------- Search ---------- */
  function clearFilters() {
    state.genre = 'all'; state.query = ''; state.likedOnly = false;
    el.search.value = '';
    render();
    const all = $('[data-fkey="g-all"]', el.view);
    if (all) all.focus();
  }
  el.search.addEventListener('input', function () {
    state.query = el.search.value.trim();
    if (state.route.name !== 'search') {
      if (location.hash === '#/search') onRoute(true); else location.hash = '#/search';
    } else {
      render();
    }
  });
  el.search.addEventListener('focus', function () {
    if (window.pageYOffset < appTop() - 4) toApp(false);
  });
  $('#searchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (state.route.name !== 'search') { location.hash = '#/search'; return; }
    const first = $('.track__main', el.view);
    if (first) first.focus();
  });

  /* =====================================================================
     SCROLL JOURNEY: vinyl -> record library -> app
     ===================================================================== */
  const AISLE = D.featured.slice(0, 2);   // the two records hanging in the aisle
  const STACK_STOPS = 3;                  // scroll stops along the whole-collection row
  const BAYS = 9;
  const J = { vh: 0, lead: 0, unit: 0, stops: [], end: 0, gap: 520, front: -1, zone: '', inJ: null, raf: 0, recs: [], bays: [], w: 0, card: 200, capDefault: null };
  const recPos = function (i) { return i % 2 ? { x: 0.34, y: -0.08 } : { x: -0.34, y: 0.05 }; };

  function buildAisle() {
    // Shelf bays. One side is built, the other is its mirror image.
    const sideHTML = function (j, m) {
      const g = D.genres[(j + m) % D.genres.length];
      let h = '<div class="fin"><span class="fin__sign">' + esc(g.name.toUpperCase()) + '</span></div>';
      for (let r = 0; r < 3; r++) h += '<div class="shelfrow" style="--r:' + r + '"></div>';
      for (let r = 0; r < 4; r++) h += '<div class="ledge" style="--r:' + r + '"></div>';
      h += '<div class="lip" style="--r:1"></div><div class="lip" style="--r:2"></div>';
      [[0.22, 1], [0.5, 0], [0.8, 2]].forEach(function (p, n) {
        h += '<div class="pull" style="--zf:' + p[0] + ';--r:' + ((p[1] + j + m) % 3) + '">' + coverArt(D.albums[(j * 3 + n + m * 2) % D.albums.length]) + '</div>';
      });
      return h;
    };
    let env = '';
    for (let j = 0; j < BAYS; j++) {
      env += '<div class="bay" style="--j:' + j + '"><div class="tile tile--floor"></div><div class="tile tile--ceil"></div>' +
        '<div class="bay__side">' + sideHTML(j, 0) + '</div><div class="bay__side bay__side--r">' + sideHTML(j, 3) + '</div></div>';
    }
    el.env.innerHTML = env;
    J.bays = $$('.bay', el.env);

    el.world.innerHTML = AISLE.map(function (id, i) {
      const t = TRACK[id], al = ALBUM[t.album], pos = recPos(i);
      return '<div class="rec" data-i="' + i + '" style="--i:' + i + ';--x:' + pos.x + ';--y:' + pos.y + '"><i class="rec__rod"></i><i class="rec__rod"></i>' +
        '<div class="rec__vinyl"><div class="rec__spin"><div class="rec__label">' + coverArt(al) + '</div></div></div>' +
        '<div class="rec__sleeve">' + coverArt(al) + '<span class="rec__sticker">' + esc(t.title) + '</span></div></div>';
    }).join('');
    J.recs = $$('.rec', el.world);
    el.hudTicks.innerHTML = AISLE.map(function () { return '<i></i>'; }).join('');

    // The whole collection as a diagonal row of sleeves
    el.stackRow.innerHTML = D.featured.map(function (id, i) {
      const t = TRACK[id], al = ALBUM[t.album], name = t.title + ' by ' + ARTIST[t.artist].name;
      return '<button type="button" class="sc" style="--i:' + i + '" data-action="play-track" data-id="' + id + '" data-ctx="all" data-title="' + esc(name) + '" aria-label="Play ' + esc(name) + '">' +
        '<span class="sc__in"><span class="sc__vinyl"><span class="sc__lbl">' + coverArt(al) + '</span></span>' +
        '<span class="sc__sleeve">' + coverArt(al) + '<span class="rec__sticker">' + esc(t.title) + '</span></span></span></button>';
    }).join('');
    const cap = function (id) {
      const t = TRACK[id];
      el.stackCap.innerHTML = t ? '<b>' + esc(t.title) + '</b><span>' + esc(ARTIST[t.artist].name) + ' · ' + esc(GENRE[t.genre].name) + (id === state.currentId && Engine.isPlaying() ? ' · playing' : '') + '</span>' : '';
    };
    J.capDefault = function () { const h = $('.sc:hover', el.stackRow) || (document.activeElement && document.activeElement.classList.contains('sc') ? document.activeElement : null); cap(h ? h.dataset.id : (Engine.isPlaying() ? state.currentId : '')); };
    el.stackRow.addEventListener('mouseover', function (e) { const c = e.target.closest('.sc'); if (c) cap(c.dataset.id); });
    el.stackRow.addEventListener('focusin', function (e) { const c = e.target.closest('.sc'); if (c) cap(c.dataset.id); });
    el.stackRow.addEventListener('mouseleave', function () { J.capDefault(); });
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) el.stackHint.textContent = 'Tap a record to pull it out and play it. Swipe for more.';

    // Loading screen dressing
    const labels = ['HYPERPOP', 'SYNTHWAVE', 'LO-FI', 'DRUM & BASS', 'AMBIENT', 'HOUSE', 'PLAYLISTS', 'ALBUMS', 'ARTISTS', 'LIKES'];
    el.wedges.innerHTML = D.albums.map(function (al, i) {
      const a1 = (i * 60 - 90) * Math.PI / 180, a2 = ((i + 1) * 60 - 90) * Math.PI / 180, mid = (a1 + a2) / 2;
      const pt = function (a) { return 'calc(50% + ' + n1(Math.cos(a) * 160) + 'vmax) calc(50% + ' + n1(Math.sin(a) * 160) + 'vmax)'; };
      return '<div class="wedge" style="--n:' + i + ';clip-path:polygon(50% 50%, ' + pt(a1) + ', ' + pt(a2) + ')">' +
        '<div class="wedge__art" style="left:calc(50% + ' + n1(Math.cos(mid) * 40) + 'vmax);top:calc(50% + ' + n1(Math.sin(mid) * 40) + 'vmax)">' + coverArt(al) + '</div></div>';
    }).join('');
    $('#introLabels').innerHTML = labels.map(function (name, i) {
      const off = (50 + ((18 + i * 36) / 360) * 100) % 100;
      return '<text style="--n:' + i + '"><textPath href="#introOuter" startOffset="' + n1(off) + '%" text-anchor="middle">' + esc(name) + '</textPath></text>';
    }).join('');
    setTimeout(function () {
      el.intro.classList.add('is-ready');
      el.introHint.textContent = 'Tap the record or scroll to tune in';
    }, reduceMotion.matches ? 0 : 2600);
  }

  /* Scroll positions: 0 = vinyl, then one stop per record, then the app. */
  function layoutJourney(force) {
    const w = window.innerWidth, vh = el.pin.offsetHeight || window.innerHeight;
    if (!force && w === J.w && Math.abs(vh - J.vh) < 140) return;   // ignore mobile toolbar show/hide
    J.w = w; J.vh = vh;
    J.lead = Math.round(vh * 0.85);
    J.unit = Math.round(vh * 0.6);
    J.stops = [0];
    for (let i = 0; i < AISLE.length + STACK_STOPS; i++) J.stops.push(J.lead + i * J.unit);
    J.end = J.stops[J.stops.length - 1];
    el.journey.style.height = (J.end + vh) + 'px';
    const rec = J.recs[0] ? J.recs[0].offsetWidth : 0;
    J.gap = Math.round((rec || 240) * 2.1);
    el.aisle.style.setProperty('--gap', J.gap + 'px');
    const card = $('.sc', el.stackRow);
    J.card = card ? card.offsetWidth : 200;
    J.front = -1;
    updateJourney();
  }

  function setFront(i) {
    J.front = i;
    const t = TRACK[AISLE[i]], last = AISLE.length - 1;
    J.recs.forEach(function (r, k) { r.classList.toggle('is-front', k === i); });
    $$('i', el.hudTicks).forEach(function (tick, k) { tick.classList.toggle('is-on', k === i); });
    el.hudTitle.textContent = t.title;
    el.hudMeta.textContent = ARTIST[t.artist].name + ' · ' + GENRE[t.genre].name + ' · ' + t.bpm + ' BPM';
    el.hudLike.innerHTML = likeBtn(t);
    el.hudPrev.setAttribute('aria-label', i === 0 ? 'Back to the opening record' : 'Previous record');
    el.hudNext.setAttribute('aria-label', i === last ? 'Show the whole collection' : 'Next record');
    el.hudHint.textContent = i === last ? 'Keep scrolling for the whole collection' : 'Scroll or swipe to flip through the records';
    syncAisle();
  }

  function syncAisle() {
    const front = TRACK[AISLE[Math.max(0, J.front)]];
    if (!front) return;
    const playing = Engine.isPlaying(), on = front.id === state.currentId && playing;
    $('#heroPlayIcon').innerHTML = on ? ICON.pause : ICON.play;
    $('#heroPlayText').textContent = on ? 'Pause' : 'Play';
    el.heroPlay.setAttribute('aria-label', (on ? 'Pause ' : 'Play ') + front.title + ' by ' + ARTIST[front.artist].name);
    J.recs.forEach(function (r, k) { r.classList.toggle('is-spinning', playing && AISLE[k] === state.currentId); });
  }

  /* Everything in the journey is a pure function of scroll position. */
  function updateJourney() {
    J.raf = 0;
    const y = window.pageYOffset || 0, reduce = reduceMotion.matches, last = AISLE.length - 1;
    const inJ = y < appTop() - J.vh * 0.45;
    if (inJ !== J.inJ) { J.inJ = inJ; document.body.classList.toggle('in-journey', inJ); el.player.inert = inJ; }
    if (y > J.end + J.vh * 1.15) return;   // deep in the app: nothing to draw
    let p = clamp(y / J.lead, 0, 1), q = clamp((y - J.lead) / J.unit, 0, last);
    let s = clamp((y - J.stops[AISLE.length]) / J.unit, 0, 1);                       // camera swing to the side view
    let t = clamp((y - J.stops[AISLE.length + 1]) / J.unit, 0, STACK_STOPS - 1);     // travel along the row
    if (reduce) { p = p < 0.5 ? 0 : 1; q = Math.round(q); s = s < 0.5 ? 0 : 1; t = Math.round(t); }

    // 1. Vinyl: tilt back and zoom into the grooves until they become a road to the horizon
    const gone = p >= 0.995;
    el.intro.style.visibility = gone ? 'hidden' : 'visible';
    if (!gone) {
      const tilt = 64 * smooth(0, 0.4, p), zoom = 1 + 30 * Math.pow(smooth(0.06, 0.78, p), 2.3);
      el.intro.style.opacity = String(1 - smooth(0.8, 0.97, p));
      el.stage.style.transform = reduce || p === 0 ? '' : 'perspective(1000px) rotateX(' + n1(tilt) + 'deg) scale(' + zoom.toFixed(3) + ')';
      el.stage.style.opacity = String(1 - smooth(0.52, 0.72, p));
      el.wedges.style.opacity = String(1 - smooth(0, 0.22, p));
      el.ring.style.opacity = el.dot.style.opacity = String(1 - smooth(0.02, 0.2, p));
      el.rays.style.opacity = '0';
      el.grooves.style.opacity = String(smooth(0.42, 0.66, p));
      el.groovesPlane.style.backgroundPosition = '0 0, ' + n1(p * 90) + 'px 0, 0 ' + n1(p * 900) + 'px';
      el.introHint.style.opacity = String(1 - smooth(0, 0.12, p));
      const mag = Math.pow(355, smooth(0.04, 0.8, p));
      el.magNum.textContent = '×' + (mag < 10 ? mag.toFixed(1) : String(Math.round(mag)));
      el.mag.style.opacity = String(smooth(0.03, 0.1, p) * (1 - smooth(0.82, 0.95, p)));
    }

    // 2. Aisle: fly in, then move one bay per record. It fades as the camera swings away.
    const es = smooth(0, 1, s);
    const aisleOn = p > 0.6 && s < 0.98;
    el.aisle.style.visibility = aisleOn ? 'visible' : 'hidden';
    if (aisleOn) {
      el.aisle.style.opacity = String(smooth(0.72, 0.96, p) * (1 - smooth(0.05, 0.6, s)));
      const travel = q * J.gap - (reduce ? 0 : Math.pow(1 - p, 2) * J.gap * 3) + es * J.gap * 0.5;
      const i0 = Math.floor(q), f = q - i0, a = recPos(i0), b = recPos(Math.min(i0 + 1, last));
      const cx = a.x + (b.x - a.x) * f, cy = a.y + (b.y - a.y) * f;
      const tf = 'translate3d(calc(var(--rec) * ' + (-cx).toFixed(4) + '), calc(var(--rec) * ' + (-cy).toFixed(4) + '), ' + n1(travel) + 'px)';
      el.env.style.transform = tf;
      el.world.style.transform = tf;
      J.bays.forEach(function (bay, j) {
        const near = J.gap - j * J.gap + travel;            // z of the bay's near edge
        bay.style.visibility = (near - J.gap > J.gap * 1.2 || near < -J.gap * 5.6) ? 'hidden' : 'visible';
        bay.style.setProperty('--n', (near / J.gap).toFixed(3));
      });
      J.recs.forEach(function (r, k) {
        const d = k - q;
        r.style.opacity = (d >= 0 ? Math.max(0.16, 1 - 0.36 * d) : clamp(1 + d * 2.4, 0, 1)).toFixed(3);
        r.style.pointerEvents = d > -0.3 && d < 1.5 ? 'auto' : 'none';
      });
    }
    const front = clamp(Math.round(q), 0, last);
    if (front !== J.front) setFront(front);

    // 3. The whole collection: the camera swings round to a side view of the row
    const stackOn = s > 0.02;
    el.stack.style.visibility = stackOn ? 'visible' : 'hidden';
    if (stackOn) {
      const step = J.card * 0.46;
      el.stack.style.opacity = String(smooth(0.1, 0.6, s));
      el.stackRow.style.left = n1(50 - 22 * es) + '%';
      el.stackRow.style.top = n1(43 + 21 * es) + '%';
      el.stackRow.style.transform = 'rotateX(' + n1(-17 * es) + 'deg) rotateY(' + n1(-56 * es) + 'deg) translateZ(' + n1(t * 4 * step) + 'px)';
    }

    const zone = p < 0.5 ? 'intro' : s < 0.5 ? 'aisle' : 'stack';
    if (zone !== J.zone) {
      J.zone = zone;
      el.intro.inert = zone !== 'intro';
      el.aisle.inert = zone !== 'aisle';
      el.stack.inert = zone !== 'stack';
      el.pin.dataset.zone = zone;
    }
  }
  function onScroll() {
    if (!J.raf) J.raf = requestAnimationFrame(updateJourney);
    if (!tween.on) scheduleSettle();
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Scroll controller ----------
     Inside the journey one gesture moves exactly one stop: vinyl -> record 1..4 -> app.
     The page still really scrolls (the tween sets scrollY), so the scene stays a function of scroll
     position and scrolling up replays it in reverse. Below the journey, scrolling is native. */
  const tween = { on: false, raf: 0, target: 0, until: 0 };
  function allStops() { return J.stops.concat([Math.ceil(appTop())]); }
  function nearestStop(y) {
    const s = allStops();
    let best = 0;
    s.forEach(function (v, i) { if (Math.abs(v - y) < Math.abs(s[best] - y)) best = i; });
    return best;
  }
  function tweenTo(top, ms) {
    cancelAnimationFrame(tween.raf);
    const from = window.pageYOffset || 0, dist = top - from;
    if (reduceMotion.matches || Math.abs(dist) < 2) { tween.on = false; window.scrollTo(0, top); return; }
    const t0 = performance.now();
    tween.on = true; tween.target = top;
    const frame = function (now) {
      const k = clamp((now - t0) / ms, 0, 1);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      window.scrollTo(0, Math.round(from + dist * e));
      if (k < 1) tween.raf = requestAnimationFrame(frame);
      else { tween.on = false; tween.until = now + 180; }
    };
    tween.raf = requestAnimationFrame(frame);
  }
  function goStop(i) {
    const s = allStops();
    i = clamp(i, 0, s.length - 1);
    const from = window.pageYOffset || 0, zoomLeg = (i === 0 || nearestStop(from) === 0) && i <= 1 && Math.abs(s[i] - from) > 40;
    tweenTo(s[i], zoomLeg ? 1900 : clamp(Math.abs(s[i] - from) * 1.3, 700, 1200));
  }
  function stepStop(dir) { goStop(nearestStop(tween.on ? tween.target : (window.pageYOffset || 0)) + dir); }
  const inJourney = function () { return (window.pageYOffset || 0) < appTop() - 2; };

  // Mouse wheel / trackpad
  let wheelAcc = 0, wheelAt = 0;
  window.addEventListener('wheel', function (e) {
    if (e.ctrlKey) return;                                   // pinch-zoom
    const y = window.pageYOffset || 0, top = appTop();
    const backIn = y <= top + 2 && e.deltaY < 0 && !(e.target.closest && e.target.closest('.side, .now'));
    if (!(y < top - 2) && !backIn) return;                   // in the app: native scrolling
    e.preventDefault();
    const now = performance.now();
    if (tween.on || now < tween.until) { wheelAcc = 0; wheelAt = now; return; }
    if (now - wheelAt > 200) wheelAcc = 0;                   // trackpad inertia tails never add up to a step
    wheelAt = now;
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    if (Math.abs(wheelAcc) >= 48) { stepStop(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; }
  }, { passive: false });

  // Touch: a swipe on the pinned scene moves one stop
  (function () {
    let sx = 0, sy = 0, down = false, swiped = false;
    el.pin.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      down = true; swiped = false; sx = e.clientX; sy = e.clientY;
    });
    window.addEventListener('pointerup', function (e) {
      if (!down) return;
      down = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dy) > 34 && Math.abs(dy) >= Math.abs(dx)) { swiped = true; stepStop(dy < 0 ? 1 : -1); }
      else if (Math.abs(dx) > 48) { swiped = true; stepStop(dx < 0 ? 1 : -1); }
    });
    window.addEventListener('pointercancel', function () { down = false; });
    el.pin.addEventListener('click', function (e) {
      if (swiped) { swiped = false; e.stopPropagation(); e.preventDefault(); }
    }, true);
  })();

  // Anything that leaves the page between two stops (scrollbar drag, touch-scrolling up out of the app,
  // resize) settles on the nearest stop once scrolling goes quiet.
  let settleTimer = 0, touching = false;
  window.addEventListener('touchstart', function () { touching = true; }, { passive: true });
  window.addEventListener('touchend', function () { touching = false; scheduleSettle(); }, { passive: true });
  function scheduleSettle() { clearTimeout(settleTimer); settleTimer = setTimeout(settle, 170); }
  function settle() {
    if (tween.on || touching || window.__pulseFreeze || !inJourney()) return;
    const s = allStops(), i = nearestStop(window.pageYOffset || 0);
    if (Math.abs(s[i] - (window.pageYOffset || 0)) > 2) goStop(i);
  }

  function goRecord(i) { goStop(clamp(i + 1, 0, AISLE.length + 1)); }   // past the last record = the collection view
  function playBrowse() {
    const id = AISLE[Math.max(0, J.front)];
    if (id === state.currentId) { togglePlay(); return; }
    state.queue = D.featured.slice();
    loadTrack(id, true);
  }
  el.world.addEventListener('click', function (e) {
    const r = e.target.closest ? e.target.closest('.rec') : null;
    if (!r) return;
    const i = Number(r.dataset.i);
    if (i === J.front) playBrowse(); else goRecord(i);
  });
  el.aisle.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); goRecord(J.front + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goRecord(J.front - 1); }
  });

  /* ---------- Events ---------- */
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    // Route links pointing at the page we are already on still need to jump to the app
    const link = e.target.closest('a[href^="#/"]');
    if (link && link.getAttribute('href') === location.hash) { e.preventDefault(); onRoute(true); return; }
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const id = t.dataset.id;
    switch (t.dataset.action) {
      case 'toggle': togglePlay(); break;
      case 'next': step(1); break;
      case 'prev': step(-1); break;
      case 'play-track': playTrack(id, t.dataset.ctx); break;
      case 'play-list': playList(t.dataset.ctx); break;
      case 'play-browse': playBrowse(); break;
      case 'browse-next': goRecord(J.front + 1); break;
      case 'browse-prev': goRecord(J.front - 1); break;
      case 'enter': goRecord(0); break;
      case 'to-stacks': goRecord(0); break;
      case 'like': toggleLike(id, t); break;
      case 'mute': toggleMute(); break;
      case 'genre': state.genre = id; render(); break;
      case 'liked-only': state.likedOnly = !state.likedOnly; render(); break;
      case 'clear': clearFilters(); break;
      case 'back': history.back(); break;
      case 'forward': history.forward(); break;
    }
  });

  document.addEventListener('keydown', function (e) {
    const tag = e.target && e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); el.search.focus(); return; }
    if ((e.key === ' ' || e.code === 'Space') && (e.target === document.body || e.target === document.documentElement)) { e.preventDefault(); togglePlay(); return; }
    if (!typing && !e.altKey && !e.metaKey && inJourney()) {
      const move = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[e.key];
      if (move) { e.preventDefault(); stepStop(move); }
      else if (e.key === 'Home') { e.preventDefault(); goStop(0); }
      else if (e.key === 'End') { e.preventDefault(); goStop(99); }
    }
  });

  function measure() {
    document.documentElement.style.setProperty('--bar-h', el.player.offsetHeight + 'px');
    layoutJourney(false);
    findCanvases();
    drawViz();
  }
  window.addEventListener('resize', measure);
  if (window.ResizeObserver) new ResizeObserver(measure).observe(el.player);

  /* ---------- Boot ---------- */
  buildAisle();
  renderSide();
  state.lastVolume = state.volume || 80;
  applyVolume(state.volume, false);
  state.route = parseHash();
  render();
  loadTrack(D.featured[0], false);
  document.documentElement.style.setProperty('--bar-h', el.player.offsetHeight + 'px');
  layoutJourney(true);
  findCanvases();
  paint();
  if (/^#\/\w/.test(location.hash)) {
    toApp(false);                       // deep link: go straight to the app
  } else if ((window.pageYOffset || 0) < 4) {
    try { $('#introEnter').focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
  }
})();
