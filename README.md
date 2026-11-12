# PULSE

A fictional Y2K-style music streaming platform. Dig through a 3D record library, then find a track and play it.

**Competition brief:** #3, Music Streaming Interface
**Team:** `TEAM NAME` · `Member 1`, `Member 2`, `Member 3`
**Live site:** `https://YOUR-PROJECT.vercel.app`

> All artists, albums, tracks, places and listener counts in PULSE are fictional sample data.
> No real music, no backend, no login, no payments, no tracking.

## What it is

PULSE has three parts on one scrolling page:

1. **The vinyl.** The site opens on one big record. A dot orbits it while the ring fills, genre names
   appear around the edge and album covers fan in behind. Tap it, or scroll.
2. **The record library.** The record dives into the vanishing point and you fly into a full-screen 3D
   aisle of shelves: rows of spines, LED-lit ledges, records pulled halfway out, genre signs. Four featured
   records hang from the rail. Each scroll, swipe or arrow key moves you one record down the aisle; Play
   spins the one in front of you. After the fourth record you scroll into the app. Scrolling up plays the
   whole thing in reverse, back to the vinyl.
3. **The app.** A music-platform shell: sidebar (Home, Search, Your Library), top bar with search and
   back/forward, routed pages for playlists, albums, artists and Liked Songs, a Now Playing panel with a
   live spectrum and the queue, and a player bar that stays docked.

There are no audio files. Every one of the 14 tracks is composed and synthesized in the browser with the
Web Audio API from a small recipe (tempo, key, scale, chord progression, lead instrument), so play, pause,
seek and volume control real sound. The 3D aisle is CSS transforms only: no WebGL, no libraries, no images.

## How the brief is covered

| Brief item | Where |
| --- | --- |
| Landing view, one primary action | The vinyl: tap it to enter. In the aisle the one pink button is **Play** |
| 3+ playlists | 4 playlists (MiniDisc cartridges) plus Liked Songs, each with its own page |
| Categories with working filtering | Genre tiles and genre chips filter tracks, artists and albums on the Search page |
| Album cards | 6 albums as sleeves with a record that slides out; each has an album page |
| Artist profiles | 6 artist pages: bio, facts, popular tracks, discography, "fans also like" |
| Search | Top-bar search across title, artist, album, genre, key and bpm (press `/` to focus) |
| Like button with feedback | Heart fills and bursts, counters bump, a toast confirms, saved in `localStorage`, Liked Songs page |
| Persistent player bar | Play/pause, next/previous, seek, volume and mute, docked on every page |

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

Changes made along the way:

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
- Libraries: none.
- Interaction reference: the ring loader and "fly into an aisle" browsing were inspired by Luka Skhiladze's
  portfolio site. Nothing was copied; the vinyl, the record library, the code and the artwork are our own.
- Layout reference: the app shell follows the familiar music-app pattern (sidebar, pages, now-playing panel,
  docked player) popularised by services like Spotify.
