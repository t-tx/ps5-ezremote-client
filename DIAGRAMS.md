# ezRemote Client Diagrams

This document summarizes the repository structure and runtime behavior using Mermaid diagrams. It was created from a scan of the native PS5 client, embedded web UI, remote protocol clients, installer flows, local HTTP server, and bundled payload subprojects.

## 1. Repository Map

```mermaid
flowchart TB
    Repo["/workspace"]
    Repo --> RootBuild["Root build files\nCMakeLists.txt, Makefile"]
    Repo --> Source["source/\nmain native client"]
    Repo --> Data["data/\npackaged app data"]
    Repo --> WebAssets["data/assets/\nReact web UI, languages, fonts, certs"]
    Repo --> ServerPayload["ps5-ezremote-server/\nbackground install/download server"]
    Repo --> DpiPayload["ps5-ezremote-dpi/\nlegacy direct installer payload"]
    Repo --> Docs["README.md, architecture.md, IMPLEMENTATION.md, PLAN.md, EXPERIENCE.md"]

    Source --> Clients["source/clients/\nRemoteClient implementations"]
    Source --> FileHosts["source/filehost/\nshare link resolvers"]
    Source --> ClientServer["source/server/\nembedded HTTP server"]
    Source --> UI["source/gui.cpp\nsource/windows.cpp"]
    Source --> Actions["source/actions.cpp\nfile operations and async jobs"]
    Source --> Installer["source/installer.cpp\nPKG install orchestration"]
    Source --> LocalFS["source/fs.cpp\nlocal filesystem wrapper"]
    Source --> Archive["source/zip_util.cpp\nsource/split_file.cpp"]
    Source --> Config["source/config.cpp\nsettings and paths"]
    Source --> Vendors["source/imgui, source/http, source/pugixml\nvendored support code"]
```

## 2. Build And Package Graph

```mermaid
flowchart LR
    SDK["PS5 Payload SDK\nPS5_PAYLOAD_SDK"] --> MakeDeps["make deps\nbuild_deps.sh\nbuild_deps_remaining.sh"]
    SDK --> MakeBuild["make build"]
    MakeBuild --> CMakeConfigure["cmake -B build -G Ninja\nprospero toolchain"]
    CMakeConfigure --> RootTarget["ezremote_client.elf"]
    CMakeConfigure --> ServerTarget["ps5-ezremote-server\nezremote-server.elf"]

    RootTarget --> ReleaseTarget["make release VERSION=vX.YY"]
    ServerTarget --> ReleaseTarget
    DataFiles["data/*"] --> ReleaseTarget
    ReleaseTarget --> CopyElf["copy build/**/*.elf into data/"]
    CopyElf --> DataZip["ezremote_client.zip\ncontents of data/"]
    RootTarget --> ClientElf["ezremote-client.elf\nseparate release asset"]

    DpiSubproject["ps5-ezremote-dpi\nezremote-dpi.elf"] -.->|separate subproject| SDK
    DpiSubproject -.->|copied if present under build/| CopyElf
```

## 3. Native Client Runtime Architecture

```mermaid
flowchart TB
    User["PS5 user\ncontroller and keyboard"] --> ImGui["ImGui SDL2 UI\nsource/gui.cpp, source/windows.cpp"]
    ImGui --> ActionDispatch["selected_action\nWindows::ExecuteActions"]
    ActionDispatch --> Actions["Actions namespace\nsource/actions.cpp"]

    Actions --> LocalFS["FS namespace\nlocal /data and /mnt operations"]
    Actions --> RemoteClient["RemoteClient* remoteclient\nprotocol abstraction"]
    Actions --> Installer["INSTALLER namespace\nPKG install flows"]
    Actions --> ZipUtil["ZipUtil and SplitFile\narchive and disk cache flows"]

    Browser["PC or mobile browser"] --> ClientHttp["ezremote_client embedded HTTP server\nport 9090"]
    ClientHttp --> LocalFS
    ClientHttp --> Installer
    ClientHttp --> RemoteClientPool["pooled RemoteClient instances\n/rmt_inst streaming"]
    ClientHttp --> WebAssets["/data/homebrew/ezremote-client/assets"]

    Installer --> ServerPayload["ezremote-server.elf\nHTTP port 6701"]
    ServerPayload --> DpiUseCase["DpiUseCase\nSceAppInstUtil"]
    ServerPayload --> BgDownloads["background download worker"]
    ServerPayload --> BgInstallProxy["/bg_install/{hash}\nrange proxy"]
```

## 4. Application Startup Sequence

```mermaid
sequenceDiagram
    participant Main as main.cpp
    participant SDL as SDL2
    participant Net as SceNet
    participant Config as CONFIG
    participant Http as HttpServer
    participant Installer as INSTALLER
    participant UI as GUI

    Main->>Main: dbglogger_init_str
    Main->>SDL: SDL_Init
    Main->>Net: sceNetInit
    Main->>Net: sceNetPoolCreate
    Main->>Config: LoadConfig
    Main->>Http: Start port 9090
    Main->>Installer: StartEzRemoteServer
    Main->>SDL: CreateWindow and CreateRenderer
    Main->>Main: Textures::Init
    Main->>Main: InitImgui
    Main->>UI: RenderLoop(renderer)
    UI-->>Main: returns on exit
    Main->>SDL: DestroyRenderer and DestroyWindow
    Main->>Main: Textures::Exit
    Main->>Main: ImGui::DestroyContext
```

## 5. Main Render Loop

```mermaid
stateDiagram-v2
    [*] --> InitWindows
    InitWindows --> BrowserMode

    BrowserMode --> PollEvents: every frame
    PollEvents --> NewFrame
    NewFrame --> LockFilesMutex
    LockFilesMutex --> HandleWindowInput
    HandleWindowInput --> MainWindow
    MainWindow --> ExecuteActions
    ExecuteActions --> RenderPresent
    RenderPresent --> BrowserMode: done is false
    RenderPresent --> Shutdown: done is true

    BrowserMode --> ImeMode: gui_mode is IME
    ImeMode --> HandleImeInput
    HandleImeInput --> BrowserMode: input accepted or cancelled

    Shutdown --> [*]
```

## 6. UI Action Dispatch

```mermaid
flowchart TB
    Input["ImGui widgets\ncontroller shortcuts\nIME callbacks"] --> SelectedAction["selected_action"]
    SelectedAction --> Execute["Windows::ExecuteActions"]

    Execute --> Immediate["Immediate UI actions\nselect, navigate, connect dialogs"]
    Execute --> Async["Worker thread actions\nupload, download, delete, install, zip"]
    Execute --> Ime["IME text actions\nrename, new folder, settings fields"]

    Async --> Globals["shared progress globals\nactivity_message, bytes_transfered, stop_activity"]
    Globals --> Progress["Progress dialogs\nstatus bar updates"]

    Immediate --> State["local_directory\nremote_directory\nselected files"]
    Ime --> State
    Async --> Refresh["ACTION_REFRESH_LOCAL_FILES\nACTION_REFRESH_REMOTE_FILES"]
    Refresh --> State
```

## 7. Remote Client Class Model

```mermaid
classDiagram
    class RemoteClient {
        <<interface>>
        +Connect(url, username, password)
        +ListDir(path)
        +Get(outputfile, path)
        +Put(inputfile, path)
        +Head(path, buffer, len)
        +GetRange(path, sink, size, offset)
        +Open(path, flags)
        +Close(fp)
        +SupportedActions()
    }

    class BaseClient {
        +Connect()
        +Size()
        +Head()
        +GetRange()
    }

    class WebDAVClient {
        +PropFind()
        +Put()
        +Delete()
        +Mkdir()
        +Move()
        +Copy()
    }

    class FtpClient
    class SFTPClient
    class SmbClient
    class NfsClient
    class ApacheClient
    class NginxClient
    class IISClient
    class NpxServeClient
    class RCloneClient
    class ArchiveOrgClient
    class MyrientClient
    class GithubClient

    RemoteClient <|-- BaseClient
    RemoteClient <|-- FtpClient
    RemoteClient <|-- SFTPClient
    RemoteClient <|-- SmbClient
    RemoteClient <|-- NfsClient
    BaseClient <|-- WebDAVClient
    BaseClient <|-- ApacheClient
    BaseClient <|-- NginxClient
    BaseClient <|-- IISClient
    BaseClient <|-- NpxServeClient
    BaseClient <|-- RCloneClient
    BaseClient <|-- ArchiveOrgClient
    BaseClient <|-- MyrientClient
    BaseClient <|-- GithubClient
```

## 8. Remote Connection Selection

```mermaid
flowchart TB
    Settings["RemoteSettings\nserver URL, type, HTTP server type"] --> Connect["Actions::Connect\nINSTALLER::GetRemoteClient"]
    Connect --> TypeDecision{"ClientType"}

    TypeDecision -->|"ftp://"| FTP["FtpClient"]
    TypeDecision -->|"sftp://"| SFTP["SFTPClient"]
    TypeDecision -->|"smb://"| SMB["SmbClient"]
    TypeDecision -->|"nfs://"| NFS["NfsClient"]
    TypeDecision -->|"webdav:// or webdavs://"| WebDAV["WebDAVClient"]
    TypeDecision -->|"http:// or https://"| HttpType{"HTTP server type"}

    HttpType --> Apache["ApacheClient"]
    HttpType --> IIS["IISClient"]
    HttpType --> Nginx["NginxClient"]
    HttpType --> Serve["NpxServeClient"]
    HttpType --> RClone["RCloneClient"]
    HttpType --> ArchiveOrg["ArchiveOrgClient"]
    HttpType --> Myrient["MyrientClient"]
    HttpType --> Github["GithubClient"]

    FTP --> Uniform["RemoteClient interface"]
    SFTP --> Uniform
    SMB --> Uniform
    NFS --> Uniform
    WebDAV --> Uniform
    Apache --> Uniform
    IIS --> Uniform
    Nginx --> Uniform
    Serve --> Uniform
    RClone --> Uniform
    ArchiveOrg --> Uniform
    Myrient --> Uniform
    Github --> Uniform
```

## 9. Remote Capability Families

```mermaid
flowchart LR
    ReadOnly["HTTP listing clients\nApache, Nginx, IIS, Serve, RClone, Archive.org, Myrient, GitHub"] --> ROActions["download\ninstall\nextract"]
    WebDAV["WebDAV"] --> WebDAVActions["download and upload\nmkdir and delete\nrename, move, copy\ninstall and extract"]
    FTP["FTP"] --> FTPActions["download and upload\nmkdir and delete\nrename\ninstall and extract"]
    Native["SFTP, SMB, NFS"] --> NativeActions["download and upload\nmkdir and delete\nrename\nraw-read range handles\ninstall and extract"]

    ROActions --> InstallerUse["installer can stream with path-based Range"]
    WebDAVActions --> InstallerUse
    FTPActions --> InstallerUse
    NativeActions --> RawRead["installer can keep remote handle open\nOpen, GetRange(fp), Close"]
```

## 10. Filehost URL Resolution

```mermaid
flowchart TB
    Url["User-entered URL\ninstall_url or download_url"] --> Factory["FileHost::getFileHost"]
    Factory --> DebridChoice{"Debrid override enabled?"}
    DebridChoice -->|"AllDebrid"| AllDebrid["AllDebridHost"]
    DebridChoice -->|"Real-Debrid"| RealDebrid["RealDebridHost"]
    DebridChoice -->|"No"| Pattern{"URL pattern"}

    Pattern -->|"Google Drive"| GDrive["GDriveHost"]
    Pattern -->|"MediaFire"| MediaFire["MediaFireHost"]
    Pattern -->|"PixelDrain"| PixelDrain["PixelDrainHost"]
    Pattern -->|"fallback"| Direct["DirectHost"]

    AllDebrid --> DownloadUrl["direct download URL"]
    RealDebrid --> DownloadUrl
    GDrive --> DownloadUrl
    MediaFire --> DownloadUrl
    PixelDrain --> DownloadUrl
    Direct --> DownloadUrl

    DownloadUrl --> Cache["hash to URL cache"]
    DownloadUrl --> BaseClient["BaseClient\nSize, Head, GetRange, Get"]
```

## 11. Embedded Client HTTP Server

```mermaid
flowchart TB
    ClientServer["source/server/http_server.cpp\ncpp-httplib server on port 9090"]

    ClientServer --> Static["Static routes\n/, /index.html, /favicon.ico, /debug/log, /game-icons"]
    ClientServer --> FileApi["Local file manager API\n/__local__/list, rename, move, copy, remove, edit, getContent, createFolder"]
    ClientServer --> TransferApi["Transfer API\n/__local__/upload, uploadResumeSize, downloadFile, downloadMultiple"]
    ClientServer --> ArchiveApi["Archive API\n/__local__/compress, /__local__/extract"]
    ClientServer --> InstallApi["Install API\n/__local__/install, /__local__/install_url"]
    ClientServer --> DownloadApi["Background download API\n/__local__/download_url"]
    ClientServer --> ProxyApi["Installer stream APIs\n/rmt_inst/Site n/path\n/archive_inst/hash\n/split_inst/hash"]
    ClientServer --> Diagnostics["Diagnostics\n/speedtest, /speedtest_multipart, /stop"]

    FileApi --> FS["FS namespace"]
    TransferApi --> FS
    ArchiveApi --> ZipUtil["ZipUtil"]
    InstallApi --> Installer["INSTALLER namespace"]
    DownloadApi --> ServerPayload["ezremote-server port 6701"]
    ProxyApi --> RemoteClients["RemoteClient pool or SplitFile"]
```

## 12. Browser Web UI Flow

```mermaid
sequenceDiagram
    participant Browser as Browser
    participant ClientHttp as ezremote_client HTTP 9090
    participant Assets as Packaged assets
    participant React as React Web UI
    participant FS as Local FS
    participant Installer as Installer helpers
    participant Server as ezremote-server 6701

    Browser->>ClientHttp: GET /
    ClientHttp-->>Browser: redirect /index.html
    Browser->>ClientHttp: GET /index.html
    ClientHttp->>Assets: read assets/index.html
    ClientHttp-->>Browser: React app shell
    Browser->>ClientHttp: GET public icons/appcache as needed
    Browser->>React: start single-file React app
    React->>ClientHttp: POST /__local__/list
    ClientHttp->>FS: ListDir
    FS-->>ClientHttp: entries
    ClientHttp-->>React: file manager JSON
    React->>ClientHttp: file action endpoint
    ClientHttp->>FS: local operation
    ClientHttp->>Installer: optional install operation
    Installer->>Server: optional POST /install or /download_url
```

## 13. Web Chunk Upload Flow

```mermaid
sequenceDiagram
    participant Browser as Browser React UI
    participant ClientHttp as Client HTTP 9090
    participant FS as FS namespace

    Browser->>ClientHttp: GET /__local__/uploadResumeSize?destination&filename
    ClientHttp->>FS: GetSize existing partial file
    ClientHttp-->>Browser: { size }

    loop for each upload chunk
        Browser->>ClientHttp: POST /__local__/upload multipart chunk
        ClientHttp->>FS: OpenRW or Append
        ClientHttp->>FS: Write chunk bytes
        ClientHttp->>FS: Close
        ClientHttp-->>Browser: success JSON
    end

    Browser->>ClientHttp: optional POST /__local__/install
    ClientHttp-->>Browser: install result JSON
```

## 14. Local File Operation Flow

```mermaid
flowchart TB
    Source["ImGui action or Web API request"] --> Operation{"Operation"}

    Operation -->|"list"| List["FS::ListDir"]
    Operation -->|"copy"| Copy["FS::Copy\nrecursive helper for directories"]
    Operation -->|"move"| Move["FS::Move\nrename or copy plus remove fallback"]
    Operation -->|"delete"| Delete["FS::Rm or FS::RmRecursive"]
    Operation -->|"mkdir"| Mkdir["FS::MkDirs"]
    Operation -->|"edit"| Edit["FS::LoadText and FS::SaveText"]
    Operation -->|"zip"| Zip["ZipUtil::ZipAddPath"]
    Operation -->|"extract"| Extract["ZipUtil::Extract"]

    List --> RootFilter["Special root behavior\nshow /data and non-empty /mnt children"]
    Copy --> Progress["bytes_to_download\nbytes_transfered"]
    Move --> Progress
    Zip --> Progress
    Extract --> Progress
```

## 15. Local PKG Install Flow

```mermaid
flowchart TB
    Start["Local .pkg selected\nImGui or Web UI"] --> Head["FS::Head reads pkg_header"]
    Head --> InstallLocal["INSTALLER::InstallLocalPkg"]
    InstallLocal --> PathCheck{"Allowed path?\n/data, /user/data, /mnt/usb"}
    PathCheck -->|"No"| Fail["return install error"]
    PathCheck -->|"Yes"| Metadata["Extract title, content_id, icon\nSFO and ICON0.PNG"]
    Metadata --> Uri["Build installer URI\nremap /data to /user/data when needed"]
    Uri --> Log["Log metadata"]
    Log --> Direct["InstallWithDirectPackageInstaller"]
    Direct --> Server["POST localhost:6701/install"]
    Server --> Sce["ezremote-server DpiUseCase\nSceAppInstUtil"]
    Sce --> Cleanup{"remove_after_install?"}
    Cleanup -->|"Yes"| Poll["poll install status\nremove temporary PKG"]
    Cleanup -->|"No"| Done["done"]
    Poll --> Done
```

## 16. Remote PKG Install Decision Tree

```mermaid
flowchart TB
    RemotePkg["Remote .pkg selected"] --> Head["remoteclient->Head reads pkg_header"]
    Head --> PkgType{"Package type"}

    PkgType -->|"PS5 PKG"| LocalDownload["DownloadAndInstallPkg\ntemp_folder/tick.pkg"]
    PkgType -->|"PS4 PKG"| RpiEnabled{"RPI enabled?"}

    RpiEnabled -->|"No"| LocalDownload
    RpiEnabled -->|"Yes"| DiskCache{"Disk cache enabled?"}
    DiskCache -->|"No"| DirectRpi["getRemoteUrl\nInstallRemotePkg"]
    DiskCache -->|"Yes"| SplitRpi["DownloadSplitPkg writer\nInstallSplitPkg reader"]

    LocalDownload --> InstallLocal["InstallLocalPkg\nremove temp after install"]
    DirectRpi --> ServerInstall["POST localhost:6701/install\nURL may be /bg_install/hash"]
    SplitRpi --> ClientStream["client HTTP /split_inst/hash\nstream SplitFile chunks"]
    ClientStream --> ServerInstall
```

## 17. Remote Package Install With Background Proxy

```mermaid
sequenceDiagram
    participant UI as Client UI or action thread
    participant Installer as INSTALLER
    participant Server as ezremote-server 6701
    participant PSInstaller as PS5 package installer
    participant Remote as Remote server

    UI->>Installer: Install remote PS4 PKG with RPI
    Installer->>Installer: getRemoteUrl(path)
    alt Direct URL can be used
        Installer-->>UI: http or https URL
    else Needs background proxy
        Installer->>Server: POST /store_bg_install_data
        Server-->>Installer: http://PS5:6701/bg_install/{hash}
    end
    Installer->>Server: POST /install with URL and metadata
    Server->>PSInstaller: sceAppInstUtilInstallByPackage
    PSInstaller->>Server: GET /bg_install/{hash} with Range
    Server->>Remote: GetRange using stored host data
    Remote-->>Server: package bytes
    Server-->>PSInstaller: 206 Partial Content
```

## 18. Disk Cache SplitFile Flow

```mermaid
flowchart LR
    Remote["Remote PKG"] --> Writer["DownloadSplitPkg thread\nremote_client->Get(split_file, path)"]
    Writer --> SplitFile["SplitFile\n5 MiB block files"]
    SplitFile --> Blocks["temp_folder/tick.pkg.0\ntemp_folder/tick.pkg.1\n..."]
    Blocks --> Reader["HTTP /split_inst/{hash}\ncontent provider"]
    Reader --> ServerInstall["ezremote-server /install\nPS5 installer reads URL"]
    Reader --> CleanupOld["old blocks deleted\nafter read advances"]
    ServerInstall --> Cleanup["CleanSplitPkgDataThread\njoin writer and remove chunks"]
```

## 19. Archive PKG Install Flow

```mermaid
flowchart TB
    ArchiveFile["Local or remote archive\nzip, 7z, rar"] --> Scan["ZipUtil::GetPackageEntry"]
    Scan --> Entry{"first safe .pkg entry found?"}
    Entry -->|"No"| Fail["show unsupported or missing package error"]
    Entry -->|"Yes"| Data["ArchivePkgInstallData\narchive handle + SplitFile"]
    Data --> ExtractThread["ExtractArchivePkg thread\narchive_read_data"]
    ExtractThread --> Split["SplitFile\n10 MiB chunks"]
    Split --> LocalHttp["client HTTP /archive_inst/{hash}"]
    LocalHttp --> Install["POST localhost:6701/install\nURL points at /archive_inst/hash"]
    Install --> Cleanup["CleanArchivePkgDataThread\nstop writer, close split file, delete data"]
```

## 20. SplitFile Producer Consumer Lifecycle

```mermaid
sequenceDiagram
    participant Producer as Writer thread
    participant Split as SplitFile
    participant Consumer as HTTP content provider
    participant Disk as Temp block files

    Producer->>Split: Open
    Split->>Disk: create block 0
    loop while source bytes remain
        Producer->>Split: Write bytes
        Split->>Disk: append to current block
        alt block full
            Split->>Disk: close block and mark CREATED
            Split->>Consumer: sem_post block_ready
            Split->>Disk: create next block
        end
        Consumer->>Split: Read offset and length
        Split->>Disk: read completed blocks
        Split->>Disk: delete old consumed blocks
    end
    Producer->>Split: Close
    Split->>Consumer: signal final block complete
    Consumer->>Split: read remaining bytes
    Split->>Disk: remove remaining block files
```

## 21. ezRemote Server Runtime

```mermaid
flowchart TB
    ServerMain["ps5-ezremote-server/source/main.cpp"] --> LoadInstallHistory["Load package install host data"]
    ServerMain --> LoadDownloads["Load background download history"]
    ServerMain --> DpiInit["DpiUseCase::Initialize"]
    ServerMain --> Legacy["LegacyDpiServer\nTCP port 9040"]
    ServerMain --> DownloadThread["Background download thread"]
    ServerMain --> Http["HTTP server\nport 6701"]

    Http --> Store["POST /store_bg_install_data"]
    Http --> BgInstall["GET /bg_install/{hash}"]
    Http --> Install["POST /install"]
    Http --> DownloadUrl["POST /download_url"]
    Http --> DownloadState["GET /get_download_state"]
    Http --> Version["GET /version"]
    Http --> Static["static assets and /game-icons"]

    Store --> PersistPkg["pkg_install_history.json"]
    BgInstall --> Remote["remote range client"]
    Install --> Sce["SceAppInstUtil"]
    DownloadUrl --> Queue["download queue"]
    Queue --> DownloadThread
    DownloadThread --> PersistDownloads["bg_download_history.json"]
```

## 22. Background Download State Machine

```mermaid
stateDiagram-v2
    [*] --> Queued
    Queued --> Downloading: worker picks item
    Downloading --> Resumed: temp file exists
    Resumed --> Downloading: continue from offset
    Downloading --> Completed: expected size reached
    Downloading --> Failed: transfer or size error
    Failed --> Queued: server restart or retry path
    Completed --> [*]
```

## 23. Background Download Sequence

```mermaid
sequenceDiagram
    participant UI as ImGui action or Web UI
    participant Client as ezremote_client
    participant Resolver as FileHost and BaseClient
    participant Server as ezremote-server 6701
    participant Worker as DownloadFilesThread
    participant Disk as Destination path

    UI->>Client: request background download URL
    Client->>Resolver: resolve filehost and validate size
    Resolver-->>Client: direct URL and file size
    Client->>Server: POST /download_url
    Server->>Server: persist queued item
    Server-->>Client: success JSON
    Server->>Worker: queue item
    Worker->>Disk: write dest.tmp
    Worker->>Server: update bytes_transfered and state
    Worker->>Disk: rename dest.tmp to final dest
    UI->>Server: GET /get_download_state
    Server-->>UI: progress array
```

## 24. Remote Range Proxy Flow

```mermaid
sequenceDiagram
    participant Installer as PS5 package installer
    participant ClientHttp as ezremote_client HTTP 9090
    participant Pool as RemoteClient pool
    participant Remote as Remote server

    Installer->>ClientHttp: GET /rmt_inst/Site n/path with Range
    ClientHttp->>Pool: GetPooledClient(site_idx)
    Pool-->>ClientHttp: RemoteClient
    ClientHttp->>Remote: GetRange(path, sink, size, offset)
    Remote-->>ClientHttp: requested bytes
    ClientHttp-->>Installer: 206 Partial Content
    ClientHttp->>Pool: ReleasePooledClient(site_idx)
```

## 25. Configuration And Persistence

```mermaid
flowchart TB
    ConfigIni["/data/homebrew/ezremote-client/config.ini"] --> LoadConfig["CONFIG::LoadConfig"]
    LoadConfig --> Globals["Global runtime settings"]
    LoadConfig --> Sites["site_settings map\nRemoteSettings per site"]
    LoadConfig --> Secrets["encrypted passwords\nDebrid API keys"]
    LoadConfig --> Paths["local_directory\nremote defaults\ntemp_folder"]

    Globals --> UI["settings dialogs"]
    Sites --> Connect["Actions::Connect"]
    Paths --> FS["FS and installer temp paths"]
    Secrets --> Remote["RemoteClient authentication\nFileHost debrid APIs"]

    UI --> SaveGlobal["CONFIG::SaveGlobalConfig"]
    Connect --> SaveConfig["CONFIG::SaveConfig"]
    FS --> SaveLocal["CONFIG::SaveLocalDirecotry"]
    SaveGlobal --> ConfigIni
    SaveConfig --> ConfigIni
    SaveLocal --> ConfigIni
```

## 26. Runtime Path Layout

```mermaid
flowchart TB
    DataPath["/data/homebrew/ezremote-client"]
    DataPath --> ClientElf["ezremote_client.elf"]
    DataPath --> ServerElf["ezremote-server.elf"]
    DataPath --> DpiElf["ezremote-dpi.elf constant\nlegacy path"]
    DataPath --> ConfigIni["config.ini"]
    DataPath --> Assets["assets/\nweb UI, langs, fonts, certs"]
    DataPath --> Tmp["tmp/\ntemporary PKG and split chunks"]
    DataPath --> Compressed["compressed_files/\nweb downloadMultiple and compress output"]
    DataPath --> GameIcons["game-icons/\nextracted package icons"]
    DataPath --> TmpSfo["tmp_pkg.sfo"]
    DataPath --> TmpIcon["tmp_icon.png"]
    DataPath --> Logs["client.log\nserver.log"]
    DataPath --> Histories["pkg_install_history.json\nbg_download_history.json"]
```

## 27. Web Asset Layer

```mermaid
flowchart TB
    Assets["data/assets/"] --> Index["index.html"]
    Assets --> Public["public icons\nfavicon.svg, icon.png, cache.appcache"]
    Assets --> Langs["langs/*.ini\nnative UI translations"]
    Assets --> Fonts["fonts/*.ttf\nnative UI fonts"]
    Assets --> Certs["certs/cacert.pem"]

    Index --> Bundle["inline React/Vite JS and CSS"]
    Bundle --> Toasts["toasts for /__local__ calls"]
    Bundle --> NavFilter["root navigation filter\n/data and /mnt only"]
    Bundle --> Search["recursive search and filters"]
    Bundle --> UploadOverride["chunk upload\nresume probes"]
    Bundle --> DropPkg["Drop PKG flow\nupload then install"]
    Bundle --> Layout["topbar, breadcrumbs, table, toasts"]

    Bundle --> LocalApi["/__local__/ endpoints"]
    DropPkg --> LocalApi
    UploadOverride --> LocalApi
```

## 28. Thread And Async Work Map

```mermaid
flowchart TB
    MainThread["Main UI thread\nGUI::RenderLoop"] --> ServerThread["HttpServer::ServerThread\ndetached"]
    MainThread --> ActionWorkers["Action worker threads\ndownload, upload, delete, install, zip"]
    MainThread --> KeepAlive["FTP KeepAliveThread"]
    MainThread --> BgServerStart["StartEzRemoteServer\npayload loader interaction"]

    ActionWorkers --> SharedGlobals["shared globals\nactivity_inprogess, file_transfering, status_message"]
    ActionWorkers --> FilesMutex["files_mutex guards UI file list updates"]
    ActionWorkers --> SplitWriters["Split/cache writer threads"]
    SplitWriters --> CleanupThreads["CleanArchivePkgDataThread\nCleanSplitPkgDataThread"]

    ServerPayload["ezremote-server process"] --> ServerHttpThread["HTTP server thread"]
    ServerPayload --> LegacyThread["legacy DPI TCP server"]
    ServerPayload --> DownloadThread["background download worker"]
```

## 29. Installer Mode Comparison

```mermaid
flowchart LR
    Package["PKG source"] --> Mode{"Install mode"}
    Mode --> Local["Local install\nsource already on /data or /mnt"]
    Mode --> Temp["RPI disabled\ndownload whole PKG to temp"]
    Mode --> Rpi["RPI enabled\nstream remote URL or proxy"]
    Mode --> DiskCache["RPI plus disk cache\nSplitFile chunks"]
    Mode --> Archive["PKG inside archive\nextract into SplitFile chunks"]

    Local --> Dpi["POST localhost:6701/install"]
    Temp --> Dpi
    Rpi --> Dpi
    DiskCache --> ClientHttp["client HTTP /split_inst/hash"]
    Archive --> ClientHttpArchive["client HTTP /archive_inst/hash"]
    ClientHttp --> Dpi
    ClientHttpArchive --> Dpi
    Dpi --> Sce["SceAppInstUtil"]
```

## 30. Payload Relationship

```mermaid
flowchart TB
    Client["ezremote_client.elf\ninteractive app"] --> StartServer["INSTALLER::StartEzRemoteServer"]
    StartServer --> Loader["localhost payload loader\nport 9021"]
    Loader --> Server["ezremote-server.elf"]

    Client --> ServerHttp["HTTP calls to localhost:6701"]
    ServerHttp --> Install["/install"]
    ServerHttp --> Store["/store_bg_install_data"]
    ServerHttp --> Download["/download_url"]
    ServerHttp --> State["/get_download_state"]
    ServerHttp --> Version["/version"]

    Server --> Legacy["legacy DPI compatibility\nTCP 9040"]
    Dpi["ezremote-dpi.elf\nstandalone legacy installer"] -.->|separate subproject| LegacyPurpose["simple TCP URL installer\nport 9040"]
```

## 31. Data Flow For Remote Browsing And Transfer

```mermaid
flowchart TB
    Connect["Connect to site"] --> RemoteClient["RemoteClient instance"]
    RemoteClient --> List["ListDir(remote_directory)"]
    List --> RemoteFiles["remote_files vector\nDirEntry objects"]
    RemoteFiles --> UI["Remote pane"]

    UI --> Download["Download selected remote files"]
    Download --> RemoteGet["remoteclient->Get(local path, remote path)"]
    RemoteGet --> LocalDisk["PS5 local disk"]

    UI --> Upload["Upload selected local files"]
    Upload --> RemotePut["remoteclient->Put(local path, remote path)"]
    RemotePut --> RemoteServer["remote server storage"]

    UI --> RemoteEdit["remote edit"]
    RemoteEdit --> TempEditor["tmp_editor.txt"]
    TempEditor --> RemotePut
```

## 32. API Response Contract

```mermaid
flowchart LR
    Handler["/__local__ handler"] --> Validate["parse and validate JSON\nquery, or multipart fields"]
    Validate --> Work["perform FS, archive, install, or queue operation"]
    Work --> Result{"success?"}
    Result -->|"Yes"| Success["{ result: { success: true, error: null } }"]
    Result -->|"No"| Failure["{ result: { success: false, error: message } }"]
    Success --> React["React Web UI"]
    Failure --> React
```
