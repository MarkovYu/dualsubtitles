# Chrome Web Store - Submission Notes

Copy/paste these into the Chrome Web Store developer dashboard fields.

## Listing Name

Dual Subtitles: Learn Languages with Movies

## Short Description

Dual subtitles for Prime Video & Kino.pub with Chrome built-in translation,
clickable words, and a private vocabulary book.

## Single Purpose

Show dual subtitles on supported video sites and help language learners by
translating subtitle words and saving them to a personal vocabulary.

## Permission Justifications

- **storage** - Saves the user's settings and vocabulary locally in the browser.
- **scripting** - Runs a small page helper that reads subtitle metadata and
  playback timing on supported video pages.
- **activeTab** - Lets the user click the extension button and show or restore
  the panel on the current active tab. It is also used for on-demand injection
  when the popup is opened on a supported page where the content script was not
  already loaded.
- **Host access (kino.pub, kino.watch, primevideo.com, amazon.de/com/co.uk)** -
  Required to run the subtitle overlay on supported video pages.
- **Host access (api-free.deepl.com, api.deepl.com, libretranslate.de,
  translate.argosopentech.com, api.mymemory.translated.net)** - Required only
  when the user selects one of those online translation services.

## Data Usage Disclosure

- Stores settings and saved vocabulary locally in `chrome.storage.local`.
- Chrome built-in translation is processed locally by Chrome when available.
- If the user selects an online translator, sends only the word or subtitle line
  being translated to that selected service.
- No analytics, no tracking, no data sent to the developer.
- Privacy policy URL: add the public URL where `PRIVACY.md` is hosted.

## Listing Checklist

- [ ] 128x128 store icon (`icons/icon128.png`)
- [ ] Screenshots uploaded at 1280x800 or 640x400
- [ ] Short description copied from this file
- [ ] Detailed description copied from `CHROME-STORE-DESCRIPTION.txt`
- [ ] Category: Education or Productivity
- [ ] Privacy policy URL filled in
- [ ] EEA trader disclosure completed
- [ ] $5 developer registration paid

## Notes / Risk

- The extension is independent and not affiliated with Amazon, Prime Video,
  Kino.pub, DeepL, LibreTranslate, or MyMemory.
- The Prime Video subtitle capture reads subtitle text exposed by the player and
  does not download or redistribute video/audio.
