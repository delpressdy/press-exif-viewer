# Press

Press is a pure front-end image metadata viewer and cleaner. It helps people inspect EXIF data, spot GPS location metadata, remove embedded metadata in the browser, and download cleaned image copies.

## Features

- Multiple image upload with drag-and-drop and file picker support.
- JPG/JPEG, PNG, and WebP support where the browser can decode the image.
- Friendly unsupported messaging for HEIC/HEIF files.
- Per-image metadata cards with Summary, Camera, Location, Image, Copyright, and Full EXIF tabs.
- Searchable Advanced / Full EXIF Data view, collapsed by default.
- GPS detection with an interactive Leaflet/OpenStreetMap map when coordinates exist.
- Optional live browser GPS comparison on the Location tab, with user permission.
- Browser-only metadata removal using Canvas.
- Per-image clean copy downloads.
- Batch metadata removal.
- ZIP download for multiple cleaned images using JSZip.
- Playful "Send love" form that sends text through Web3Forms and keeps recent animation messages in localStorage after successful sends.
- Responsive, accessible, GitHub Pages-ready interface.

## How It Works

1. The user selects or drops image files into the page.
2. Press reads each file locally with browser APIs.
3. The `exifr` library extracts embedded metadata when available.
4. Browser image decoding provides basic properties such as pixel dimensions.
5. If GPS metadata exists, Press shows an interactive Leaflet map with OpenStreetMap tiles, map-app links, coordinate copy, and optional live browser GPS comparison.
6. When cleaning an image, Press loads the pixels into Canvas and exports a new high-quality JPEG Blob.
7. The optional love form sends text fields through Web3Forms.
8. The cleaned Blob is offered as a download using a filename like:

```text
original-name_cleaned-by-press.jpg
```

The original file is never modified.

## Privacy

Press has no backend, no authentication, no database, and no analytics. Images are processed locally in the browser and are not uploaded to a server.

Interactive GPS maps use OpenStreetMap tiles through Leaflet. The map is created only when GPS metadata exists and the Location tab is opened. Live GPS uses the browser Geolocation API only after the user grants permission.

The love message form sends only text fields through Web3Forms. No image files are submitted with this form.

## Run Locally

You can open `index.html` directly in a browser for image inspection and cleaning:

```text
press/index.html
```

To test the love form in the same kind of environment used by GitHub Pages, run a local static server:

```bash
cd press
python -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

The image viewer and cleaner work as static files. Browser geolocation and form submission should be tested from `http://localhost` or GitHub Pages.

## Test Web3Forms Delivery

1. Start the local server with `python -m http.server 8000` from the `press` folder, or open the deployed GitHub Pages URL.
2. Submit the love form.
3. Confirm the app shows a success message.
4. Check the Web3Forms destination inbox connected to the access key.

The Web3Forms access key is a public form identifier, not a secret server API key. For stronger protection after deployment, configure allowed domains in the Web3Forms dashboard if your plan supports it.

## Deploy To GitHub Pages

Recommended repository name: `press-exif-viewer`.

Because this project is static, the contents of the `press` folder should become the repository root:

```text
press-exif-viewer/
  index.html
  styles.css
  app.js
  README.md
  assets/
```

### Option A: GitHub Website Upload

1. Go to GitHub and create a new public repository named `press-exif-viewer`.
2. Open the new repository and choose **Add file** -> **Upload files**.
3. Upload the contents inside the local `press` folder, not the parent folder itself.
4. Commit the files to the `main` branch.
5. Open **Settings** -> **Pages**.
6. Under **Build and deployment**, choose **Deploy from a branch**.
7. Select branch `main` and folder `/root`.
8. Save the Pages settings.
9. After GitHub finishes deployment, visit:

```text
https://<your-github-username>.github.io/press-exif-viewer/
```

### Option B: Git Commands If Git Is Installed

```bash
cd press
git init
git branch -M main
git add .
git commit -m "Initial Press app"
git remote add origin https://github.com/<your-github-username>/press-exif-viewer.git
git push -u origin main
```

Then enable Pages in **Settings** -> **Pages** using branch `main` and folder `/root`.

No build command is required.

## Libraries Used

- [exifr](https://github.com/MikeKovarik/exifr) for EXIF and metadata reading.
- [Leaflet](https://leafletjs.com/) for browser maps.
- [OpenStreetMap](https://www.openstreetmap.org/) map tiles.
- [JSZip](https://stuk.github.io/jszip/) for client-side ZIP downloads.
- [Lucide](https://lucide.dev/) for interface icons.
- [Web3Forms](https://web3forms.com/) for static-site form delivery.

All libraries are loaded from public CDNs in `index.html`.

## Known Limitations

- HEIC/HEIF files are not decoded by this app because reliable browser-only conversion usually requires a heavier library.
- Canvas export creates JPEG files, so PNG transparency is flattened onto a white background.
- Any image conversion can slightly change file size or visual quality.
- Very large images can hit browser memory or Canvas limits.
- Some browsers handle EXIF orientation differently during image decoding.
- Live GPS requires browser permission and may be unavailable on insecure origins or privacy-restricted devices.
- The email form depends on Web3Forms availability and the configured access key destination.
- Some metadata fields may be missing, rewritten, or stripped by cameras, editing apps, messaging apps, and social platforms.
- Metadata can be edited, removed, or inaccurate, so it should not be treated as absolute proof.

## Browser Compatibility

Press is designed for modern desktop and mobile browsers that support:

- File input and drag-and-drop.
- Blob and object URLs.
- Canvas `toBlob()`.
- Image decoding through `createImageBitmap()` or `Image`.
- Modern JavaScript loaded in a standard browser page.

If a browser blocks a feature or cannot decode a specific image format, Press shows a friendly message where possible.

## Disclaimer

Metadata availability depends on the source image, device, app, file format, privacy settings, and editing history. Press is a privacy helper, not a forensic guarantee.
