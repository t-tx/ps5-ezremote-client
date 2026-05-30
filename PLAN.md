# Web UI/UX Improvement Plan

## Goal
Improve the ezRemote Web UI for faster, safer, and easier file management interactions while keeping the existing backend API contract unchanged.

## Scope
- Web UI only (`/index.html` and frontend assets).
- Keep all existing endpoints under `/__local__/...`.
- No changes to transfer engine, server-side file semantics, or protocol clients in this phase.

## Non-Goals (for this phase)
- Game metadata/catalog features.
- Browser cache for game info.
- Backend API redesign.

## Constraints
- Work directly with `data/assets/index.html`.
- Preserve compatibility with existing responses:
  - Success: `{ "result": { "success": true, "error": null } }`
  - Failure: `{ "result": { "success": false, "error": "..." } }`
- Desktop and mobile browsers must both remain usable.

## Deliverables
1. Updated `data/assets/index.html` with improved layout shell.
2. New stylesheet for visual/interaction improvements (responsive + touch-friendly).
3. New JavaScript controller layer for UX enhancements using existing APIs.
4. No breaking changes to existing backend endpoint usage.

## Implementation Phases

### Phase 1 - Foundation
- Add new UI structure: sticky top bar, path/breadcrumb area, action bar, content region.
- Introduce clear state zones: loading, empty folder, and error banner.
- Keep current core actions discoverable at all times.

### Phase 2 - File Interaction UX
- Improve selection model (single/multi with visible count and active state).
- Group actions by intent: create, organize, transfer, destructive.
- Improve confirmation dialogs for destructive actions (delete/move conflicts).
- Add lightweight toast/inline feedback for success/failure.

### Phase 3 - Navigation & Productivity
- Faster directory navigation feedback (current path always visible).
- Better sorting and filtering interaction (clearer controls and labels).
- Consistent row/card hit areas for mouse and touch.

### Phase 4 - Mobile Responsiveness
- Toolbar compaction for narrow screens.
- Larger tap targets and spacing for touch.
- Modal sizing and scrolling fixes for small displays.

### Phase 5 - Stabilization
- Regression pass for all API-backed actions:
  - list, rename, move, copy, remove
  - upload, download, createFolder
  - compress, extract, edit/getContent
- Visual and behavior consistency pass.

## API Mapping (unchanged)
- `POST /__local__/list`
- `POST /__local__/rename`
- `POST /__local__/move`
- `POST /__local__/copy`
- `POST /__local__/remove`
- `POST /__local__/createFolder`
- `POST /__local__/getContent`
- `POST /__local__/edit`
- `POST /__local__/compress`
- `POST /__local__/extract`
- `POST /__local__/upload`
- `GET /__local__/downloadFile`
- `GET /__local__/downloadMultiple`
- `GET /__local__/uploadResumeSize`

## Acceptance Criteria
- Common file workflows require fewer clicks/taps and clearer visual feedback.
- Multi-select actions are obvious and reliable.
- Users can recover from errors without losing navigation context.
- UI remains functional on desktop and mobile.
- No API contract changes required.

## Risks & Mitigation
- Risk: Tight coupling to minified third-party UI behavior.
  - Mitigation: Prefer additive custom layer + controlled overrides; avoid direct edits to vendor bundle where possible.
- Risk: Regressions in action flows.
  - Mitigation: Endpoint-by-endpoint regression checklist before finalizing.

## Next Step
Begin implementation with Phase 1 by updating `data/assets/index.html` and introducing dedicated custom CSS/JS assets.
