# Words for Vem: word portraits

Friends (no login) enter what Vem calls them and 2 to 3 words describing how
they see her (no word limit; a note says long ones may be shortened, and the admin list tags them "Long"). In each picture the background stays the original photo, and Vem
herself (with what she wears and holds) is rebuilt from those words. Hover or tap a word to see who wrote it.
Each picture holds a set number of descriptions, then the next picture starts.

## How a photo becomes a portrait
- Analysis (`public/analyze.js`): color, brightness, cleaned outline map
  (strong connected edges, specks removed), local line direction, and how busy
  each area is.
- Layout (`public/layout.js`): largest words first, down to tiny ones, using
  each word's real letter shapes so small words tuck into gaps. Words never
  cross the outline map (keeps the curves),
  and stay small in busy areas like the face. Words are only horizontal or
  vertical (upright where shapes run up and down), never slanted.
- Drawing (`public/render.js`): photo-color or single-ink words, a soft photo
  tone behind them so the background keeps its light and color, and an
  optional thin outline line.
- Descriptions repeat to fill the picture, so it looks complete from the first
  one; identical descriptions merge and appear more often. With none yet, the
  picture shows "Vem".
- The person: found automatically on upload with Google's MediaPipe selfie
  segmentation model (runs in the admin's browser, loaded from jsDelivr on first
  use, about 12 MB, Apache-2.0), then smoothed and cleaned of specks. By
  default her shape is filled with words on white over the untouched photo, with
  dense bold words in dark areas and airy ones on skin, a traced silhouette line
  and faint feature lines. Other options per picture: person white with the
  background in words, person white with hair in words, or everything in words.
- "Smooth the person": rounds off the cutout's outline, softens the shading
  and drops stray lines, for a cleaner figure.
- Admin brush: "Person" / "Not person" to fix the cutout, blue "fine detail"
  (small words) and red "keep empty".

Layout runs in each visitor's browser (about 0.5 to 2 seconds per picture) and
is cached until the descriptions change.

## Painting pipeline (per picture, all adjustable in the admin editor)
1. Photo prep (`public/prep.js`): local contrast boost, painterly smoothing
   (Kuwahara filter), and palette reduction (k-means) to a few paint colors.
2. Analysis: tone bands (clear light / mid / dark zones), outlines, and the
   person split into hair, skin, clothes and accessories. On the real site the
   split uses Google's MediaPipe multi-class selfie model, loaded on first use
   from jsDelivr and Google's model storage; otherwise it is guessed from skin
   color and darkness. Admin part brushes override either.
3. Layout: each part has its own style (hair dense and bold, skin tiny and
   airy, clothes medium, accessories in script) and one direction; variable
   font weight follows the tone; the brightest highlights stay empty; a faint
   "glaze" layer of tiny words sits underneath.
4. Pixel colors (default letter style, `public/pixel.js`): her figure is
   pixelated into blocks and snapped to a few color patches (k-means in Lab).
   Words are only placed where (almost) all their letters sit on one patch, so
   each word is a solid stroke of that patch's color; a last pass fills any
   leftover gaps, with each letter taking the color of the block under it.
   The patches also sit softly behind the words so the colors read as a whole.
5. Drawing: letters show the painted photo through their shapes (or one flat
   palette color each), small per-word variation, a soft edge where the person
   meets the photo, paper grain, and a high-resolution PNG export.

## Current default look
- Pixel blocks come first: her figure is pixelated and each block's brightness
  picks a shade on a black -> navy -> blue -> light blue -> white ramp. Those
  shades are the only colors in her figure, and they drive light and shade.
  (Option: put the background in the same shades too.)
- Two layers: continuous rows of tiny text across her figure (finer on the
  face) carry the shading; bigger accent words sit in hair, clothes and large
  even patches, never on the face.
- Chosen people: star a description in the admin list (Featured, then Top).
  Starred descriptions are placed first at the largest sizes (Top ones twice),
  anywhere on her figure except the face, within one part and away from
  bright highlights.

## Longer messages
Besides the 2 to 3 word description, friends can add an optional longer
message (up to 1,000 characters, line breaks kept). Hovering a word shows a
card with everything the people behind it sent: every short description (from
all pictures) and their messages, shortened; clicking or tapping opens the full
card. People are matched by the name they typed. Messages stay on the server
until the reveal, and the admin can edit them and export them with the rest.

## Admin features
- Moderation: edit any description and the sender's name.
- Timing: open/close switch, optional open and close times, and reveal mode.
  Until the reveal (a scheduled time or the "Reveal now" button), the server
  sends only each description's stand-in shape (same length and letter widths,
  different letters) plus a grouping key. The page lays out those shapes and
  shows each sender's name in the spot their words will take; after the reveal
  the same spots show the words. Party slideshow: `/?view=show`. Vem's view:
  `/?view=vem` (a welcome message and every picture, after the reveal).
- Your admin key: set your own key in Wall settings. Only a salted scrypt hash
  is stored; from then on the ADMIN_KEY environment variable no longer works.
  Wrong keys are rate limited (10 tries per 15 minutes). To reset a lost key,
  delete the `vem:adminKeyHash` entry in Upstash and use ADMIN_KEY again.
- Layout: lock (positions frozen; new descriptions take over spots of the most
  repeated ones, starred ones take big spots), reshuffle, pin a description to
  an exact spot, anonymous hover.
- Visitors: editable page text, party slideshow, print presets (A4, A3, A2)
  with an optional title and date line.
- Export people and descriptions as CSV, JSON or TSV (Google Sheets).
- Trash with restore, full backup/restore file, and stats.

## Structure
- `public/index.html`, `app.js`: messenger page
- `public/admin.html`, `admin.js`: admin editor, queue, moderation
- `public/lock.js`: locked layouts; `public/admin-wall.js`: wall settings, links, admin key
- `public/prep.js`: photo prep; `public/pixel.js`: pixel color patches; `public/person.js`: cutout and part detection
- `public/wordart.js`: rules shared with the server (limits, fill order, settings)
- `public/art.js`: caching glue; `public/backend.js`: API client
- `api/state.js`, `api/photo.js`, `api/lock.js`, `api/submit.js`, `api/admin.js`; `lib/redis.js`
- `tests/wordart.test.mjs`: `npm test`

## Deploy on Vercel
1. Import this folder into Vercel (Framework: Other), or run `vercel` in it.
2. Add **Upstash for Redis** (free tier) from the project's Storage tab.
3. Add env var `ADMIN_KEY` with a long random value. Keep it private.
4. Redeploy, open `/admin.html`, enter the key, upload photos, tune each, save in order.
5. Share the root URL.

Note: pictures keep their backgrounds, so the downscaled photos (about 40 to
60 KB each) are stored and visible to anyone with the link.
