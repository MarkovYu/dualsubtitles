# Dual Subtitles: Learn Languages with Movies

Dual Subtitles is a free Chrome extension for watching films and series with two subtitle lines: the original subtitle line and a translation underneath it.

It is built for language learners who want to stay inside the video player: click words, translate them, and save useful words to a private vocabulary book.

[Chrome Web Store](https://chromewebstore.google.com/detail/dual-subtitles-learn-lang/jajbflfkcnblbbhfahhagfkonbeghpbc)

## Supported Sites

- Amazon Prime Video
- Kino.pub

You can vote for more supported websites on the project website:
https://www.y-markov.com/dual-subtitles/vote

## Features

- Dual subtitles: original line plus translated line.
- Click-to-translate words directly in the subtitle overlay.
- Private vocabulary book stored locally in Chrome.
- CSV and JSON vocabulary export.
- Chrome built-in translation when available.
- Optional online fallback translators: LibreTranslate and MyMemory.
- Optional DeepL support with the user's own API key.
- Subtitle size, position, timing offset, and language settings.

## Privacy

The extension has no developer backend and does not collect analytics or telemetry.

Settings and vocabulary are stored locally with `chrome.storage.local`. When Chrome built-in translation is available, translation is handled by Chrome. If an online translator is selected, only the text being translated is sent to that selected service.

See [PRIVACY.md](PRIVACY.md) for details.

## Project Structure

```text
extension/                 Chrome extension source
website/                   Static project website pages
store-assets/screenshots/  Chrome Web Store screenshots
scripts/                   Release helper scripts
CHROME-STORE-DESCRIPTION.* Store listing copy
STORE-NOTES.md             Store submission notes
PRIVACY.md                 Privacy policy
LICENSE                    License
```

## Local Development

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the `extension` folder.
5. Open Amazon Prime Video or Kino.pub and start a video with subtitles.

After editing the extension, reload it on `chrome://extensions` and refresh the video page.

## Build a Store Package

Run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-extension-zip.ps1
```

The script creates a Chrome Web Store upload package in `dist/`.

## Website

The website is static HTML/CSS. Open `website/index.html` locally or publish the `website/` folder to your hosting provider.

## Independent Project

Dual Subtitles is an independent project and is not affiliated with, endorsed by, or sponsored by Amazon, Prime Video, Kino.pub, DeepL, LibreTranslate, or MyMemory.
