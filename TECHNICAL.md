# Technical Documentation

This document describes the implementation and maintenance of OverlayRelay. For normal installation and OBS setup, use the [README](README.md).

## Architecture

The project has no package manifest or third-party server dependencies. `server.js` uses Node.js built-ins and the global `fetch` implementation available in modern Node releases.

### Main files

- `server.js` is the local HTTP helper. It serves the browser pages, persists shared configuration, emits server-sent events, proxies allowlisted YouTube images, and polls YouTube web live chat.
- `stream_chat_overlay.html` is the self-contained overlay and settings interface. Its HTML, CSS, Twitch IRC client, direct YouTube Data API path, renderer, demos, and local persistence live in one file.
- `control.html` is the smaller stream-target control page.
- `start-overlay.bat` stops a recognized previous helper instance, starts the Node server, and opens the control page.
- `overlay-config.example.json` documents the shared configuration shape.
- `overlay-config.json` and `overlay-server.pid` are ignored runtime files.

## Requirements

- Node.js 18 or newer for global `fetch`
- A modern browser or OBS Browser Source
- Network access to Twitch, YouTube, Google APIs, and optional BTTV endpoints

## Running locally

```powershell
node server.js
```

The helper binds to `127.0.0.1`, starts at port `8080`, and tries later ports if necessary.

Default pages:

- Control page: `http://localhost:8080/control`
- Overlay: `http://localhost:8080/stream_chat_overlay.html`

The port can be overridden:

```powershell
$env:PORT = 9000
node server.js
```

## Operating modes

### Local helper mode

When the overlay hostname is `localhost` or `127.0.0.1`, it:

- Loads shared settings from `GET /api/config`
- Watches configuration changes through `/api/events`
- Receives helper-generated YouTube messages and connection status through `/api/chat`
- Keeps OBS pointed at a stable local URL while stream targets change

### Standalone browser mode

When opened outside local helper mode, the overlay stores settings in browser `localStorage` under `schat5`. Selected non-private settings are also mirrored into the URL hash so an OBS URL can carry appearance and connection settings.

Twitch and Google OAuth access tokens are excluded from the URL hash but remain in browser local storage.

## HTTP endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Serve the overlay |
| `GET` | `/stream_chat_overlay.html` | Serve the overlay |
| `GET` | `/control` | Serve the control page |
| `GET` | `/control.html` | Serve the control page |
| `GET` | `/api/config` | Return shared configuration |
| `POST` | `/api/config` | Validate, save, and broadcast configuration |
| `GET` | `/api/version` | Identify the helper and current video |
| `GET` | `/api/events` | Configuration SSE stream |
| `GET` | `/api/chat` | Helper chat/status SSE stream |
| `GET` | `/api/img?url=...` | Proxy an allowlisted YouTube image |
| `POST` | `/api/shutdown` | Stop the local helper |

## Shared configuration

The helper recognizes these string fields:

```json
{
  "youtubeUrl": "",
  "youtubeApiKey": "",
  "twitchChannel": "",
  "twitchChannelId": ""
}
```

Writes are length-limited. Twitch channel names accept letters, numbers, and underscores; channel IDs accept digits.

The YouTube API key field supports the overlay's direct Data API mode. The helper's web-chat polling path extracts the Innertube client key and continuation data from the YouTube watch page.

## Chat sources

### Twitch

- Connects to `wss://irc-ws.chat.twitch.tv:443`
- Uses anonymous `justinfan` access when no OAuth token is supplied
- Requests Twitch IRC tags and commands
- Resolves global and channel badges
- Optionally loads BTTV global and channel emotes
- Renders all user-controlled text through DOM text nodes or `textContent`

### YouTube

There are two paths:

1. The standalone overlay can use YouTube Data API v3 with an API key or Google OAuth token.
2. The local helper extracts Innertube data from a watch page, polls the live-chat continuation endpoint, normalizes messages, and sends them to the overlay through SSE.

The helper path depends on undocumented YouTube page and continuation structures and may require maintenance when YouTube changes them.

## Security boundaries

- The helper binds only to IPv4 loopback and must not be exposed as a public web service.
- Requests with non-local `Host` headers are rejected to reduce DNS-rebinding risk.
- Cross-origin state-changing requests are rejected.
- Configuration POSTs require JSON and have a 16 KiB body limit.
- Responses include content-type, framing, referrer, and resource-policy headers. HTML receives a restrictive Content Security Policy.
- The image proxy accepts only HTTPS URLs from a small YouTube/Google image-host allowlist, rejects redirects and non-image responses, uses a timeout, and caps images at 5 MiB.
- `overlay-config.json` and `overlay-server.pid` are excluded through `.gitignore`.
- Credential fields are visually masked, but their values still exist in local files or browser storage when configured.

## Rendering safety

Chat usernames and message text are assigned through `textContent` or text nodes. Badge and emote image elements are created with DOM APIs instead of interpolating chat data into HTML. Remaining `innerHTML` assignments use fixed application-owned markup or clear existing messages.

## Manual verification

Check server syntax:

```powershell
node --check server.js
```

Recommended smoke test:

1. Start `node server.js`.
2. Open the overlay and use both demo modes plus the static test messages.
3. Open the control page and save a harmless configuration change.
4. Confirm the overlay updates without reloading.
5. Connect a test Twitch channel.
6. Connect an active YouTube live chat.
7. Add the overlay to an OBS Browser Source and confirm transparency and sizing.

Before publishing, confirm runtime files remain ignored:

```powershell
git check-ignore -v overlay-config.json overlay-server.pid
git status --short
```

## Known limitations

- The helper is local-only and cannot run on GitHub Pages.
- YouTube helper polling relies on undocumented upstream structures.
- OAuth tokens stored in browser local storage persist until disconnected or browser data is cleared.
- There is no automated test suite or package-managed lint configuration yet.
- The single-file overlay favors OBS portability over modular source organization.
