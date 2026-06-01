# CLAUDE.md

Guidance for Claude Code and other AI agents working in this repository.

## Project Overview

ezRemote Client is a PS5 homebrew C/C++ application built with the PS5 Payload SDK. It provides a FileZilla-style ImGui/SDL2 file manager, remote protocol clients, PS4 PKG install flows, an embedded web UI, and bundled background payloads.

Primary targets:

- `ezremote_client.elf` from the root project.
- `ezremote-dpi.elf` from `ps5-ezremote-dpi/`.
- `ezremote-server.elf` from `ps5-ezremote-server/`.

## Repository Layout

- `source/`: main PS5 client application.
- `source/clients/`: remote protocol and HTTP directory-listing clients implementing `RemoteClient`.
- `source/filehost/`: file host and debrid integrations.
- `source/server/http_server.cpp`: embedded web server and `/__local__/...` API handlers.
- `source/windows.cpp`, `source/gui.cpp`, `source/actions.cpp`: ImGui UI and action dispatch.
- `source/installer.cpp`: local, remote, split, archive, DPI, and ezRemote Server install logic.
- `source/fs.cpp`: local filesystem abstraction.
- `data/assets/`: packaged web UI assets served from `/data/homebrew/ezremote-client/assets`.
- `ps5-ezremote-dpi/`: submodule for the direct package installer payload.
- `ps5-ezremote-server/`: submodule for the background install/download server payload.
- `build_deps.sh`, `build_deps_remaining.sh`: dependency cross-build scripts for the PS5 toolchain.

## Logging and Debugging

The application logs runtime information to a debug log file on the PS5.
When debugging issues (e.g. failed remote package installations), you can fetch the log via FTP using anonymous access:
- Log path: `/data/homebrew/ezremote-client/debug.log`
- Example FTP URI: `ftp://<PS5_IP>:2121/data/homebrew/ezremote-client/debug.log`

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
cmake --build build --target package
```

Other targets:

- `make clean` removes `build/`.
- `make deploy` builds and uploads to a hard-coded FTP target at `192.168.50.235`; do not run it unless explicitly requested and the target is correct.

## Testing And Verification

- There is no normal host-side automated test suite configured in CMake.
- Most meaningful verification requires building with the PS5 Payload SDK and testing on a jailbroken PS5.
- For C/C++ changes, run `make build` when the SDK and dependencies are available.
- For package/release checks, run `cmake --build build --target package` after a successful build.
- For web UI-only changes under `data/assets/`, at minimum check JavaScript/CSS syntax manually and preserve existing `/__local__/...` API contracts.

## Existing Project Rules

- **CRITICAL**: Always increase the app version in `source/windows.cpp` `ConnectionPanel()` before building, per `.agents/rules/coding.md`.
- **CRITICAL**: If any attempt fails (e.g., build failure, runtime crash, logic bug), you MUST update `EXPERIENCE.md` with the failure pattern and its solution once found.
- **CRITICAL**: Keep persistent user preferences synchronized in this file. When the user states a workflow preference that should apply beyond the current request, update `CLAUDE.md` in the same turn; for example, if the user asks to use `make build` to verify changes, record that verification preference here and follow it going forward.
- If making a packaged release, also review `APP_VERSION` in the root `CMakeLists.txt` and `EZREMOTE_SERVER_REQUIRED_VERSION` in `source/config.h` when server compatibility changes.
- Keep `ps5-ezremote-server/CMakeLists.txt` `APP_VERSION` aligned with client compatibility requirements when editing the server payload.

## Development Notes

- This codebase mixes C, C++, C-style buffers, raw pointers, pthreads, STL containers, and PS5 SDK APIs. Prefer small, local changes and be careful with ownership and lifetime.
- Avoid large stack allocations in HTTP and transfer paths; PS5 runtime constraints make heap-backed buffers safer for large data.
- Large-file transfers, range requests, and PKG installs are performance-sensitive. Avoid unnecessary copies, tiny writes, and repeated open/close cycles in hot paths.
- Use existing logging via `dbglogger_log` and `dbglogger_printf` when diagnosing device-side behavior.
- The public web API convention is `{ "result": { "success": true|false, "error": ... } }`; keep this contract stable unless the caller is updated too.
- `source/http/`, `source/imgui/`, and `source/pugixml/` are vendored sources. Edit them only when the bug is inside the vendored code or the project already carries a local patch.
- Do not change generated/build artifacts in `build/`.
- Manage temporary files carefully to avoid orphaned data on the user's drive if an install or process crashes, as the PS5 sandboxes applications but files written to `/data` and `/mnt/usb` persist.
- When working with `cpp-httplib`, avoid byte-by-byte copies (`std::vector::insert` or `std::string::append` loops) during multipart parsing; use `memcpy`/`memmove` to prevent massive CPU bottlenecks on the PS5.
- Be vigilant about memory management, especially in asynchronous `http_server` callbacks where objects might outlive the request.

## Remote Client Guidance

- New remote protocols should implement `RemoteClient` from `source/clients/remote_client.h`.
- Reuse `BaseClient` behavior when the protocol is HTTP-like.
- Keep `SupportedActions()` accurate; the UI enables actions from these flags.
- Pay attention to URL encoding. HTTP directory clients often need server-specific parsing and escaping.
- Preserve Range behavior for PKG install flows. `Size`, `Head`, `GetRange`, `Open`, and `Close` are used by installer/proxy paths.

## Web UI Guidance

- The web UI is packaged from `data/assets/` and served by `source/server/http_server.cpp`.
- `data/assets/index.html` configures Angular FileManager endpoints.
- `data/assets/res/ezremote-ui.js` and `ezremote-ui.css` are additive UX layers over the existing Angular file manager.
- Keep desktop and mobile usable; touch targets and modal scrolling matter.
- Do not break existing endpoints under `/__local__/...` unless backend and frontend are changed together.
- Note that a dedicated ezRemote UI layer exists that includes sticky top bars, path breadcrumb navigation, and an action toolbar.
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
- Default web server port: `9090`.
- Internal ezRemote Server port: `6701`.

## Safety Notes

- Treat file delete, move, package install, and background download changes as high risk.
- Do not run `make deploy` or push payloads to a PS5 without explicit confirmation.
- Do not commit or preserve local API keys, passwords, cookies, or generated logs.
- Preserve unrelated user changes in the working tree; this repository may already be dirty.
