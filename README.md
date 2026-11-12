# PULSE

A fictional Y2K-style music streaming interface. Find a track and play it.

**Competition brief:** #3, Music Streaming Interface
**Team:** `TEAM NAME` · `Member 1`, `Member 2`, `Member 3`
**Live site:** `https://YOUR-PROJECT.vercel.app`

> All artists, albums, tracks, places and listener counts in PULSE are fictional sample data.
> No real music, no backend, no login, no payments, no tracking.

## What it is

PULSE opens on a loading screen with one big vinyl record. A dot orbits it while the ring fills,
genre names appear around the edge and album covers fan in behind. Tap the record and you fly
into a 3D record-shop aisle: every song is a vinyl in its sleeve, and you move down the aisle one
record at a time with a swipe, the arrow keys or the buttons. Play spins the record in front of you.

Below the aisle is the full library (search, genre filter, playlists, albums, artists), and the
player stays docked at the bottom of the screen the whole time. The aisle is built with CSS 3D
transforms only: no WebGL, no libraries, no images.

There are no audio files. Every one of the 14 tracks is composed and synthesized in the
browser with the Web Audio API from a small recipe (tempo, key, scale, chord progression,
lead instrument), so play, pause, seek and volume control real sound.

## How the brief is covered

| Brief item | Where |
| --- | --- |
| Landing view, one primary action | Vinyl loading screen (one action: tap the record), then the record aisle with a single pink **Play** button |
| 3+ playlists | 4 MiniDisc cartridges; open one or press its play button |
| Categories with working filtering | Genre chips filter tracks, albums and artists together |
| Album cards | 6 jewel cases with generated SVG covers |
| Artist profiles | 6 profiles in a detail sheet (bio, facts, tracks, albums) |
| Search | Header search across title, artist, album, genre, key and bpm (press `/` to focus) |
| Like button with feedback | Heart fills and bursts, counter bumps, toast confirms, saved in `localStorage`, "Liked" filter |
| Persistent player bar | Play/pause, next/previous, seek, volume and mute, always docked |

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```
npx serve .
```

## Deploy on Vercel

1. Push this folder to GitHub.
2. In Vercel choose **Add New → Project**, import the repo.
3. Framework preset: **Other**. Leave build command and output directory empty.
4. Deploy.

## Files

```
index.html      page structure
css/style.css   all styles (mobile-first)
js/data.js      fictional catalog: genres, artists, albums, tracks, playlists
js/audio.js     Web Audio synth engine and song generator
js/app.js       interface logic: filters, search, likes, sheet, player bar
```

## Design decisions

- **Palette:** ice `#DDE8F5`, chrome `#A9B7C9`, indigo `#17153B`, hot pink `#FF3D9A`, aqua `#2CE6D6`.
  Pink is reserved for the primary action and the liked state. Aqua is only used on the LCD and progress.
  Two inks were added for contrast: `#B80F62` (pink as text) and `#45426E` (secondary text).
- **Type:** Michroma for display (wide, like lettering printed on hardware), Hanken Grotesk for body.
- **Different objects for different content:** tracks are list rows, playlists are MiniDisc cartridges,
  albums are jewel cases, artists are round chrome stickers.
- **The aisle is a screen in the device:** the page stays ice and chrome; the dark 3D aisle sits inside a
  chrome bezel like an oversized display, so the two moods do not fight.
- **Motion:** one orchestrated moment (the loading ring, then the dive into the aisle). Everything after that
  responds to an action: the aisle moves when you browse, the record spins while music plays, the like bursts.

## Accessibility

- Semantic landmarks, skip link, one `h1`, labelled sections.
- Every control has a visible label or an `aria-label`; toggles use `aria-pressed`.
- Visible 3px focus ring on every interactive element (indigo on light, aqua on dark surfaces).
- Seek slider is keyboard friendly: arrows jump 5 s, Page Up/Down 15 s, Home/End.
- Keyboard shortcuts: `/` search, `Space` play/pause (when no control is focused), `Esc` closes the sheet,
  `←` `→` move along the record aisle when it has focus.
- The loading screen is a real button (Enter or Space works), has a visible **Skip intro** button, closes with `Esc`,
  and keeps the page behind it out of the tab order until it is dismissed.
- Everything in the 3D aisle has a plain equivalent: previous/next record buttons, a Play button whose label
  names the record, and the full track list below.
- Result counts and like confirmations are announced through live regions.
- The detail sheet moves focus in, returns it on close, and leaves the player bar reachable.
- `prefers-reduced-motion`: the loading screen appears finished and closes instantly, the aisle changes record
  without flying, records do not spin, the spectrum shows a still pattern.
- Generated artwork has text alternatives where it carries meaning and is hidden where it is decorative.
- Measured contrast (WCAG ratio): indigo on ice 14.0, secondary text on ice 7.5, pink text on ice 5.2,
  indigo on pink button 4.6 to 5.3, aqua on LCD 11.1, text on player bar 10.9 or higher.
  White on pink is 3.3 and is not used for text.

## AI tools used

- **Claude (Anthropic):** design plan, HTML/CSS/JS, the generative music engine, automated browser checks, this README.
- `Add any other tools the team used here.`

## What was checked or changed

Automated checks run in headless Chrome during the build:

- No console or page errors on load; no horizontal overflow at 320, 360, 390, 768 and 1280 px.
- Play, pause, next, previous, seek (drag and keyboard), volume, mute, auto-advance at the end of a track.
- Genre filter, liked filter, search, empty states, clear filters.
- Like state, counter, toast and `localStorage` persistence.
- Playlist, album and artist sheets: open, play from inside, navigate album → artist, close with Esc and backdrop, focus return.
- Loading screen: tap, Enter, Skip and Esc all enter the site; focus lands on Play; the page behind is inert until then.
- Record aisle: buttons, arrow keys, swipe, clicking the next record, wrap-around, like from the aisle, and the aisle
  following the player bar's next/previous.
- Output level of all 14 generated tracks measured in four sections each: no clipping (peaks below 0.9).
- Touch targets: nothing interactive smaller than 40 × 28 px on a phone viewport.
- Reduced-motion mode verified.

Changes made after reviewing screenshots:

- Hero rebuilt from a disc-player deck into the vinyl loading screen and 3D record aisle.
- Player bar on narrow phones drops the cover thumbnail to give the title more room.
- Toast width, MiniDisc artwork and small-phone button sizing fixed.
- Pink text and white-on-pink text replaced with accessible alternatives.

Manual checks by the team (fill in before submitting):

- [ ] Listened to several tracks on laptop speakers and headphones
- [ ] Tested on a real phone (note: iPhones in silent mode mute Web Audio)
- [ ] Tabbed through the whole page with the keyboard
- [ ] Tested with a screen reader
- [ ] Checked the deployed Vercel URL

## Credits

- Fonts: [Michroma](https://fonts.google.com/specimen/Michroma) and
  [Hanken Grotesk](https://fonts.google.com/specimen/Hanken+Grotesk), Google Fonts, SIL Open Font License.
- Audio: Web Audio API, built into the browser. No samples or recordings.
- Artwork: generated SVG and CSS. No external images.
- Interaction reference: the ring loader and "fly into an aisle" browsing were inspired by Luka Skhiladze's
  portfolio site. Nothing was copied; the vinyl, the record aisle, the code and the artwork are our own.
- Libraries: none.
