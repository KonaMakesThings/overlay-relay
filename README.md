# OverlayRelay

Combined Twitch + YouTube chat for OBS.

I got frustrated with all the available overlays that combine Youtube + Twitch chat, so I made this! This simple overlay will combine your Twitch chat with your Youtube stream chat. Highly customizable.

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

OverlayRelay only needs a Twitch channel name and a YouTube video ID or URL. No Twitch sign-in, Google sign-in, API key, or manually entered channel ID is required.

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

Those are the only connection details OverlayRelay needs.

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

OverlayRelay places chat in the bottom-left corner of the browser canvas by default. To position it elsewhere in OBS, hold `Alt` and drag the Browser Source edges to crop away unused transparent space, then move the cropped source where you want it. You can also choose left, center, or right alignment from OverlayRelay's settings.

If port `8080` was already in use, the terminal will show the alternate port selected by the helper. Use that port in both URLs.

## Customize the look

Open the overlay URL in a regular browser and select the gear button. You can adjust:

- Font and size
- Chat position and width, with an option to fit each box to its message
- Background transparency and corner rounding
- Message spacing, lifetime, and maximum message count
- Username colors, badges, emotes, and platform labels
- A username blacklist for bots or unwanted accounts

Use the Twitch Demo, YouTube Demo, or test-message buttons to preview changes without going live.

### Fitting boxes to short messages

By default every message box stretches to the full **Chat Width**. Turn on **Fit box
to message** and Chat Width becomes a maximum instead. A short message like "gg" gets
a short box, and a long message still grows to the maximum and wraps onto the next
line. The boxes follow the **Chat Anchor** setting, so they line up on the left, on the
right, or in the centre.

### Keeping chat readable over video

The **Legibility over video** controls decide whether chat survives a bright or busy
scene. There are two, and they stack:

- **Outline** wraps each letter in a solid edge. This is the single most effective
  setting — a value of 2 is usually enough.
- **Shadow** adds separation underneath. **Halo** and **Heavy** surround the text
  evenly and suit busy footage; **Hard** offsets it for a sharper look.

Turn on the dark preview background while you adjust them, then check the result over
your actual scene.

## Everyday use

Before each stream:

1. Double-click `start-overlay.bat`.
2. Update the YouTube URL or Twitch channel on the control page if needed.
3. Start OBS normally.

When you are finished, close the terminal window running the helper or press `Ctrl+C` inside it.

## Updating

To install a newer version, copy it over your existing folder:

1. Close the terminal window running the helper.
2. Download the latest version as a ZIP:
   [overlay-relay main.zip](https://github.com/KonaMakesThings/overlay-relay/archive/refs/heads/main.zip)
3. Open the ZIP. It contains a folder named `overlay-relay-main`. Copy everything
   **inside** that folder into your existing OverlayRelay folder, and choose
   **Replace** when Windows asks.
4. Double-click `start-overlay.bat`.
5. In OBS, open the OverlayRelay source's properties and select **Refresh cache of
   current page**.

Your YouTube URL, Twitch channel, and appearance settings are kept, and the OBS URL
stays the same.

- **Close the helper first.** It only loads its code when it starts, so a helper left
  running keeps using the old version.
- **Copy the folder's contents, not the folder.** If you drag `overlay-relay-main`
  itself into your OverlayRelay folder, the new files end up in a subfolder and are
  never used.

New options start switched off. To turn one on for OBS, right-click the source, choose
**Interact**, and change it in the settings panel there.

If you cloned the repository with Git instead, close the helper, run `git pull`, and
start it again.

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

### YouTube messages arrive later than Twitch

This is expected, and most of it cannot be fixed.

Twitch sends chat over a socket that stays open, so messages arrive almost instantly.
YouTube has no equivalent public feed, so OverlayRelay has to ask YouTube for new
messages on a timer. Messages are already about a second old when YouTube hands them
over, and the wait between checks adds up to a couple of seconds more. Expect YouTube
chat to trail Twitch by roughly one to four seconds.

OverlayRelay does spread each batch out as it arrives, so YouTube chat flows steadily
rather than appearing in bursts. Checking more often would save around a second at the
risk of YouTube rate-limiting you, so it deliberately does not.

### Settings changes do not seem to take effect

Appearance settings apply as soon as you change them. Anything that changes how the
helper itself behaves takes effect only when the helper restarts — close the terminal
window and run `start-overlay.bat` again.

Note that OBS keeps its own copy of the appearance settings, separate from your normal
browser. To carry a look across, either paste the OBS URL from the settings panel into
your Browser Source, or right-click the source in OBS, choose **Interact**, and adjust
the settings there.

### The control page will not open

- Make sure Node.js is installed.
- Run `node --version` in PowerShell; it should report version 18 or newer.
- Check whether Windows Firewall or security software blocked Node.js from running locally.

## Privacy and credentials

The helper only listens on your computer and is not intended to be exposed to the internet.

Your stream targets are stored in `overlay-config.json`. This local file contains the current YouTube URL and Twitch channel name, and Git is configured not to upload it. `overlay-config.example.json` is the blank, publishable example included in the repository.

## License

OverlayRelay is available under the [MIT License](LICENSE). You may use, modify, and share it, including for commercial purposes, as long as the license and copyright notice are kept with the software.
