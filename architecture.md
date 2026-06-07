# ezRemote Client Architecture & Developer Experience

## Overview

`ezRemote Client` is a C++ application built for the PS5 (PlayStation 5) via the PS5 Payload SDK. It functions as a versatile file manager and package (PKG) installer that interfaces with both the local PS5 filesystem and a wide array of remote storage protocols (FTP, SMB, NFS, WebDAV, HTTP, and various cloud hosts). 

The application is composed of a graphical user interface rendered directly on the console, a background HTTP proxy server (`ezRemote Server`) for handling asynchronous downloads/installs, and an embedded web server for browser-based remote management.

---

## Component Architecture

The project is structured into several distinct layers and modules:

### 1. Graphical User Interface (GUI)
- **ImGui & SDL2:** The interface is built using [Dear ImGui](https://github.com/ocornut/imgui) with an SDL2 backend (`source/imgui/`). It renders the dual-pane, FileZilla-style commander UI directly on the PS5.
- **Window Management (`source/windows.cpp`, `source/gui.cpp`):** Manages modal dialogs, file browsing states, progress bars, and user interactions.
- **Input & IME:** Uses native PS5 APIs (`SceImeDialog`, `ScePad`, `SceKeyboard`) for controller input and the onscreen keyboard.

### 2. File System Abstraction (`source/fs.cpp`)
Provides a unified interface for file operations on the local PS5 disk (`/data`, `/mnt/usb`, etc.). It wraps standard C file operations (`fopen`, `fread`, `fwrite`) and handles directory traversal, file copying, moving, and deletion.

### 3. Remote Protocol Clients (`source/clients/`)
A modular system for interacting with remote file servers. All clients inherit from a common interface (e.g., `BaseClient`):
- **Standard Protocols:** `ftpclient.cpp`, `smbclient.cpp` (libsmb2), `nfsclient.cpp` (libnfs), `sftpclient.cpp` (libssh2), `webdav.cpp`.
- **HTTP/Web Services:** `apache.cpp`, `iis.cpp`, `nginx.cpp`, `github.cpp` (parsing GitHub releases), `archiveorg.cpp` (Internet Archive parsing).
- **Networking Core:** Relies heavily on `libcurl` for HTTP/HTTPS/FTP transport and `mbedTLS`/`OpenSSL` for secure connections.

### 4. Cloud File Hosts (`source/filehost/`)
Specialized implementations for cloud storage providers and debrid services, handling authentication, link generation, and API communication (e.g., Google Drive, Mediafire, Real-Debrid, 1Fichier).

### 5. Package Installer (`source/installer.cpp`)
Interfaces with internal PS5 APIs (`SceAppInstUtil`) to install PS4 PKG files. It supports multiple modes:
- **Direct Local Install:** Installs from USB or internal HDD.
- **Disk Cache (DC):** Downloads the PKG in chunks to a temporary location on the PS5 and streams it to the installer, deleting chunks as it goes.
- **Remote Package Install (RPI):** Streams the PKG directly from a remote server without fully downloading it to the PS5 disk. Utilizes `split_file.cpp` to handle large PKGs and archive extraction.

### 6. Local HTTP Server (`source/server/http_server.cpp`)
Embeds a local web server running on port `6701` using `cpp-httplib`.
- **Web UI:** Serves a React-based web application (`data/assets/`) allowing users to manage files from a PC or mobile device.
- **Upload/Download:** Handles chunked multipart uploads and file downloads.
- **Proxy/Range Requests:** Acts as a bridge to stream files from remote servers to the PS5 installer, translating HTTP Range requests into appropriate `libcurl` calls.

---

## Developer Experience & Workflow

### 1. Build System & Toolchain
- **PS5 Payload SDK:** Development strictly requires the PS5 Payload SDK (`prospero-clang++`).
- **CMake & Make:** The project uses CMake, but is wrapped in a `Makefile`. Building the project simply involves running `make build`.
- **Dependency Hell Avoided:** The project depends on a massive number of third-party libraries (SDL2, libcurl, libarchive, libssh2, etc.). The author has provided `build_deps.sh` and `build_deps_remaining.sh` to cross-compile these for the PS5. You *must* run `make deps` before your first build. 

### 2. Testing and Debugging
- **On-Device Testing:** Because it relies on PS5 internal APIs (`SceAppInstUtil`, `SceSysCore`, etc.), code cannot easily be tested on a PC. Every test requires building the `.elf`, pushing the payload to a jailbroken PS5 (via `websrv`), and running it.
- **Logging (`source/dbglogger.c`):** Debugging relies heavily on text-based logging. Errors and states are written out, which developers must monitor.
- **Hardware Limitations:** The PS5 environment poses unique challenges:
  - Stack size limits can cause crashes if large buffers (e.g., in `httplib`) are allocated on the stack instead of the heap.
  - Native file I/O performance (`fwrite`/`fread`) can vary wildly depending on whether the target is the internal NVMe or an external USB drive.
  - Socket tuning (e.g., `SO_RCVBUF`, `TCP_NODELAY`) is critical for achieving good network throughput over the PS5's network stack.

### 3. Pain Points & Gotchas
- **`cpp-httplib` Bottlenecks:** The default implementation of `cpp-httplib` uses byte-by-byte copies (`std::vector::insert` or `std::string::append` loops) during multipart form parsing. On PS5 hardware, this causes massive CPU bottlenecks during web uploads (capping speeds at ~70Mbps). Optimizing hot paths with `memcpy`/`memmove` and increasing recv buffers is required for high throughput.
- **File System Permissions:** The PS5 sandboxes applications. The app runs in a context where it can read/write to `/data` and `/mnt/usb`, but care must be taken when managing temporary files to avoid orphaned data on the user's drive if an install crashes.
- **Memory Leaks & C-Style Memory:** The codebase is a mix of Modern C++ (`std::vector`, `std::shared_mutex`, lambdas) and legacy C patterns (`malloc`, `free`, raw pointers). Developers must be vigilant about memory management, especially in the asynchronous `http_server` callbacks where objects might outlive the request.

### 4. Code Organization
The codebase is generally well-organized by feature:
- Adding a new protocol means inheriting from `BaseClient` and dropping the implementation into `source/clients/`.
- Adding GUI elements means modifying `windows.cpp` using ImGui patterns.
- Changing the Web UI requires modifying the React source in `frontend/`, rebuilding it, and syncing the packaged output into `data/assets/`.
