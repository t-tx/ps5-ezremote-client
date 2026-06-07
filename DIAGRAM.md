# ezRemote Architecture Diagram

The following Mermaid diagram outlines the high-level architecture, showing the interaction between the React frontend, the embedded HTTP server APIs, background tasks, and core sub-systems.

```mermaid
graph TD
    %% Frontend Layer
    subgraph Frontend ["Frontend (React SPA)"]
        UI["Web UI\n(Browser)"]
    end

    %% API Layer
    subgraph APILayer ["API Router & Servers (http_server.cpp, legacy_dpi_server.cpp)"]
        SyncAPI["Synchronous APIs\n(/upload, /compress, /mkdir, /sitelist)"]
        AsyncAPI["Asynchronous APIs\n(/extract_url, /fileop_start, /api/install_remote_pkg)"]
        StatusAPI["Status APIs\n(/get_download_state, /api/get_install_progress)"]
        LegacyDpiAPI["Legacy DPI Server\n(Port 9040)"]
    end

    %% State / Config Management
    subgraph ConfigLayer ["Configuration & State Management (CONFIG)"]
        ConfigStorage[("config.xml")]
        ExtractQueue["bg_extract_list\n(Mutex Protected)"]
        DownloadQueue["bg_download_list\n(Mutex Protected)"]
        FileOpQueue["bg_fileop_list\n(Mutex Protected)"]
        InstallProg["InstallProgress\n(Mutex Protected)"]
    end

    %% Background Thread Layer
    subgraph WorkerLayer ["Background Workers"]
        ThreadEx["ExtractFilesThread"]
        ThreadDl["DownloadFilesThread"]
        ThreadOp["FileOpFilesThread"]
        ThreadInst["BackgroundInstallThread"]
    end

    %% Sub-Systems
    subgraph SubSystems ["Core Sub-Systems"]
        FSSys["Filesystem API\n(fs.cpp)"]
        ZipSys["Zip Utility\n(zip_util.cpp)"]
        NetSys["Remote Clients\n(FTP, IIS, Local)"]
        PkgSys["Installer API\n(installer_api.cpp / sceAppInstUtil)"]
    end

    %% Connections
    UI <-->|HTTP Requests| APILayer

    %% Sync API Flow
    SyncAPI --> FSSys
    SyncAPI --> ZipSys
    SyncAPI --> NetSys

    %% Async API Enqueue Flow
    AsyncAPI -->|Enqueue Job| ExtractQueue
    AsyncAPI -->|Enqueue Job| DownloadQueue
    AsyncAPI -->|Enqueue Job| FileOpQueue

    %% Install Flow
    AsyncAPI -->|Start Thread| ThreadInst
    ThreadInst -->|Update Progress| InstallProg
    StatusAPI -->|Read Progress| InstallProg

    %% Worker Threads consuming queues
    ExtractQueue -.->|Consumed by| ThreadEx
    DownloadQueue -.->|Consumed by| ThreadDl
    FileOpQueue -.->|Consumed by| ThreadOp

    %% Worker actions
    ThreadEx --> ZipSys
    ThreadEx --> FSSys
    ThreadDl --> NetSys
    ThreadDl --> FSSys
    ThreadOp --> FSSys
    ThreadInst --> PkgSys
    ThreadInst --> NetSys

    %% State persistence
    ConfigLayer -.->|Save/Load| ConfigStorage
```

## Description of Layers

1. **Frontend**: The React Single Page Application loaded by the client browser. It sends HTTP JSON payloads to the backend API endpoints.
2. **API Router**: The embedded C++ `cpp-httplib` server listening on port `6701`. It handles requests, parses JSON via `json-c`, and routes to the appropriate C++ handler.
    - **Synchronous APIs** execute directly within the HTTP handler thread, blocking the client until complete.
    - **Asynchronous APIs** validate input and quickly enqueue jobs into background state lists, returning immediately.
3. **Configuration & State Management**: Globally accessible lists (`CONFIG` namespace) that track active downloads, extractions, and file operations. They use strict `std::mutex` locking to prevent data races. `InstallProgress` is managed by `PkgInstallUseCase` with its own lock.
4. **Background Workers**: Persistent POSIX threads (`pthreads`) that poll the queues (`sleep(1)` loop) or are spawned ad-hoc. They delegate intensive I/O to sub-systems.
5. **Core Sub-Systems**: Low-level modules wrapping the PS5 SDK, POSIX file I/O, `libarchive`/`minizip`, and network clients (`CURL`).
