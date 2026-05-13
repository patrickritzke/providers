# Celeste for Intapp Requests

Adds a **Celeste** button to the Intapp request page banner. Clicking it
slides in a side drawer with a chat-style UI (textbox, suggested
prompts, playbook list). The drawer is a **mock** — the input and
playbook list are wired up but don't do anything yet.

Activates only on URLs starting with:

    https://shalaka2-sand.opensandbox2.intapp.com/app/request.aspx

## Install (unpacked)

1. Unzip this folder somewhere on disk.
2. Open Chrome → `chrome://extensions`.
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and pick the unzipped folder.
5. Refresh any open Intapp request page. A **Celeste** button appears
   in the banner next to the search box.

## Files

| File          | Purpose                                                   |
|---------------|-----------------------------------------------------------|
| `manifest.json` | MV3 manifest, restricts content script to request.aspx  |
| `content.js`    | Injects the trigger button + builds the drawer          |
| `drawer.css`    | Sandboxed styles (all selectors prefixed `celeste-*`)   |
| `icons/`        | 16/48/128 px extension icons                            |

## Notes

- Trigger sits inside `.banner-tools`, just before `.banner-search`.
- Drawer is appended to `<body>` and uses `z-index: 2147483647` so it
  floats above any Intapp UI.
- Press `Esc` or click the backdrop to close.
- A `MutationObserver` watches the DOM and re-injects the button if
  Intapp re-renders the banner.
