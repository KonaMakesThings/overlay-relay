# OverlayRelay

Combined Twitch + YouTube chat for OBS.

I got frustrated with all the available overlays that combine Youtube + Twitch chat, so I made this! This simple overlay will combine your Twitch chat with a Youtube stream chat of your choice. Highly customizable.

## What it does

- Combines Twitch and YouTube live chat in one feed
- Works as an OBS Browser Source
- Shows names, colors, badges, emotes, and optional platform labels
- Includes controls for font size, backgrounds, spacing, message lifetime, and more
- Lets you preview the overlay with built-in demo messages
- Runs locally on your computer, meaning there is no hosted account or remote control service

## What you need

- Windows 10 or 11
- [OBS Studio](https://obsproject.com/)
- A current version of [Node.js](https://nodejs.org/) (Node 18 or newer)
- Your Twitch channel name
- The URL of your YouTube livestream, if you want YouTube chat

You can read Twitch chat anonymously and use the local YouTube helper without entering an OAuth token. Optional sign-in and API-key controls are available for advanced setups.

## Quick start

### 1. Download and open the project

Download the repository as a ZIP from GitHub, extract it somewhere permanent, and open the extracted folder.

### 2. Start the overlay helper

Double-click `start-overlay.bat`.

A terminal window will stay open while the overlay is running, and the control page should open in your browser. Keep the terminal window open during your stream.

If the control page does not open, visit:

```text
http://localhost:8080/control
```

### 3. Choose your chats

On the control page:

1. Paste your YouTube livestream URL, if applicable.
2. Enter your Twitch channel name.
3. Select **Save and update OBS**.

The YouTube API key and Twitch channel ID fields are optional for the normal local setup.

### 4. Add it to OBS

In OBS:

1. Open the scene where you want chat to appear.
2. Under **Sources**, select **+** and then **Browser**.
3. Create a new source named `OverlayRelay` or whatever you want it to be.
4. Use this URL:

   ```text
   http://localhost:8080/stream_chat_overlay.html
   ```

5. Set the width and height to match your OBS canvas, commonly `1920 × 1080`.
6. Select **OK**.

If port `8080` was already in use, the terminal will show the alternate port selected by the helper. Use that port in both URLs.

## Customize the look

Open the overlay URL in a regular browser and select the gear button. You can adjust:

- Font, size, and text outline
- Chat position and width
- Background transparency and corner rounding
- Message spacing, lifetime, and maximum message count
- Username colors, badges, emotes, and platform labels
- A username blacklist for bots or unwanted accounts

Use the Twitch Demo, YouTube Demo, or test-message buttons to preview changes without going live.

## Everyday use

Before each stream:

1. Double-click `start-overlay.bat`.
2. Update the YouTube URL or Twitch channel on the control page if needed.
3. Start OBS normally.

When you are finished, close the terminal window running the helper or press `Ctrl+C` inside it.

## Troubleshooting

### Chat does not appear in OBS

- Confirm `start-overlay.bat` is still running.
- Open the overlay URL in your normal browser to see whether it works there.
- In OBS Browser Source properties, select **Refresh cache of current page**.
- Check the terminal for a port other than `8080`.

### Twitch is not connecting

- Enter only the channel name, without `twitch.tv/` or a leading `#`.
- Confirm the channel is spelled correctly.
- Try the Twitch Demo button to make sure the overlay itself is visible.

### YouTube is not connecting

- Use the full livestream URL or its 11-character video ID.
- Confirm live chat is enabled for that video.
- Recently ended streams may work while YouTube chat replay remains available.

### The control page will not open

- Make sure Node.js is installed.
- Run `node --version` in PowerShell; it should report version 18 or newer.
- Check whether Windows Firewall or security software blocked Node.js from running locally.

## Privacy and credentials

The helper only listens on your computer and is not intended to be exposed to the internet.

Your personal settings are stored in `overlay-config.json`. This ignored local file may contain a YouTube API key. Never commit or share the real file. `overlay-config.example.json` is the safe blank example included in the repository.

OAuth tokens entered into the full settings panel are stored in that browser's local storage. Do not share browser profiles, copied profile data, or screenshots that reveal token fields.

## Technical documentation

Developers and contributors can find architecture, endpoints, storage behavior, security boundaries, and testing notes in [TECHNICAL.md](TECHNICAL.md).
