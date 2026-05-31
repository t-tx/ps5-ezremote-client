# ezRemote Server Optimization Notes

This document records the optimization review of `ps5-ezremote-server`. No runtime code was changed as part of this review. The goal is to capture what the current implementation already does for throughput and reliability, why those choices matter on PS5, and what should be improved next.

## Scope

- Server payload startup and HTTP routes in `ps5-ezremote-server/source/main.cpp` and `ps5-ezremote-server/source/server/http_server.cpp`.
- Background download queue and persisted install/download metadata in `ps5-ezremote-server/source/config.cpp`.
- Remote protocol clients in `ps5-ezremote-server/source/clients/`.
- File I/O helpers in `ps5-ezremote-server/source/fs.cpp`.
- Local package install bridge in `ps5-ezremote-server/source/usecase/dpi_usecase.cpp` and `ps5-ezremote-server/source/server/legacy_dpi_server.cpp`.
- HTTP transport tuning in `ps5-ezremote-server/source/http/httplib.*` and `ps5-ezremote-server/CMakeLists.txt`.

## Current Data Path

ezRemote Client submits install or background-download metadata to ezRemote Server over localhost HTTP on port `6701`. For remote package installs, ezRemote Server exposes `/bg_install/<hash>` as a range-capable HTTP proxy. The PS5 installer then pulls package bytes from ezRemote Server, and ezRemote Server pulls those bytes from the original HTTP, WebDAV, FTP, SFTP, NFS, SMB, Archive.org, or filehost source.

For background downloads, ezRemote Server keeps a single worker thread that scans `bg_download_list`, downloads one active item to `<dest>.tmp`, verifies the final size when known, and renames the temp file into place when complete.

## What We Already Do

### Stream Package Bytes Instead Of Buffering Whole PKGs

- `/bg_install/(.*)` uses `httplib::Response::set_content_provider` in `source/server/http_server.cpp` so package data is generated on demand.
- Remote clients implement `GetRange(...)` and write directly into the HTTP `DataSink`.
- This avoids loading full PKG files into memory and keeps disk cache optional instead of mandatory.

Why it matters: PKGs can be many gigabytes. Streaming keeps memory use bounded and lets the PS5 installer request only the byte ranges it needs.

### Validate Installer Range Requests

- `GetRequestedRange(...)` rejects malformed, multiple, reversed, or out-of-file ranges.
- Invalid ranges return HTTP `416` and include `Content-Range` when the file size is known.
- HTTP remote range responses validate `Content-Range` and exact byte count in `BaseClient::GetRange(...)`.

Why it matters: remote package install depends on correct byte offsets. A server that ignores `Range` can silently corrupt the install stream unless we reject it.

### Use Large Transfer Buffers

- HTTP clients use a 512 KiB buffer with `CHTTPClient::SetBufferSize(524288L)`.
- FTP, SFTP, NFS, and SMB transfer loops use 1 MiB buffers.
- `cpp-httplib` receive and compression buffers are configured to 512 KiB.
- Accepted HTTP sockets are tuned with 1 MiB send and receive socket buffers.

Why it matters: large buffers reduce syscall overhead, reduce user/kernel crossings, and improve throughput for large sequential PKG reads.

### Resume Interrupted Background Downloads

- Background downloads write to `<dest>.tmp` first.
- If the temp file exists, the worker resumes from its current size.
- HTTP uses offset-aware download, FTP uses `REST`, and SMB/NFS/SFTP seek before reading.
- Completed downloads are renamed only after the size check passes when the expected size is known.

Why it matters: restarting a multi-gigabyte transfer after a network drop wastes time and bandwidth. Temp-file rename also prevents incomplete files from appearing complete.

### Keep The Console Awake During Long Transfers

- HTTP, SMB, NFS, and SFTP download loops call `sceSystemServicePowerTick()` while data is moving.

Why it matters: long transfers should not be interrupted by system idle behavior.

### Separate Foreground Install Requests From Background Downloads

- `/install` submits a package URI to `sceAppInstUtilInstallByPackage` or `sceAppInstUtilAppInstallPkg`.
- `/download_url` queues long downloads for the background worker.
- `/get_download_state` lets the client poll progress.

Why it matters: installs, queued downloads, and status polling have different lifetimes. Keeping them separate makes the control path simple.

### Preserve Compatibility With Legacy DPI Submitters

- `legacy_dpi_server.cpp` listens on port `9040` and accepts the older pipe-delimited payload format.

Why it matters: existing tools can still submit install requests while newer clients use the JSON HTTP API.

## Highest Priority Improvements

### 1. Fix Background Download Locking

`DownloadFilesThread()` calls `CONFIG::SaveBgDownloadData()` while already holding `download_mutex_` in several state transitions. `SaveBgDownloadData()` also takes `download_mutex_`. Because this is a non-recursive `std::shared_mutex`, the worker can deadlock when it tries to persist state.

Recommended fix: mutate state under the lock, release the lock, then save a snapshot outside the lock. Alternatively, split persistence into a locked snapshot function plus an unlocked file-write function.

Why it matters: a deadlocked worker stops all queued downloads and can make status appear frozen.

### 2. Build Release Payloads With Optimization Enabled

`ps5-ezremote-server/CMakeLists.txt` currently uses `-O0` for both C and C++ flags.

Recommended fix: use release flags such as `-O2` or `-O3` for normal payload builds, and keep `-O0 -gdwarf-2` only for explicit debug builds.

Why it matters: this server is mostly network, parsing, crypto, and copy loops. `-O0` leaves significant CPU performance on the table.

### 3. Verify Exact Byte Counts In All `GetRange` Implementations

HTTP validates exact byte count. SMB, NFS, SFTP, and FTP currently stream until EOF or sink failure, but can return success even if fewer bytes than requested were delivered.

Recommended fix: track `bytes_remaining` and return success only when it reaches zero. Treat early EOF as failure.

Why it matters: installer range requests must be exact. Short reads should fail fast instead of producing partial HTTP responses that look successful.

### 4. Fix JSON Object Lifetime Leaks

Several HTTP routes parse or create json-c objects without releasing them on success or early error paths, especially `/store_bg_install_data`, `/download_url`, and `/get_download_state`.

Recommended fix: call `json_object_put()` on every parsed or created object after `res.set_content(...)` has copied the response data. Use small local cleanup blocks to avoid missing early returns.

Why it matters: ezRemote Server is a background payload. Small leaks from status polling or repeated submissions accumulate over uptime.

### 5. Make Progress Updates Thread-Safe

Progress is reported through global `uint64_t *g_bytes_transfered`, which points into the active download item. Transfer callbacks update it without taking `download_mutex_`, while `/get_download_state` reads under the mutex.

Recommended fix: store progress in the download item as an atomic counter or update it through a locked helper. Avoid a global pointer and pass per-download context to callbacks.

Why it matters: current behavior is mostly safe only because downloads are serial. It becomes fragile if parallel downloads or concurrent installs are added.

## Performance Improvements

### Reduce Stack Pressure From Large Buffers

- `cpp-httplib` uses 512 KiB stack receive/compression buffers in several hot paths.
- `FtpClient::GetRange(...)` has a 1 MiB stack buffer.
- The thread pool is compiled with `CPPHTTPLIB_THREAD_POOL_COUNT=64`.

Recommended fix: move large hot-path buffers to heap-backed reusable buffers or reduce per-thread buffer sizes after benchmarking. Tune thread count against expected concurrent API requests and streaming connections.

Why it matters: high thread count multiplied by large stack buffers can consume memory quickly in a payload process.

### Handle Short Writes And Disk Errors Immediately

`FS::Write(...)` wraps one `fwrite(...)` call and many callers ignore short writes. FTP direct download checks only `fwrite(...) <= 0`, not `written != requested`.

Recommended fix: make write helpers loop until all bytes are written or a real error occurs. Abort transfers immediately on short write or disk-full conditions.

Why it matters: continuing after a disk write failure wastes network time and leaves bad temp files that may later be retried incorrectly.

### Reduce Reconnect Cost For Installer Range Streams

Each `/bg_install/<hash>` request creates a new remote client, connects, streams the requested range, then disconnects.

Recommended fix: benchmark connection reuse per install stream or per host for protocols where it is safe. Add strict idle timeouts and cleanup if session caching is introduced.

Why it matters: installers may issue many range requests. Reconnecting is especially expensive for SFTP, SMB, and authenticated HTTP sources.

### Improve Background Queue Scheduling

The download worker scans for one active item, processes it synchronously, then sleeps one second.

Recommended fix: replace polling sleep with a condition variable or event signal when a new item is queued. Consider bounded parallel downloads, for example 2 active transfers, only after progress state and disk write handling are made thread-safe.

Why it matters: serial downloads are safe but slow for multiple queued items, and the sleep adds avoidable latency.

### Tune FTP Progress Callback Granularity

FTP background downloads set `SetCallbackBytes(1)`, which causes the callback to run on every read chunk.

Recommended fix: update progress on a larger byte threshold, such as 256 KiB or 1 MiB, or on a time interval.

Why it matters: progress does not need to update as often as data is read. Lower callback frequency reduces overhead and lock pressure after progress is made thread-safe.

### Remove Fixed SFTP Handshake Delay

`SFTPClient::Connect(...)` sleeps for 100 ms before `libssh2_session_handshake(...)` and uses blocking mode.

Recommended fix: replace the fixed delay with readiness/timeout handling. Consider non-blocking libssh2 only if the calling code is ready for retry loops.

Why it matters: fixed sleeps add latency to every SFTP connection and become more visible when installers make many range requests.

### Avoid Regex For Simple WebDAV Scheme Conversion

`WebDAVClient::GetHttpUrl(...)` uses regex replacement for `webdav://` and `webdavs://` scheme conversion.

Recommended fix: replace with prefix checks and string replacement.

Why it matters: this is not a major bottleneck, but it is a simple low-risk cleanup in connection setup.

## Reliability Improvements

### Lock Package Install History Reads

`CONFIG::GetPackageInstallHostData(...)` reads the global package install map without taking `pkg_mutex_` and returns an internal pointer.

Recommended fix: return a copied `PackageInstallData` under a shared lock, or keep the lock held while copying the values needed by `/bg_install`.

Why it matters: the install proxy can race with history updates or retention cleanup.

### Save State Less Often And More Safely

Package install history and background download history rewrite the full JSON file on every save.

Recommended fix: save only at important state transitions, write to a temporary file, then rename atomically. Keep full rewrite while lists are small, but avoid calling it while holding hot locks.

Why it matters: full rewrites are simple, but they become slow as history grows and can leave corrupt state if interrupted mid-write.

### Tighten FTP Error Handling

The FTP client defaults to passive mode, which is the right default for most networks, and still contains active `PORT` mode support. Some active-mode code has fragile timeout behavior and should not become the default without testing.

Recommended fix: keep passive mode as default. If active mode remains, audit its accept/timeout path and socket error checks before exposing it as a performance option.

Why it matters: FTP behavior varies widely across servers and network setups. Bad fallback behavior can look like a performance problem when it is actually a blocked data connection.

### Make Install Routes Asynchronous If Needed

`/install` and the legacy DPI server call `DpiUseCase::InstallPackage(...)` synchronously in their request/accept handlers.

Recommended fix: if installs block for long periods on target firmware, enqueue install jobs and return an accepted status quickly.

Why it matters: synchronous install calls can occupy HTTP workers or block the legacy server loop.

## Suggested Order Of Work

1. Fix `SaveBgDownloadData()` nested locking in the download worker.
2. Enable optimized release builds for `ezremote-server.elf`.
3. Require exact byte counts in SMB, NFS, SFTP, and FTP `GetRange(...)`.
4. Fix json-c cleanup in HTTP routes.
5. Replace `g_bytes_transfered` with per-download atomic or locked progress state.
6. Add robust short-write handling in file transfer paths.
7. Move large stack buffers to heap/reusable buffers and benchmark thread-pool size.
8. Replace download polling sleep with queue signaling.
9. Benchmark connection reuse for `/bg_install` range streams.
10. Tune protocol-specific details: FTP callback threshold, SFTP handshake delay, WebDAV scheme conversion.

## Benchmark Checklist

- Direct HTTP install from a LAN server with large PKG and range requests.
- HTTP server that ignores `Range`, to confirm failure is explicit.
- FTP, SFTP, SMB, and NFS background downloads with resume from an existing `.tmp` file.
- Disk-full or write-failure behavior during background download.
- Repeated `/get_download_state` polling for leak checks.
- Multiple queued background downloads.
- Thread-pool sizes such as 8, 16, 32, and 64 under concurrent install proxy plus status polling.
- Debug build versus optimized release build throughput.

## Rule Of Thumb

For this server, the fastest path is usually not lower-level syscalls. The fastest path is fewer copies, fewer reconnects, fewer blocking waits, exact range streaming, large but bounded buffers, and predictable cleanup on failure.
