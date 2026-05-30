# Web UI/UX Implementation Notes

Implemented the `PLAN.md` web UI phase in `data/assets`.

## Files Changed
- `data/assets/index.html`
- `data/assets/res/ezremote-ui.css`
- `data/assets/res/ezremote-ui.js`

## What Changed
- Added a dedicated ezRemote UI layer loaded after the existing Angular file manager bundle.
- Added a sticky top bar with current path, breadcrumb navigation, search, refresh, and view controls.
- Added a compact icon action toolbar for create, upload, install, download, edit, organize, and remove actions.
- Kept the item browser list-only and removed the grid/icon view toggle.
- Added visible selection count and clear-selection control.
- Added clear loading, empty-folder, no-filter-results, and error/retry state banners.
- Added responsive desktop/mobile styling with larger touch targets and improved modal scrolling.
- Added card and table layout improvements for clearer hit areas and selected states.
- Added lightweight toast feedback for existing `/__local__/...` API responses.
- Added a navigation visibility filter: root only shows `/data` and `/mnt`; `/mnt` only shows non-empty `usb*` and `ex*` child directories.
- Added a PKG drop/install target with native drop handling. It uploads dropped or selected `.pkg` files to the current `/data` or allowed `/mnt/{usb*,ex*}` path, falling back to `/data`, then calls the existing install API.
- Removed the sidebar tree and replaced path navigation with clickable breadcrumb segments that open sibling-folder dropdowns.
- Added recursive filtering with configurable scan depth, defaulting to 2 layers, plus quick filter chips for common archive/package extensions.
- Added a recent-path dropdown beside the current path with local browser persistence.
- Added reliable path Back, Forward, and Up controls above the directory panel, plus a `/mnt` mount shortcut in the top navigation.
- Added mouse side-button support: button 4 navigates path Back and button 5 navigates path Forward without triggering browser history.
- Kept the web upload payload limit at 12 MiB; the small `/__local__/uploadResumeSize` requests are resume probes, not file data chunks.
- Added a 1 MiB server-side write buffer for upload multipart data to avoid tiny filesystem writes when the HTTP parser emits small chunks.
- Hardened the upload handler so multipart/read/write failures return API failure instead of false success.
- Kept the existing backend API contract and endpoints unchanged.

## Endpoint Notes
- Existing endpoints under `/__local__/...` are still used.
- `uploadResumeSizeUrl` now includes the missing leading slash: `/__local__/uploadResumeSize`.

## Verification
- Targeted whitespace check passed for the changed UI files.
- CSS brace balance check passed.
- JavaScript string-literal scan passed.
- Referenced UI asset existence check passed.

## Known Workspace Note
- `README.md` already has an unrelated trailing whitespace warning from `git diff --check`; it was not changed as part of this work.
