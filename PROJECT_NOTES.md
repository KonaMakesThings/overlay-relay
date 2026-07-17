# Project Notes

Last refamiliarized: 2026-06-30

## Current State

- The repository currently has only loose files and no tracked baseline in git.
- Main implementation is a single large HTML file plus a small Node helper.
- The overlay UI is dense and self-contained: HTML, CSS, and JavaScript are all in `stream_chat_overlay.html`.
- Some comments and UI glyphs display as mojibake when read in the current terminal, which suggests an encoding mismatch or a file saved with characters the terminal is not decoding cleanly. Browser rendering may still be fine; verify visually before doing broad text cleanup.

## Files And Responsibilities

- `server.js`
  - Serves `/`, `/stream_chat_overlay.html`, `/control`, and `/control.html`.
  - Stores config in `overlay-config.json`.
  - Writes/removes `overlay-server.pid`.
  - Provides `/api/config`, `/api/version`, `/api/events`, `/api/chat`, `/api/img`, and `/api/shutdown`.
  - Broadcasts config and YouTube helper chat/status over server-sent events.
  - Polls YouTube web live chat via Innertube continuations.

- `stream_chat_overlay.html`
  - Main OBS overlay and full settings panel.
  - Persists settings in `localStorage` key `schat5`.
  - Encodes non-private settings into the URL hash.
  - Connects to Twitch IRC over WebSocket.
  - Can poll YouTube Data API directly when not relying on helper SSE.
  - Renders Twitch/YouTube badges, emotes, BTTV emotes, blacklist filtering, demo modes, keyboard shortcuts, and appearance controls.

- `control.html`
  - Minimal form for YouTube URL/API key and Twitch channel/channel ID.
  - Saves through `/api/config`.
  - Shows the stable OBS source URL.

- `start-overlay.bat`
  - Stops the pid from `overlay-server.pid` if present.
  - Tries `/api/shutdown` on ports `8080` through `8082`.
  - Opens the control page and runs `node server.js`.

## Risks / Things To Watch

- `overlay-config.json` is local runtime state and currently contains sensitive credentials. Avoid committing it as-is. Prefer a future `overlay-config.example.json` plus `.gitignore` entries for `overlay-config.json` and `overlay-server.pid`.
- YouTube helper behavior depends on undocumented YouTube page/Innertube structures. Expect it to break occasionally when YouTube changes markup or continuation payloads.
- `control.html` has a YouTube API key field, but `server.js` currently ignores the saved API key for helper polling and instead extracts an Innertube key from the watch page.
- `stream_chat_overlay.html` has two YouTube paths: direct Data API polling and helper SSE polling. Be careful to understand which path is active before changing YouTube behavior.
- The server is loopback-only and rejects cross-origin state changes. It remains a local helper and should not be exposed publicly.
- There are no automated tests or lint checks yet.

## Useful Implementation Details

- Server mode detection in the overlay is `['localhost','127.0.0.1'].includes(location.hostname)`.
- Helper config keys are `youtubeUrl`, `youtubeApiKey`, `twitchChannel`, and `twitchChannelId`.
- Overlay settings keys are shorter (`yv`, `yk`, `tc`, `tid`, etc.) and are mapped by `applyServerConfig`.
- URL hash excludes `ttoken` and `gtoken`, but includes some connection fields like Twitch channel and YouTube URL/API key.
- Twitch chat connection uses `PASS SCHMOOPIIE` and a random `justinfan` nickname when no OAuth token is provided.
- Blacklist comparison is exact, case-insensitive username matching after trimming each configured name.

## Good Next Steps

- Keep `.gitignore` and `overlay-config.example.json` aligned if config fields change.
- Decide whether the supported YouTube path should be helper Innertube polling, Data API polling, or both.
- Consider splitting `stream_chat_overlay.html` into separate CSS/JS only if future changes become unwieldy; for OBS portability, the current single-file shape has advantages.
- Add a small manual QA checklist or screenshot workflow if visual polish changes are planned.
