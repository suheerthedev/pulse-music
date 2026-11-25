# PULSE

A fictional Y2K-style music streaming platform. Dig through a 3D record library, then find a track and play it.

**Competition brief:** #3, Music Streaming Interface
**Team:** `TEAM NAME` · `Member 1`, `Member 2`, `Member 3`
**Live site:** https://pulse-music-iota.vercel.app

> All artists, albums, tracks, places and listener counts in PULSE are fictional sample data.
> No real music, no backend, no login, no payments, no tracking.

## What it is

PULSE has three parts on one scrolling page:

1. **The vinyl.** The site opens on one big record. A dot orbits it while the ring fills, genre names
   appear around the edge and album covers fan in behind. Tap it, or scroll: the camera tilts and zooms
   into the grooves with a magnification readout (×1 to ×355) until the grooves become a road to the horizon.
2. **The record library.** That road opens into a full-screen 3D aisle of shelves: rows of spines, LED-lit
   ledges, records pulled halfway out, genre signs. Two featured records hang from the rail. Then the camera
   swings round to a side view of the whole collection: a diagonal row that repeats endlessly and drifts past
   on its own (it holds still while you choose). Hover, focus or tap
   one and the sleeve lifts with the vinyl sliding out; click to play. Each scroll, swipe or arrow key moves
   exactly one stop, and scrolling up plays everything in reverse, back to the vinyl. **Enter the app** stays
   visible the whole way.
3. **The app.** A record-shop take on a music platform: a turntable whose tonearm drops while music plays,
   your crate as record spines you pull out, sleeves instead of tiles, hash-routed pages for playlists,
   albums, artists and Liked Songs, a queue, and a player bar that appears once you are in the app.

There are no audio files. Every one of the 14 tracks is composed and synthesized in the browser with the
Web Audio API from a small recipe (tempo, key, scale, chord progression, lead instrument), so play, pause,
seek and volume control real sound. The 3D aisle is CSS transforms only: no WebGL, no libraries, no images.

## How the brief is covered

| Brief item | Where |
| --- | --- |
| Landing view, one primary action | The vinyl: tap it to enter. In the aisle the one pink button is **Play**; **Enter the app** is always available |
| 3+ playlists | 4 playlists (MiniDisc cartridges) plus Liked Songs, each with its own page |
| Categories with working filtering | Genre tiles and genre chips filter tracks, artists and albums on the Search page |
| Album cards | 6 albums as sleeves with a record that slides out; each has an album page |
| Artist profiles | 6 artist pages: bio, facts, popular tracks, discography, "fans also like" |
| Search | Top-bar search across title, artist, album, genre, key and bpm (press `/` to focus) |
| Like button with feedback | Heart fills and bursts, counters bump, a toast confirms, saved in `localStorage`, Liked Songs page |
| Persistent player bar | Play/pause, next/previous, seek, volume and mute, docked on every page of the app |

## Air Jam (added after the contest)

An optional page in the app (`#/jam`, "Air Jam" in the navigation): air guitar with your webcam.

- **Two guitars.** An acoustic and an electric, each a 3D model built in code with three.js (no model files),
  each with its own sound. The choice is remembered.
- **You hold it.** With the camera on, the guitar sits in your hands: the body at your strumming hand, the neck
  pointing at your other hand, sized from the size of your hands. Move or tilt and it comes with you. With the
  camera off it rests in the middle of the page.
- **Chord hand.** The neck is split into five zones (Em, G, C, D, Am). Slide your hand along the neck; the zone
  your palm is over sets the chord, and dots on the frets show how that chord is really fingered.
- **Strum hand.** Any fast stroke across the strings plays a six-string strum, one per stroke; the strings
  light up and shake. The guitar ignores the strokes themselves, so strumming does not shake it. Faster strokes are louder and brighter, and the strings are staggered
  slightly, low-to-high on a downstroke and high-to-low on an upstroke.
- **Mute.** Squeezing the chord hand into a tight fist stops the strings; strumming with it closed gives a muted
  "chk". A hand loosely curled round an imaginary neck does not mute.
- **Sound.** Each string is a Karplus-Strong plucked-string model, synthesized in the browser. The acoustic adds
  the resonance of a hollow body; the electric is voiced like a pickup and has clean and distortion settings.
- **Full window.** While the camera is on, the picture fills the window (with an optional true full-screen
  button); Stop camera or Esc brings the page back.
- **No camera needed.** Chord buttons, a Strum button, keys `1` to `5`, `Space` (strum) and `M` (mute) do
  everything the camera does. If three.js cannot load, a flat drawing of zones and strings is used instead. If the camera is blocked, missing, busy, or the tracker cannot load, the page says so
  and the buttons and keys keep working.
- **Left-handed** mode mirrors the layout.

Privacy: hand tracking is [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
(Tasks Vision), downloaded from a CDN when you press **Start camera** and run in the browser. Video is never
recorded, stored or uploaded. The library is pinned to `@mediapipe/tasks-vision@0.10.35` on purpose: versions
from 1.0.0 on also send anonymous usage statistics to a Google logging endpoint with no option to turn that off.

Browsers only allow the camera on `https` or `localhost`, so use the deployed site or a local server (`npx serve .`) for the camera. The buttons and keys work anywhere.

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```
npx serve .
```

Pages are hash routes (`#/home`, `#/search`, `#/album/zero-latency`, ...), so deep links and the browser's
back button work on any static host.

## Deploy on Vercel

1. Push this folder to GitHub.
2. In Vercel choose **Add New → Project**, import the repo.
3. Framework preset: **Other**. Leave build command and output directory empty.
4. Deploy.

## Files

```
index.html      page structure: scroll journey, app shell, player bar
css/style.css   all styles (mobile-first)
js/data.js      fictional catalog: genres, artists, albums, tracks, playlists
js/audio.js     Web Audio synth engine and song generator
js/app.js       views and router, player, likes, scroll journey and 3D aisle
js/airjam.js    Air Jam: hand tracking, gestures, Karplus-Strong guitar, fallback controls
js/guitar3d.js  Air Jam: the two 3D guitars (three.js, built from code)
```

## Design decisions

- **Palette:** night `#0C0B24` and indigo `#17153B` for surfaces, ice `#DDE8F5` and chrome `#A9B7C9` for text
  and hardware, hot pink `#FF3D9A` for the primary action and liked state, aqua `#2CE6D6` for focus,
  progress and LEDs. Frosted panels, glossy bubble buttons and chrome rings keep the Y2K hardware feel.
- **Type:** Michroma for display (wide, like lettering printed on hardware), Hanken Grotesk for body.
- **Different objects for different content:** tracks are table rows, playlists are MiniDisc cartridges,
  albums are sleeves with a record peeking out, artists are round chrome-ringed portraits.
- **One gesture, one record.** Inside the journey a wheel notch, swipe or arrow key always moves exactly
  one stop, so nobody gets lost between records. The page still really scrolls, which is why scrolling up
  reverses everything.
- **Motion:** one orchestrated sequence (ring loader, dive, fly-through). In the app, motion only responds
  to actions: records spin while music plays, cards lift, the like bursts.

## Accessibility

- Landmarks, skip link, one `h1`, labelled regions, a real `main` that receives focus on page changes.
- Every control has a visible label or an `aria-label`; toggles use `aria-pressed`; the current page and
  current track use `aria-current`.
- Visible 3px aqua focus ring on every interactive element.
- The journey never traps anyone: **Skip to the app** is on the first screen, **Enter the app** stays in the
  aisle, and Arrow/Page keys, Home and End all move through it. The 3D scene is decorative; previous/next
  record buttons and a Play button that names the record do the same job.
- Whatever is not on screen is `inert` (the aisle while the vinyl shows, the vinyl once you are in the aisle).
- Seek slider: arrows jump 5 s, Page Up/Down 15 s, Home/End. Shortcuts: `/` search, `Space` play/pause.
- Result counts, the featured record and like confirmations are announced through live regions.
- `prefers-reduced-motion`: no dive or fly-through (stops cut instead of animating), records do not spin,
  the spectrum shows a still pattern.
- Generated artwork has text alternatives where it carries meaning and is hidden where it is decorative.
- Contrast (WCAG ratio): primary text on night 17:1, secondary text 9.4:1, pink text on panels 5.2:1 or more,
  indigo on pink buttons 4.6 to 5.3:1.

## AI tools used

- **Claude (Anthropic):** design plan, HTML/CSS/JS, the generative music engine, automated browser checks, this README.
- `Add any other tools the team used here.`

## What was checked or changed

Automated checks run in headless Chrome during the build:

- No console or page errors; no horizontal overflow at 320, 360, 390, 768, 1024, 1280, 1440 and 1920 px,
  on every page.
- Journey: tap, Enter, wheel (one notch = one stop, both directions), arrow keys, touch swipes, the
  previous/next buttons, skip links, settling when left between stops, and returning from the app to the
  aisle and back to the vinyl.
- Playback: play, pause, next, previous, seek (drag and keyboard), volume, mute, auto-advance, queue.
- Pages: Home, Search (query, genre chips, liked filter, empty states, clear), Library, Liked Songs,
  playlist, album and artist pages, deep links, back/forward.
- Likes: state, counters, toast, `localStorage`, and the Liked Songs page updating.
- Output level of all 14 generated tracks measured in four sections each: no clipping (peaks below 0.9).
- Reduced-motion mode.

Air Jam checks (headless Chrome):

- Buttons and keys: chords, strum, mute, clean/distortion, left-handed; Space strums on this page only and
  goes back to play/pause elsewhere.
- Sound: all 15 string notes are in tune to within 0.1 cent; output level checked for clean and distortion.
- Gesture logic with scripted hand positions: five chord columns, fast down and up strokes anywhere in the
  picture, slow drift ignored, a hand that drops out mid-stroke, tight fist mutes but a loose grip does not,
  one hand only, left-handed mode.
- Speed, and staying fast. Measured on a laptop with integrated graphics and a high-density screen, where the
  first versions fell to 2 frames a second after about half a minute: the hand tracker and the page share the
  graphics card, and driven flat out it falls further and further behind. What fixed it there: while the camera
  is on, the camera picture and the guitar are drawn into one canvas of at most 1280 pixels across, stretched
  over the window, and nothing else on the page is drawn at all; the tracker looks at most 20 times a second,
  less often when a look takes long, and 10 times a second while no hands are in view. Tracking stays on the
  main thread on the graphics card (15 to 20 ms a look on that laptop, against about 50 ms on the processor and
  50 to 150 ms from a worker thread). Finished notes are removed from the audio graph. A **Speed report** button
  (shown while the camera is on) copies a timing log for diagnosing a slow machine.
- The real tracker, fed test clips of hands through a fake camera: model loads, skeleton lines up with the
  mirrored picture, chord follows the still hand, strums follow the moving hand, camera released on Stop.
- Camera blocked, no camera, and tracker download failure each show their message and leave the fallback working.
- No network requests besides the tracker's own files.
- Both 3D guitars rendered and inspected; the guitar follows scripted and real tracked hands (body at the
  strum hand, neck through the chord hand); chord zones along the neck match what the hand logic uses;
  full-window mode on desktop and phone sizes (video cropped to fill, skeleton still lined up, page restored
  on Stop and Esc); the flat fallback when three.js is unavailable.
- Not covered by automation: a real person in front of a real webcam (lighting, speed, how the fist reads).

Changes made along the way:

- Air Jam first needed the strum hand to cross a fixed line and muted on any curled hand. On a real webcam
  that was hard to hit and a natural guitar grip muted everything, so strums now fire on any fast stroke and
  only a tight fist mutes. Canvas shadows and frosted panels were dropped while the camera runs, for speed.
- The first version had a disc-player hero on a light page. It was rebuilt as the vinyl loading screen,
  the 3D record library and a dark app shell.
- Scroll snapping was first done with CSS and trapped mouse-wheel users between stops in testing; it was
  replaced with the one-gesture-one-stop controller.
- Near-field shelf items that covered the headline now fade out before they reach the camera.
- Pink text and white-on-pink text were replaced with accessible alternatives.

Manual checks by the team (fill in before submitting):

- [ ] Listened to several tracks on laptop speakers and headphones
- [ ] Tested on a real phone (note: iPhones in silent mode mute Web Audio)
- [ ] Checked the 3D aisle runs smoothly on the demo machine
- [ ] Tabbed through the whole page with the keyboard
- [ ] Tested with a screen reader
- [ ] Checked the deployed Vercel URL

## Credits

- Fonts: [Michroma](https://fonts.google.com/specimen/Michroma) and
  [Hanken Grotesk](https://fonts.google.com/specimen/Hanken+Grotesk), Google Fonts, SIL Open Font License.
- Audio: Web Audio API, built into the browser. No samples or recordings.
- Artwork: generated SVG and CSS. No external images.
- Libraries: none for the site itself. Air Jam loads [three.js](https://threejs.org) 0.187 (MIT) for the
  3D guitars, and
  [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) 0.10.35 and Google's
  hand landmarker model (Apache 2.0), both from a CDN: three.js when the Air Jam page opens, the tracker only
  when the camera is started. The guitar models themselves are our own, generated in `js/guitar3d.js`.
- Interaction reference: the ring loader and "fly into an aisle" browsing were inspired by Luka Skhiladze's
  portfolio site. Nothing was copied; the vinyl, the record library, the code and the artwork are our own.
- The groove zoom was inspired by the Mind of Akira site, and the side view of the collection by Jacob How's
  portfolio. Again, only the ideas: all code and artwork here are our own.
- Layout reference: the app shell follows the familiar music-app pattern (sidebar, pages, now-playing panel,
  docked player) popularised by services like Spotify.
