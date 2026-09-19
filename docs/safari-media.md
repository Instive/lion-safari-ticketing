# Safari media refresh

Source uploads used: `IMG_7978.JPG`, `IMG_7981.JPG`, `IMG_7983.JPG`,
`IMG_7984.JPG`, and `IMG_7976.MOV`. The website uses self-contained web-sized
copies in `public/media/`, with responsive Next.js images and lazy loading below
the hero. The source uploads are no longer present in `public/`; this task did
not delete them. No package dependencies were added.

## Edited assets

Created with the built-in image-generation tool, then encoded to WebP with the
installed Sharp library. Original artwork and photos are not overwritten.

- `public/media/safari-hero.webp`: cleaned hero artwork; no embedded lettering or
  lower collage. Used as decorative imagery beneath real HTML headings.
- `public/media/lion-portrait-restored.webp`: restored featured portrait, based on
  `IMG_7978.JPG`; also used in the gallery.

Hero prompt:

> Use case: precise-object-edit. Edit this existing website hero artwork. Deliver a single wide landscape 16:9 hero image of ONLY the large upper scene: the male lion resting beneath the tree in a green forest. Completely remove ALL embedded text, lettering, slogans, graphic lines and logos on the left, naturally reconstructing forest foliage and soft woodland shadows there. Remove the entire lower three-panel collage and its white separators. Preserve the main lion's identity, facial features, pose, paws, lighting and warm fur, the tree at right and the forest setting. Compose the lion mainly on the RIGHT HALF with generous softly shaded forest negative space on the LEFT HALF for HTML heading overlay. Premium natural wildlife photographic aesthetic, believable detail, no added animals, no borders, no text or watermarks. Save a new image; do not overwrite source.

Portrait prompt (using a normalized WebP copy of the upload):

> Restore this exact real lion photograph for a zoo gallery. Preserve the exact same individual lion, face, anatomy, expression, pose, paws, tree trunk, ground, greenery and portrait composition. Improve natural white balance, exposure, fur clarity and contrast, reduce haze and sensor noise gently. Do not invent, add or remove objects or change the environment. No dramatic lighting, oversaturation, artificial bokeh, text, watermark or borders. Portrait 3:4 format.

## Other photos and video

- `lion-shelter.webp`, `lion-resting.webp`, `lion-profile.webp`: original photographs
  reoriented from EXIF, resized to at most 1440px wide, and encoded at WebP quality
  80. Pixel contents otherwise unchanged.
- `lion-portrait.webp`: normalized original retained alongside the restored edit.
- `lion-safari-preview.mp4`: eight-second H.264 preview, generated with macOS
  `avconvert`, preset `Preset640x480`, from the uploaded MOV. Source metadata is
  filtered by the encoder's default settings.
- `lion-video-poster.webp`: frame extracted at two seconds, encoded to WebP.

The uploaded photographs and video live on the gallery page. The homepage uses
the cleaned hero and the existing safari illustrations, with a link to the gallery.
The video element and its source are mounted only after pressing Play. It starts
muted, uses native playback controls and inline playback, and never loops or
loads automatically on page arrival. Hero motion has an explicit pause button
and is disabled under `prefers-reduced-motion`.

The gallery mounts enlarged images only while open, supports arrow keys, Escape
and touch swipes, and locks background scrolling while the dialog is open.
