# CLAUDE.md

Guidance for Claude Code and other AI agents working in this repository.

## Project Overview

ezRemote Client is a PS5 homebrew C/C++ application built with the PS5 Payload SDK. The root client is now a bootstrapper that installs/launches `ezremote-server.elf` and opens the web UI; the server payload owns file management, remote clients, install flows, and API logic.

Primary targets:

- `ezremote_client.elf` from the root project.
- `ezremote-dpi.elf` from `ps5-ezremote-dpi/`.
- `ezremote-server.elf` from `ps5-ezremote-server/`.

## Repository Layout

- `source/`: minimal PS5 payload bootstrapper application that installs missing packaged files, launches `ezremote-server.elf`, verifies the required server version, and opens the web UI.
- `data/assets/`: packaged web UI assets served from `/data/homebrew/ezremote-client/assets`.
- `ps5-ezremote-dpi/`: submodule for the direct package installer payload.
- `ps5-ezremote-server/`: backend server payload that handles file operations, API logic, and serves the Web UI.
- `ps5-ezremote-server/source/clients/`: remote protocol clients (only Local, FTP, and IIS are currently preserved).
- `ps5-ezremote-server/source/ps5_api/fs.cpp`: local filesystem abstraction.
- `ps5-ezremote-server/source/server/http_server.cpp`: embedded web server and `/__local__/...` and `/api/sites` API handlers.
- `ps5-ezremote-server/source/wrapper/installer.cpp`: local, remote, split, archive, DPI, and ezRemote Server install logic.
- `build_deps.sh`, `build_deps_remaining.sh`: dependency cross-build scripts for the PS5 toolchain.

## Logging and Debugging

The application logs runtime information to separate client and server log files on the PS5.
When debugging issues (e.g. failed remote package installations), you can fetch the log via FTP using anonymous access:
- Client log path: `/data/homebrew/ezremote-client/client.log`
- Server log path: `/data/homebrew/ezremote-client/server.log`
- Example client FTP URI: `ftp://<PS5_IP>:2121/data/homebrew/ezremote-client/client.log`
- Example server FTP URI: `ftp://<PS5_IP>:2121/data/homebrew/ezremote-client/server.log`

## Build Commands

The build requires `PS5_PAYLOAD_SDK`; the devcontainer sets it to `/opt/ps5-payload-sdk`.

```bash
git submodule update --init --recursive
make deps
make build
```

Equivalent direct CMake commands:

```bash
cmake -B build -G Ninja -DCMAKE_TOOLCHAIN_FILE=$PS5_PAYLOAD_SDK/toolchain/prospero.cmake
cmake --build build
```

Other targets:

- `make clean` removes `build/`.
- `make zip` builds, copies every `build/**/*.elf` into `data/`, and zips the contents of `data/` into `ezremote_client.zip`.
- `make release VERSION=vX.YY` creates/pushes a tag and uploads `ezremote_client.zip` plus `ezremote-client.elf` with `gh` when available.
- `make deploy` builds and uploads to a hard-coded FTP target at `192.168.50.235`; do not run it unless explicitly requested and the target is correct.

## Testing And Verification

- There is no normal host-side automated test suite configured in CMake.
- Most meaningful verification requires building with the PS5 Payload SDK and testing on a jailbroken PS5.
- For C/C++ changes, run `make build` when the SDK and dependencies are available.
- For package/release checks, run `make zip` after a successful build.
- For web UI-only changes under `data/assets/`, at minimum check JavaScript/CSS syntax manually and preserve existing `/__local__/...` API contracts.
- For deployment to the PS5, always use direct `make deploy` to avoid partial or mismatched uploads. Do not manually upload individual ELF/assets or use daemon-only FTP deploy unless the user explicitly overrides this preference in the current task.
- For frontend asset deployment, use `make deploy-frontend` only when the user specifically asks to deploy just the frontend; otherwise use `make deploy` for normal PS5 deployment.

## Existing Project Rules

- **CRITICAL**: Always increase `EZREMOTE_CLIENT_DISPLAY_VERSION` in `cmake/ezremote_versions.cmake` before building, per `.agents/rules/coding.md`.
- **CRITICAL**: If any attempt fails (e.g., build failure, runtime crash, logic bug), you MUST update `EXPERIENCE.md` with the failure pattern and its solution once found.
- **CRITICAL**: Keep persistent user preferences synchronized in this file. When the user states a workflow preference that should apply beyond the current request, update `CLAUDE.md` in the same turn; for example, if the user asks to use `make build` to verify changes, record that verification preference here and follow it going forward.
- If making a packaged release, review `EZREMOTE_CLIENT_PACKAGE_VERSION` in `cmake/ezremote_versions.cmake`.
- Keep `EZREMOTE_SERVER_VERSION` and `EZREMOTE_SERVER_REQUIRED_VERSION` in `cmake/ezremote_versions.cmake` aligned when server compatibility changes.

## Development Notes

- This codebase mixes C, C++, C-style buffers, raw pointers, pthreads, STL containers, and PS5 SDK APIs. Prefer small, local changes and be careful with ownership and lifetime.
- Avoid large stack allocations in HTTP and transfer paths; PS5 runtime constraints make heap-backed buffers safer for large data.
- Large-file transfers, range requests, and PKG installs are performance-sensitive. Avoid unnecessary copies, tiny writes, and repeated open/close cycles in hot paths.
- Use existing logging via `dbglogger_log` and `dbglogger_printf` when diagnosing device-side behavior.
- The public web API convention is `{ "result": { "success": true|false, "error": ... } }`; keep this contract stable unless the caller is updated too.
- `ps5-ezremote-server/source/http/`, `source/imgui/`, and `ps5-ezremote-server/source/pugixml/` are vendored sources. Edit them only when the bug is inside the vendored code or the project already carries a local patch.
- Do not change generated/build artifacts in `build/`.
- Manage temporary files carefully to avoid orphaned data on the user's drive if an install or process crashes, as the PS5 sandboxes applications but files written to `/data` and `/mnt/usb` persist.
- When working with `cpp-httplib`, avoid byte-by-byte copies (`std::vector::insert` or `std::string::append` loops) during multipart parsing; use `memcpy`/`memmove` to prevent massive CPU bottlenecks on the PS5.
- Be vigilant about memory management, especially in asynchronous `http_server` callbacks where objects might outlive the request.
- Background worker loops (`ExtractFilesThread`, `DownloadFilesThread`, `FileOpFilesThread`) use `sleep(1)` to yield CPU time. Avoid spin-locking without sleeps in new background loops. Network accept loops (like `LegacyDpiServer`) must also use a `usleep` backoff on failure to prevent 100% CPU usage.
- `cpp-httplib` thread pool is explicitly limited via `CPPHTTPLIB_THREAD_POOL_COUNT=8` in `CMakeLists.txt` to prevent massive memory bloat (each thread consumes a large PS5 stack footprint).
- Avoid passing local stack variables to background threads without deep copying them. 
- Always ensure `json_tokener_parse` results are cleaned up with `json_object_put` on all return paths, including early error returns.

## APIs and Background Processing

The backend relies on an embedded HTTP server running on port `6701` to process API requests and spawn async jobs.
- **Synchronous vs Asynchronous APIs**: Many `/__local__/` endpoints (like `/upload`, `/compress`, `/mkdir`) perform file operations directly within the HTTP handler thread. Async endpoints like `/api/siteextract`, `/__local__/extract`, `/api/install_remote_pkg`, and `/fileop_start` validate payloads, push a job to a global queue (e.g., `bg_extract_list`), and return immediately.
- **Background Worker Threads**: Dedicated threads continuously monitor global queues. 
  - `ExtractFilesThread` spawns `ExtractSingleFileThread` for zip unarchiving.
  - `DownloadFilesThread` spawns `DownloadSingleFileThread` for remote file transfers.
  - `FileOpFilesThread` handles background move/copy/delete batches.
  - `BackgroundInstallThread` manages remote PKG installations.
- **Thread Safety (CRITICAL)**: Always use `CONFIG::LockExtractList()`, `CONFIG::LockDownloadList()`, etc. when accessing global state lists. For shared class fields (e.g., `PkgInstallUseCase::current_progress`), use `std::mutex` and `std::lock_guard` to synchronize reads and writes across HTTP and background threads.

## Remote Client Guidance

- New remote protocols should implement `RemoteClient` from `ps5-ezremote-server/source/clients/remote_client.h`.
- Reuse `BaseClient` behavior when the protocol is HTTP-like.
- Keep `SupportedActions()` accurate; the UI enables actions from these flags.
- Pay attention to URL encoding. HTTP directory clients often need server-specific parsing and escaping.
- Preserve Range behavior for PKG install flows. `Size`, `Head`, `GetRange`, `Open`, and `Close` are used by installer/proxy paths.

## Web UI Guidance

- The web UI source lives in `frontend/`; the Vite single-file build is packaged into `data/assets/index.html` and served by `source/server/http_server.cpp`.
- Keep `frontend/public/` and packaged public assets in `data/assets/` aligned for icons and `cache.appcache`.
- Keep desktop and mobile usable; touch targets and modal scrolling matter.
- Do not break existing endpoints under `/__local__/...` unless backend and frontend are changed together.
- The React UI includes sticky top bars, path breadcrumb navigation, and an action toolbar.
- The UI filters navigation to show `/data` and `/mnt` at the root, and `/mnt` only shows non-empty `usb*` and `ex*` child directories.

## Package Installer Features

- PKG installs support Direct Local Install, Disk Cache (DC) mode, and Remote Package Install (RPI) mode.
- RPI mode streams PKGs directly from a remote server without fully downloading to disk.
- DC mode downloads the PKG in chunks to a temporary location and streams it to the installer, deleting chunks dynamically to save space.

## PS5 Runtime Paths

Important paths are defined in `source/config.h`:

- App data: `/data/homebrew/ezremote-client`.
- Client ELF: `/data/homebrew/ezremote-client/ezremote_client.elf`.
- DPI payload: `/data/homebrew/ezremote-client/ezremote-dpi.elf`.
- Server payload: `/data/homebrew/ezremote-client/ezremote-server.elf`.
- Web assets: `/data/homebrew/ezremote-client/assets`.
- Default web server port: `6701`.
- Internal ezRemote Server port: `6701`.

## Safety Notes

- Treat file delete, move, package install, and background download changes as high risk.
- Do not run `make deploy` or push payloads to a PS5 without explicit confirmation.
- Do not commit or preserve local API keys, passwords, cookies, or generated logs.
- Preserve unrelated user changes in the working tree; this repository may already be dirty.
