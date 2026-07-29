# Privacy Policy - Dual Subtitles

_Last updated: 2026-07-29_

Dual Subtitles is a browser extension that shows dual subtitles and lets you
translate words while watching video. This policy explains what the extension
does with data.

## What the extension stores

- **Your settings** (languages, chosen translator, panel options) and your
  **saved vocabulary** (words you click "Save" on, with their translation and
  the subtitle line they came from) are stored locally in your browser using
  `chrome.storage.local`.
- This data is not sent to the developer.

## What is sent to third parties

- When **Chrome built-in translation** is available and selected, translation is
  processed locally by Chrome on your device. The extension does not send that
  text to the developer or to a third-party translation server.
- If you explicitly choose an online translator, or enter an API key, only the
  text being translated is sent to the translation service you selected:
  - **DeepL** (only if you enter your own API key) - https://www.deepl.com/privacy
  - **LibreTranslate** - https://libretranslate.com/
  - **MyMemory** - https://mymemory.translated.net/doc/usage-policy.php
- No account information, browsing history, analytics identifiers, or personal
  identifiers are sent by the extension.

## What the extension does not do

- It does not collect analytics or telemetry.
- It does not send data to the developer or to a server owned by the developer.
- It does not track your browsing.
- It does not download, record, copy, or redistribute video or audio. It only
  reads subtitle text that the page already provides.

## Permissions

- `storage` - save your settings and vocabulary locally.
- `scripting` - run a small on-page helper that reads subtitle metadata and
  playback timing on supported video pages.
- `activeTab` - lets the toolbar popup show or restore the panel on the current
  active tab after you click the extension button.
- Host access to Amazon Prime Video and Kino.pub - required so the extension can
  run on those video pages.
- Host access to DeepL, LibreTranslate, and MyMemory - required only when you
  choose one of those online translation services.

## Data deletion

Use **Clear all** on the vocabulary page, or remove the extension, to delete all
stored data.

## Contact

For questions or bug reports, contact the developer at the address listed on the
Chrome Web Store listing.
