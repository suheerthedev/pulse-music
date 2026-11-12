/* PULSE — interface logic: library, filters, search, likes, detail sheet, player bar. */
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

  const TRACK = index(D.tracks), ARTIST = index(D.artists), ALBUM = index(D.albums),
    GENRE = index(D.genres), PLAYLIST = index(D.playlists);
  D.albums.forEach(function (a) { a.genre = ARTIST[a.artist].genre; });

  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  const store = {
    get: function (k, fallback) {
      try { const v = localStorage.getItem('pulse:' + k); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set: function (k, v) { try { localStorage.setItem('pulse:' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  const state = {
    genre: 'all',
    query: '',
    likedOnly: false,
    liked: new Set((store.get('liked', []) || []).filter(function (id) { return TRACK[id]; })),
    queue: D.featured.slice(),
    currentId: null,
    volume: Math.max(0, Math.min(100, Number(store.get('volume', 80)) || 0)),
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

  /* ---------- Icons ---------- */
  const svg = function (inner, extra) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"' + (extra || '') + '>' + inner + '</svg>'; };
  const ICON = {
    play: svg('<path d="M8 5.5v13a1 1 0 0 0 1.52.86l10.4-6.5a1 1 0 0 0 0-1.72L9.52 4.64A1 1 0 0 0 8 5.5z"/>'),
    pause: svg('<rect x="6" y="5" width="4.6" height="14" rx="1.3"/><rect x="13.4" y="5" width="4.6" height="14" rx="1.3"/>'),
    heart: svg('<path d="M12 20.4s-7.6-4.6-7.6-10.3A4.3 4.3 0 0 1 12 7.5a4.3 4.3 0 0 1 7.6 2.6c0 5.7-7.6 10.3-7.6 10.3z"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
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

  /* ---------- Templates ---------- */
  function likeBtn(t) {
    return '<button type="button" class="like" data-action="like" data-id="' + t.id + '" aria-pressed="' + state.liked.has(t.id) +
      '" aria-label="Like ' + esc(t.title) + '">' + ICON.heart + '</button>';
  }

  function trackRow(t, ctx) {
    const a = ARTIST[t.artist];
    return '<li class="track" data-track="' + t.id + '">' +
      '<button type="button" class="track__main" data-action="play-track" data-id="' + t.id + '" data-ctx="' + ctx + '">' +
        '<span class="track__art">' + coverArt(ALBUM[t.album]) + '<span class="track__state" aria-hidden="true">' + ICON.play + '</span></span>' +
        '<span class="track__text"><span class="track__title">' + esc(t.title) + '</span>' +
        '<span class="track__artist">' + esc(a.name) + '<span class="track__genre-inline"> · ' + esc(GENRE[t.genre].name) + '</span></span></span>' +
      '</button>' +
      '<span class="track__genre">' + esc(GENRE[t.genre].name) + '</span>' +
      '<span class="track__bpm">' + t.bpm + ' BPM · ' + esc(t.keyName) + '</span>' +
      '<span class="track__dur"><span class="sr-only">Length </span>' + fmt(Math.round(t.duration)) + '</span>' +
      likeBtn(t) +
    '</li>';
  }

  /* ---------- Filtering ---------- */
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

  /* ---------- Rendering ---------- */
  const el = {
    chips: $('#chips'), trackList: $('#trackList'), trackEmpty: $('#trackEmpty'), resultCount: $('#resultCount'),
    clear: $('#clearFilters'), playlistGrid: $('#playlistGrid'), albumGrid: $('#albumGrid'), albumCount: $('#albumCount'),
    artistGrid: $('#artistGrid'), artistCount: $('#artistCount'), search: $('#search'),
    sheet: $('#sheet'), backdrop: $('#backdrop'), toast: $('#toast'), player: $('#player'),
    seek: $('#seek'), volume: $('#volume'), mute: $('#mute'), pCur: $('#pCur'), pDur: $('#pDur'),
    pTitle: $('#pTitle'), pArtist: $('#pArtist'), pArt: $('#pArt'), pLike: $('#pLike'),
    viz: $('#viz'), heroPlay: $('#heroPlay'), pPlay: $('#pPlay'),
    stacks: $('#stacks'), world: $('#stacksWorld'), hudTitle: $('#hudTitle'), hudMeta: $('#hudMeta'),
    hudLike: $('#hudLike'), hudTicks: $('#hudTicks'), intro: $('#intro')
  };

  function renderChips() {
    el.chips.innerHTML = [{ id: 'all', name: 'All' }].concat(D.genres).map(function (g) {
      return '<button type="button" class="chip" data-action="genre" data-id="' + g.id + '" aria-pressed="' + (state.genre === g.id) + '">' + esc(g.name) + '</button>';
    }).join('') +
      '<button type="button" class="chip chip--liked" data-action="liked-only" aria-pressed="' + state.likedOnly + '">' + ICON.heart +
      '<span>Liked</span><span class="chip__count" id="likedCount">' + state.liked.size + '</span></button>';
  }
  function syncChips() {
    $$('.chip[data-action="genre"]', el.chips).forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.id === state.genre)); });
    $('.chip--liked', el.chips).setAttribute('aria-pressed', String(state.likedOnly));
  }

  function renderLibrary() {
    const list = visibleTracks();
    el.trackList.innerHTML = list.map(function (t) { return trackRow(t, 'library'); }).join('');
    el.trackList.hidden = !list.length;
    el.trackEmpty.hidden = !!list.length;
    if (!list.length) {
      const likedEmpty = state.likedOnly && !state.liked.size;
      el.trackEmpty.innerHTML = likedEmpty
        ? '<strong>No liked tracks yet</strong><p>Tap the heart on any track and it will show up here.</p><button type="button" class="textbtn" data-action="clear">Show all tracks</button>'
        : '<strong>' + (state.likedOnly ? 'No liked tracks' : 'Nothing found') + esc(filterNote()) + '</strong><p>Try an artist name, a genre like “house”, or a tempo like “172 bpm”.</p><button type="button" class="textbtn" data-action="clear">Clear filters</button>';
    }
    el.resultCount.textContent = plural(list.length, 'track') + (state.likedOnly ? ' you liked' : '') + filterNote();
    el.clear.hidden = !(state.genre !== 'all' || state.query || state.likedOnly);

    const albums = D.albums.filter(matchAlbum);
    el.albumGrid.innerHTML = albums.length ? albums.map(function (al) {
      const ar = ARTIST[al.artist];
      return '<article class="case">' +
        '<button type="button" class="case__open" data-action="open-album" data-id="' + al.id + '" aria-label="Open album ' + esc(al.title) + ' by ' + esc(ar.name) + '">' +
        '<span class="case__disc" aria-hidden="true"></span><span class="case__cover">' + coverArt(al) + '</span></button>' +
        '<h3 class="case__title">' + esc(al.title) + '</h3><p class="case__meta">' + esc(ar.name) + ' · ' + al.year + '</p></article>';
    }).join('') : '<p class="shelf__none">No albums' + esc(filterNote()) + '.</p>';
    el.albumCount.textContent = plural(albums.length, 'album') + filterNote();

    const artists = D.artists.filter(matchArtist);
    el.artistGrid.innerHTML = artists.length ? artists.map(function (ar) {
      return '<button type="button" class="artist" data-action="open-artist" data-id="' + ar.id + '">' +
        '<span class="artist__ring">' + avatar(ar) + '</span><span class="artist__name">' + esc(ar.name) + '</span>' +
        '<span class="artist__genre">' + esc(GENRE[ar.genre].name) + '</span></button>';
    }).join('') : '<p class="shelf__none">No artists' + esc(filterNote()) + '.</p>';
    el.artistCount.textContent = plural(artists.length, 'artist') + filterNote() + '. Tap one for the profile.';

    syncTracks();
  }

  function renderPlaylists() {
    el.playlistGrid.innerHTML = D.playlists.map(function (p) {
      return '<article class="md" style="--tint:' + p.tint + '">' +
        '<button type="button" class="md__open" data-action="open-playlist" data-id="' + p.id + '" aria-label="Open playlist ' + esc(p.title) + ', ' + plural(p.tracks.length, 'track') + '">' +
        '<span class="md__label"><span class="md__title">' + esc(p.title) + '</span><span class="md__meta">' + plural(p.tracks.length, 'track') + ' · ' + mins(p.tracks) + '</span></span>' +
        '<span class="md__window" aria-hidden="true"><span class="md__disc"></span><span class="md__shutter"></span></span></button>' +
        '<button type="button" class="bubble bubble--pink md__play" data-action="play-list" data-ctx="playlist:' + p.id + '" aria-label="Play playlist ' + esc(p.title) + '">' + ICON.play + '</button>' +
        '</article>';
    }).join('');
  }

  /* Mark the current track everywhere it appears (library and sheet) */
  function syncTracks() {
    const playing = Engine.isPlaying();
    $$('.track').forEach(function (li) {
      const t = TRACK[li.dataset.track], cur = t.id === state.currentId, on = cur && playing;
      li.classList.toggle('is-current', cur);
      if (cur) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
      $('.track__main', li).setAttribute('aria-label', (on ? 'Pause ' : 'Play ') + t.title + ' by ' + ARTIST[t.artist].name);
      $('.track__state', li).innerHTML = on ? ICON.eq : ICON.play;
    });
  }

  function syncPlayButtons() {
    const playing = Engine.isPlaying();
    const t = TRACK[state.currentId];
    document.body.classList.toggle('is-playing', playing);
    $$('.js-play-icon').forEach(function (s) { s.innerHTML = playing ? ICON.pause : ICON.play; });
    el.pPlay.setAttribute('aria-label', (playing ? 'Pause' : 'Play') + (t ? ' ' + t.title : ''));
    syncStacks();
    document.title = (playing && t ? '▶ ' + t.title + ' · ' : '') + 'PULSE · music streaming demo';
  }

  function updateNowPlaying() {
    const t = TRACK[state.currentId];
    if (!t) return;
    const a = ARTIST[t.artist], al = ALBUM[t.album], dur = t.duration;
    el.pTitle.textContent = t.title;
    el.pArtist.textContent = a.name;
    el.pArtist.dataset.id = a.id;
    el.pArtist.setAttribute('aria-label', 'Artist: ' + a.name + '. Open profile');
    el.pArt.innerHTML = coverArt(al, 'Cover of ' + al.title + ': ' + al.artDesc);
    el.pLike.innerHTML = likeBtn(t);
    el.seek.max = String(n1(dur));
    el.pDur.textContent = fmt(Math.round(dur));
    lastSec = -1;
    paint();
  }

  /* ---------- Playback ---------- */
  function queueFor(ctx) {
    const parts = String(ctx || 'library').split(':'), kind = parts[0], id = parts[1];
    const ids = function (list) { return list.map(function (t) { return t.id; }); };
    if (kind === 'playlist' && PLAYLIST[id]) return PLAYLIST[id].tracks.slice();
    if (kind === 'album') return ids(D.tracks.filter(function (t) { return t.album === id; }));
    if (kind === 'artist') return ids(D.tracks.filter(function (t) { return t.artist === id; }));
    return ids(visibleTracks());
  }

  function startPlayback() {
    if (Engine.play() === false) toast('This browser does not support Web Audio, so playback is unavailable.');
  }

  /* follow = false keeps the record aisle where the listener is browsing */
  function loadTrack(id, autoplay, follow) {
    state.currentId = id;
    Engine.load(TRACK[id]);
    updateNowPlaying();
    if (follow !== false) goTo(ORDER.indexOf(id));
    if (autoplay) startPlayback();
    syncPlayButtons();
    syncTracks();
  }

  function togglePlay() {
    if (Engine.isPlaying()) Engine.pause(); else startPlayback();
  }

  function playTrack(id, ctx) {
    const q = queueFor(ctx);
    state.queue = q.indexOf(id) !== -1 ? q : [id];
    if (id === state.currentId) togglePlay(); else loadTrack(id, true);
  }

  function playList(ctx) {
    const q = queueFor(ctx);
    if (!q.length) return;
    state.queue = q;
    loadTrack(q[0], true);
  }

  function step(dir, auto) {
    const q = state.queue.length ? state.queue : D.featured;
    const wasFront = ORDER[stacks.idx] === state.currentId;
    let i = q.indexOf(state.currentId);
    if (dir < 0 && Engine.position() > 3) { Engine.seek(0); if (!Engine.isPlaying()) startPlayback(); paint(); return; }
    i = i === -1 ? 0 : (i + dir + q.length) % q.length;
    loadTrack(q[i], true, auto ? wasFront : true);
  }

  /* ---------- Record aisle (3D stacks) ---------- */
  const ORDER = D.featured;
  const STEP = 520; // px between records; must match --gap in css/style.css
  const stacks = { idx: 0, recs: [], walls: [] };
  const recPos = function (i) { return i % 2 ? { x: 0.6, y: -0.1 } : { x: -0.6, y: 0.06 }; };

  function buildStacks() {
    const n = ORDER.length;
    let html = '';
    ORDER.forEach(function (id, i) {
      const t = TRACK[id], al = ALBUM[t.album], pos = recPos(i);
      html += '<div class="rec" data-i="' + i + '" style="--i:' + i + ';--x:' + pos.x + ';--y:' + pos.y + '">' +
        '<div class="rec__vinyl"><div class="rec__spin"><div class="rec__label">' + coverArt(al) + '</div></div></div>' +
        '<div class="rec__sleeve">' + coverArt(al) + '<span class="rec__sticker">' + esc(t.title) + '</span></div></div>';
    });
    // Face-out sleeves on the shelves, halfway between stops
    ORDER.forEach(function (id, i) {
      const al = ALBUM[TRACK[ORDER[(i + 5) % n]].album];
      html += '<div class="rec rec--wall rec--wall-' + (i % 2 ? 'l' : 'r') + '" data-i="' + i + '" style="--i:' + (i + 0.5) + ';--y:' + (i % 2 ? -0.35 : 0.2) + '">' + coverArt(al) + '</div>';
    });
    el.world.innerHTML = html;
    stacks.recs = $$('.rec', el.world);
    el.hudTicks.innerHTML = ORDER.map(function () { return '<i></i>'; }).join('');
    stacks.walls = [
      [$('.wall--l .plane__tex', el.stacks), 'X', -1], [$('.wall--r .plane__tex', el.stacks), 'X', 1],
      [$('.floor .plane__tex', el.stacks), 'Y', 1], [$('.ceil .plane__tex', el.stacks), 'Y', -1]
    ];
  }

  /* Slide the aisle textures by one record gap per step; they repeat, so they can snap back unseen. */
  function runWalls(steps, duration, easing) {
    if (reduceMotion.matches || !steps) return null;
    const n = Math.min(3, Math.abs(steps)), dir = steps > 0 ? 1 : -1;
    let last = null;
    stacks.walls.forEach(function (w) {
      if (!w[0] || !w[0].animate) return;
      last = w[0].animate(
        [{ transform: 'translate' + w[1] + '(0px)' }, { transform: 'translate' + w[1] + '(' + (w[2] * dir * STEP) + 'px)' }],
        { duration: (duration || 850) / n, iterations: n, easing: easing || (n === 1 ? 'cubic-bezier(.3, .1, .2, 1)' : 'linear') }
      );
    });
    return last;
  }

  function syncStacks() {
    const front = TRACK[ORDER[stacks.idx]];
    if (!front) return;
    const playing = Engine.isPlaying();
    const on = front.id === state.currentId && playing;
    $('#heroPlayIcon').innerHTML = on ? ICON.pause : ICON.play;
    $('#heroPlayText').textContent = on ? 'Pause' : 'Play';
    el.heroPlay.setAttribute('aria-label', (on ? 'Pause ' : 'Play ') + front.title + ' by ' + ARTIST[front.artist].name);
    stacks.recs.forEach(function (r) {
      r.classList.toggle('is-spinning', playing && ORDER[Number(r.dataset.i)] === state.currentId && !r.classList.contains('rec--wall'));
    });
  }

  function goTo(i) {
    const n = ORDER.length;
    if (i < 0 || isNaN(i)) i = 0;
    i = ((i % n) + n) % n;
    const moved = i - stacks.idx;
    stacks.idx = i;
    const pos = recPos(i), t = TRACK[ORDER[i]];
    el.world.style.setProperty('--ci', String(i));
    el.world.style.setProperty('--cx', String(pos.x));
    el.world.style.setProperty('--cy', String(pos.y));
    stacks.recs.forEach(function (r) {
      const d = Number(r.dataset.i) - i;
      r.dataset.d = d < 0 ? 'past' : d > 3 ? 'far' : String(d);
      r.classList.toggle('is-front', d === 0);
    });
    $$('i', el.hudTicks).forEach(function (tick, k) { tick.classList.toggle('is-on', k === i); });
    el.hudTitle.textContent = t.title;
    el.hudMeta.textContent = ARTIST[t.artist].name + ' · ' + GENRE[t.genre].name + ' · ' + t.bpm + ' BPM';
    el.hudLike.innerHTML = likeBtn(t);
    runWalls(moved);
    syncStacks();
  }

  function playBrowse() {
    const id = ORDER[stacks.idx];
    if (id === state.currentId) { togglePlay(); return; }
    state.queue = ORDER.slice();
    loadTrack(id, true);
  }

  /* Fly in from the far end of the aisle (runs once, when the loading screen is dismissed) */
  function arrive() {
    if (!el.stacks.classList.contains('is-arriving')) return;
    void el.stacks.offsetWidth;
    el.stacks.classList.add('is-landing');
    el.stacks.classList.remove('is-arriving');
    const a = runWalls(3, 780, 'linear');
    if (a && a.finished) a.finished.then(function () { runWalls(1, 700, 'cubic-bezier(.16, .8, .2, 1)'); }).catch(function () {});
    setTimeout(function () { el.stacks.classList.remove('is-landing'); }, 1600);
  }

  /* Swipe sideways (or horizontal wheel) to move along the aisle; vertical scrolling stays free */
  (function () {
    let sx = 0, sy = 0, down = false, swiped = false, wheelAt = 0;
    el.stacks.addEventListener('pointerdown', function (e) { down = true; swiped = false; sx = e.clientX; sy = e.clientY; });
    el.stacks.addEventListener('pointerup', function (e) {
      if (!down) return;
      down = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) { swiped = true; goTo(stacks.idx + (dx < 0 ? 1 : -1)); }
    });
    el.stacks.addEventListener('pointercancel', function () { down = false; });
    el.stacks.addEventListener('click', function (e) {
      if (swiped) { swiped = false; e.stopPropagation(); e.preventDefault(); return; }
      const r = e.target.closest ? e.target.closest('.rec') : null;
      if (!r || r.classList.contains('rec--wall')) return;
      if (r.dataset.d === '0') playBrowse(); else goTo(Number(r.dataset.i));
    }, true);
    el.stacks.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) < 24 || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5) return;
      e.preventDefault();
      const now = Date.now();
      if (now - wheelAt < 520) return;
      wheelAt = now;
      goTo(stacks.idx + (e.deltaX > 0 ? 1 : -1));
    }, { passive: false });
    el.stacks.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(stacks.idx + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(stacks.idx - 1); }
    });
  })();

  /* ---------- Loading screen ---------- */
  function initIntro() {
    const intro = el.intro;
    const locked = [$('#skipLink'), $('#top'), $('#main'), $('#foot'), el.player];
    const labels = ['HYPERPOP', 'SYNTHWAVE', 'LO-FI', 'DRUM & BASS', 'AMBIENT', 'HOUSE', 'PLAYLISTS', 'ALBUMS', 'ARTISTS', 'LIKES'];
    let leaving = false;

    $('#introWedges').innerHTML = D.albums.map(function (al, i) {
      const a1 = (i * 60 - 90) * Math.PI / 180, a2 = ((i + 1) * 60 - 90) * Math.PI / 180;
      const pt = function (a) { return 'calc(50% + ' + n1(Math.cos(a) * 160) + 'vmax) calc(50% + ' + n1(Math.sin(a) * 160) + 'vmax)'; };
      const mid = (a1 + a2) / 2;
      return '<div class="wedge" style="--n:' + i + ';clip-path:polygon(50% 50%, ' + pt(a1) + ', ' + pt(a2) + ')">' +
        '<div class="wedge__art" style="left:calc(50% + ' + n1(Math.cos(mid) * 40) + 'vmax);top:calc(50% + ' + n1(Math.sin(mid) * 40) + 'vmax)">' + coverArt(al) + '</div></div>';
    }).join('');
    $('#introLabels').innerHTML = labels.map(function (name, i) {
      const off = (50 + ((18 + i * 36) / 360) * 100) % 100;
      return '<text style="--n:' + i + '"><textPath href="#introOuter" startOffset="' + n1(off) + '%" text-anchor="middle">' + esc(name) + '</textPath></text>';
    }).join('');

    document.documentElement.classList.add('intro-open');
    locked.forEach(function (n) { n.inert = true; });
    const enter = $('#introEnter'), hint = $('#introHint');
    setTimeout(function () {
      intro.classList.add('is-ready');
      if (!leaving) hint.textContent = 'Tap the record to tune in';
    }, reduceMotion.matches ? 0 : 2600);
    try { enter.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }

    function leave() {
      if (leaving) return;
      leaving = true;
      intro.classList.add('is-ready', 'is-leaving');
      const quick = reduceMotion.matches;
      setTimeout(arrive, quick ? 0 : 480);
      setTimeout(function () {
        intro.hidden = true;
        document.documentElement.classList.remove('intro-open');
        locked.forEach(function (n) { n.inert = false; });
        try { el.heroPlay.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
      }, quick ? 0 : 1200);
    }
    enter.addEventListener('click', leave);
    $('#introSkip').addEventListener('click', leave);
    intro.addEventListener('keydown', function (e) { if (e.key === 'Escape') leave(); });
  }

  Engine.onState(function () { syncPlayButtons(); syncTracks(); if (Engine.isPlaying()) startLoop(); else paint(); });
  Engine.onEnded(function () { step(1, true); });

  /* ---------- Progress + visualizer loop ---------- */
  let raf = 0, lastSec = -1, scrubbing = false, bins = null;
  const vctx = el.viz.getContext ? el.viz.getContext('2d') : null;

  function setFill(input, ratio) { input.style.setProperty('--fill', (Math.max(0, Math.min(1, ratio)) * 100).toFixed(2) + '%'); }

  function showTime(pos) {
    const s = Math.floor(pos);
    if (s === lastSec) return;
    lastSec = s;
    const dur = fmt(Math.round(Engine.duration()));
    el.pCur.textContent = fmt(s);
    el.seek.setAttribute('aria-valuetext', fmt(s) + ' of ' + dur);
  }

  function sizeViz() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = el.viz.clientWidth, h = el.viz.clientHeight;
    if (!w || !h) return;
    el.viz.width = Math.round(w * dpr);
    el.viz.height = Math.round(h * dpr);
  }

  /* LCD-style segmented spectrum. With reduced motion it shows a still level pattern instead. */
  function drawViz() {
    if (!vctx) return;
    const W = el.viz.width, H = el.viz.height, N = W > 900 ? 64 : 40, ROWS = 3;
    const playing = Engine.isPlaying(), an = Engine.analyser();
    const live = playing && an && !reduceMotion.matches;
    if (live) {
      if (!bins) bins = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(bins);
    }
    const gap = Math.max(1, Math.round(W * 0.012));
    const bw = (W - gap * (N - 1)) / N, bh = (H - gap * (ROWS - 1)) / ROWS;
    vctx.clearRect(0, 0, W, H);
    for (let i = 0; i < N; i++) {
      let level = 1;
      if (live) {
        const a = Math.floor(Math.pow(i / N, 1.6) * 88) + 1, b = Math.floor(Math.pow((i + 1) / N, 1.6) * 88) + 2;
        let m = 0;
        for (let k = a; k < b; k++) if (bins[k] > m) m = bins[k];
        level = Math.max(1, Math.min(ROWS, Math.round((m / 255) * ROWS * (1 + (i / N) * 0.7))));
      } else if (playing) {
        level = 1 + ((i * 7) % 3);
      }
      for (let r = 0; r < ROWS; r++) {
        vctx.fillStyle = r < level ? (r >= ROWS - 1 ? '#FF3D9A' : '#2CE6D6') : 'rgba(44, 230, 214, .16)';
        vctx.fillRect(i * (bw + gap), H - (r + 1) * bh - r * gap, bw, bh);
      }
    }
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
    const dur = Engine.duration();
    const jump = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 15, PageDown: -15 }[e.key];
    let to = null;
    if (jump) to = Engine.position() + jump;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = dur - 1;
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
    const muted = v === 0;
    el.mute.innerHTML = muted ? ICON.muted : ICON.volume;
    el.mute.setAttribute('aria-pressed', String(muted));
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
    const count = $('#likedCount');
    count.textContent = String(state.liked.size);
    count.classList.remove('bump'); void count.offsetWidth; count.classList.add('bump');
    toast(liked ? 'Liked “' + t.title + '” · ' + plural(state.liked.size, 'track') + ' saved' : 'Removed “' + t.title + '” from Liked');
    if (state.likedOnly) {
      const inLibrary = btn && el.trackList.contains(btn);
      renderLibrary();
      if (inLibrary) $('.chip--liked', el.chips).focus();
    }
  }

  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('is-on'); }, 2400);
  }

  /* ---------- Filters + search ---------- */
  function scrollToLibrary() {
    const lib = $('#library'), top = lib.getBoundingClientRect().top;
    if (top < 60 && top > -lib.offsetHeight + 200) return; // already in view
    lib.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  }
  function clearFilters() {
    state.genre = 'all'; state.query = ''; state.likedOnly = false;
    el.search.value = '';
    syncChips();
    renderLibrary();
    $('.chip[data-id="all"]', el.chips).focus();
  }
  el.search.addEventListener('input', function () {
    const was = state.query;
    state.query = el.search.value.trim();
    renderLibrary();
    if (!was && state.query) scrollToLibrary();
  });
  $('#searchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    scrollToLibrary();
    const first = $('.track__main', el.trackList);
    if (first) first.focus({ preventScroll: true });
  });

  /* ---------- Detail sheet (playlist / album / artist) ---------- */
  let sheetOpener = null;
  const behind = [$('#top'), $('#main'), $('#foot')];

  function sheetShell(o) {
    return '<div class="sheet__bar"><span class="sheet__kind">' + o.kind + '</span>' +
      '<button type="button" class="ctl ctl--sm sheet__close" data-action="close-sheet" aria-label="Close">' + ICON.close + '</button></div>' +
      '<header class="sheet__head">' + o.art +
      '<div><h2 id="sheetTitle">' + esc(o.title) + '</h2><p class="sheet__sub">' + o.sub + '</p>' +
      '<button type="button" class="bubble bubble--pink sheet__play" data-action="play-list" data-ctx="' + o.ctx + '">' + ICON.play + '<span>Play all</span></button></div></header>' +
      o.body;
  }
  function trackListHTML(ids, ctx) {
    return '<ul class="tracks" aria-label="Tracks">' + ids.map(function (id) { return trackRow(TRACK[id], ctx); }).join('') + '</ul>';
  }

  function openSheet(html, opener) {
    const wasOpen = el.sheet.hasAttribute('open');
    if (!wasOpen) sheetOpener = opener || document.activeElement;
    el.sheet.innerHTML = html;
    behind.forEach(function (n) { n.inert = true; n.setAttribute('aria-hidden', 'true'); });
    el.backdrop.hidden = false;
    if (!wasOpen) { if (typeof el.sheet.show === 'function') el.sheet.show(); else el.sheet.setAttribute('open', ''); }
    el.sheet.scrollTop = 0;
    syncTracks();
    const close = $('.sheet__close', el.sheet);
    if (close) close.focus();
  }
  function closeSheet() {
    if (!el.sheet.hasAttribute('open')) return;
    if (typeof el.sheet.close === 'function') el.sheet.close(); else el.sheet.removeAttribute('open');
    el.backdrop.hidden = true;
    behind.forEach(function (n) { n.inert = false; n.removeAttribute('aria-hidden'); });
    if (sheetOpener && sheetOpener.isConnected) sheetOpener.focus();
    sheetOpener = null;
  }

  function openPlaylist(id, opener) {
    const p = PLAYLIST[id];
    openSheet(sheetShell({
      kind: 'Playlist', title: p.title, ctx: 'playlist:' + id,
      art: '<div class="sheet__art is-md" style="background:' + p.tint + '" role="img" aria-label="MiniDisc for playlist ' + esc(p.title) + '"><span></span></div>',
      sub: esc(p.blurb) + ' ' + plural(p.tracks.length, 'track') + ' · ' + mins(p.tracks) + '.',
      body: trackListHTML(p.tracks, 'playlist:' + id)
    }), opener);
  }
  function openAlbum(id, opener) {
    const al = ALBUM[id], ar = ARTIST[al.artist], ids = queueFor('album:' + id);
    openSheet(sheetShell({
      kind: 'Album', title: al.title, ctx: 'album:' + id,
      art: '<div class="sheet__art">' + coverArt(al, 'Cover of ' + al.title + ': ' + al.artDesc) + '</div>',
      sub: '<button type="button" data-action="open-artist" data-id="' + ar.id + '">' + esc(ar.name) + '</button> · ' + al.year + ' · ' + plural(ids.length, 'track') + ' · ' + mins(ids),
      body: trackListHTML(ids, 'album:' + id)
    }), opener);
  }
  function openArtist(id, opener) {
    const ar = ARTIST[id];
    if (!ar) return;
    const ids = queueFor('artist:' + id);
    const albums = D.albums.filter(function (al) { return al.artist === id; });
    openSheet(sheetShell({
      kind: 'Artist profile', title: ar.name, ctx: 'artist:' + id,
      art: '<div class="sheet__art is-round">' + avatar(ar, 'Illustrated chrome avatar of ' + ar.name) + '</div>',
      sub: esc(GENRE[ar.genre].name) + ' · ' + plural(ids.length, 'track'),
      body: '<p class="sheet__bio">' + esc(ar.bio) + '</p>' +
        '<dl class="facts"><dt>Home base</dt><dd>' + esc(ar.base) + '</dd><dt>Monthly listeners</dt><dd>' + esc(ar.listeners) + ' (fictional)</dd>' +
        '<dt>Signature sound</dt><dd>' + esc(Array.from(new Set(ids.map(function (i) { return TRACK[i].leadName; }))).join(', ')) + '</dd></dl>' +
        '<h3>Tracks</h3>' + trackListHTML(ids, 'artist:' + id) +
        '<h3>Albums</h3><div class="sheet__albums">' + albums.map(function (al) {
          return '<button type="button" class="chip" data-action="open-album" data-id="' + al.id + '">' + esc(al.title) + ' · ' + al.year + '</button>';
        }).join('') + '</div>'
    }), opener);
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', function (e) {
    const t = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!t) return;
    const id = t.dataset.id;
    switch (t.dataset.action) {
      case 'toggle': togglePlay(); break;
      case 'next': step(1); break;
      case 'prev': step(-1); break;
      case 'play-track': playTrack(id, t.dataset.ctx); break;
      case 'play-browse': playBrowse(); break;
      case 'browse-next': goTo(stacks.idx + 1); break;
      case 'browse-prev': goTo(stacks.idx - 1); break;
      case 'play-list': playList(t.dataset.ctx); break;
      case 'like': toggleLike(id, t); break;
      case 'mute': toggleMute(); break;
      case 'genre': state.genre = id; syncChips(); renderLibrary(); break;
      case 'liked-only': state.likedOnly = !state.likedOnly; syncChips(); renderLibrary(); break;
      case 'clear': clearFilters(); break;
      case 'open-playlist': openPlaylist(id, t); break;
      case 'open-album': openAlbum(id, t); break;
      case 'open-artist': openArtist(id, t); break;
      case 'close-sheet': closeSheet(); break;
    }
  });
  el.backdrop.addEventListener('click', closeSheet);

  document.addEventListener('keydown', function (e) {
    const tag = e.target && e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.key === 'Escape' && el.sheet.hasAttribute('open')) { e.preventDefault(); closeSheet(); return; }
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !el.sheet.hasAttribute('open')) { e.preventDefault(); el.search.focus(); return; }
    if ((e.key === ' ' || e.code === 'Space') && (e.target === document.body || e.target === document.documentElement)) { e.preventDefault(); togglePlay(); }
  });

  /* Keep layout variables and canvas in sync with the real sizes */
  function measure() {
    document.documentElement.style.setProperty('--bar-h', el.player.offsetHeight + 'px');
    sizeViz();
    drawViz();
  }
  window.addEventListener('resize', measure);
  if (window.ResizeObserver) new ResizeObserver(measure).observe(el.player);

  /* ---------- Boot ---------- */
  buildStacks();
  renderChips();
  renderPlaylists();
  renderLibrary();
  state.lastVolume = state.volume || 80;
  applyVolume(state.volume, false);
  loadTrack(ORDER[0], false);
  measure();
  if (el.intro) initIntro(); else arrive();
})();
