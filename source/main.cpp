#undef main

#include <archive.h>
#include <archive_entry.h>
#include <arpa/inet.h>
#include <curl/curl.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <string>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>

#include "dbglogger.h"
#include "sceSystemService.h"

extern "C"
{
    static int g_libnetMemId = -1;
    int sceNetInit();
    int sceNetPoolCreate(const char *, int, int);
    int sceNetPoolDestroy(int);
};

#ifndef EZREMOTE_SERVER_REQUIRED_VERSION
#define EZREMOTE_SERVER_REQUIRED_VERSION "unknown"
#endif

#define NET_HEAP_SIZE (5 * 1024 * 1024)

#define APP_ID "ezremote-client"
#define DATA_PATH "/data/homebrew/" APP_ID
#define SERVER_ELF_PATH DATA_PATH "/ezremote-server.elf"
#define CLIENT_ELF_PATH DATA_PATH "/ezremote_client.elf"

static const char *BOOTSTRAP_PACKAGE_URL = "https://github.com/t-tx/ps5-ezremote-client/releases/latest/download/ezremote_client.zip";
static const char *BOOTSTRAP_ZIP_NAME = "ezremote_client_bootstrap.zip";
static const size_t BOOTSTRAP_TRANSFER_SIZE = 1024 * 1024;

static bool done = false;
static bool curl_initialized = false;

static void signal_handler(int sig)
{
    dbglogger_log("Received signal %d, shutting down...", sig);
    done = true;
}

static bool IsDirectory(const std::string &path)
{
    struct stat st;
    memset(&st, 0, sizeof(st));
    return stat(path.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
}

static int64_t GetFileSize(const std::string &path)
{
    struct stat st;
    memset(&st, 0, sizeof(st));
    if (stat(path.c_str(), &st) != 0)
    {
        return -1;
    }
    return st.st_size;
}

static bool FileExists(const std::string &path)
{
    struct stat st;
    memset(&st, 0, sizeof(st));
    return stat(path.c_str(), &st) == 0 && S_ISREG(st.st_mode);
}

static bool RemoveFile(const std::string &path)
{
    if (remove(path.c_str()) == 0)
    {
        return true;
    }
    return errno == ENOENT;
}

static bool WriteAll(int fd, const void *data, size_t size)
{
    const char *cursor = static_cast<const char *>(data);
    while (size > 0)
    {
        ssize_t written = write(fd, cursor, size);
        if (written <= 0)
        {
            return false;
        }
        cursor += written;
        size -= static_cast<size_t>(written);
    }
    return true;
}

static bool MkDirs(const std::string &path, bool parent_only = false)
{
    std::string target = path;
    if (parent_only)
    {
        size_t slash = target.find_last_of('/');
        if (slash == std::string::npos)
        {
            return true;
        }
        target = slash == 0 ? "/" : target.substr(0, slash);
    }

    if (target.empty() || target == "/")
    {
        return true;
    }

    size_t pos = target[0] == '/' ? 1 : 0;
    while (pos <= target.size())
    {
        size_t slash = target.find('/', pos);
        std::string current = slash == std::string::npos ? target : target.substr(0, slash);
        if (!current.empty() && mkdir(current.c_str(), 0777) != 0 && errno != EEXIST)
        {
            return false;
        }
        if (!current.empty() && !IsDirectory(current))
        {
            return false;
        }
        if (slash == std::string::npos)
        {
            break;
        }
        pos = slash + 1;
    }

    return true;
}

static std::string JoinPath(const std::string &base, const std::string &name)
{
    if (base.empty() || base == "/")
    {
        return "/" + name;
    }
    return base[base.size() - 1] == '/' ? base + name : base + "/" + name;
}

static std::string AppDataParentPath()
{
    std::string path(DATA_PATH);
    size_t slash = path.find_last_of('/');
    if (slash == std::string::npos || slash == 0)
    {
        return "/";
    }
    return path.substr(0, slash);
}

static std::string BootstrapZipPath()
{
    return JoinPath(AppDataParentPath(), BOOTSTRAP_ZIP_NAME);
}

static bool AppDataHasUiFiles()
{
    return FileExists(DATA_PATH "/assets/index.html");
}

static bool AppDataHasPackagedFiles()
{
    return AppDataHasUiFiles() &&
           FileExists(CLIENT_ELF_PATH) &&
           FileExists(SERVER_ELF_PATH);
}

static bool AppDataCanLaunchServer()
{
    return AppDataHasUiFiles() && FileExists(SERVER_ELF_PATH);
}

static bool AppDataNeedsBootstrap()
{
    return !AppDataHasPackagedFiles();
}

static void Trim(std::string &value)
{
    while (!value.empty() &&
           (value[value.size() - 1] == ' ' || value[value.size() - 1] == '\t' ||
            value[value.size() - 1] == '\r' || value[value.size() - 1] == '\n'))
    {
        value.resize(value.size() - 1);
    }

    size_t start = 0;
    while (start < value.size() &&
           (value[start] == ' ' || value[start] == '\t' || value[start] == '\r' || value[start] == '\n'))
    {
        ++start;
    }
    if (start > 0)
    {
        value.erase(0, start);
    }
}

static size_t FileWriteCallback(void *contents, size_t size, size_t nmemb, void *userp)
{
    FILE *out = static_cast<FILE *>(userp);
    return fwrite(contents, 1, size * nmemb, out);
}

static size_t StringWriteCallback(void *contents, size_t size, size_t nmemb, void *userp)
{
    size_t total = size * nmemb;
    std::string *out = static_cast<std::string *>(userp);
    out->append(static_cast<const char *>(contents), total);
    return total;
}

static bool DownloadBootstrapPackage(const std::string &zip_path)
{
    RemoveFile(zip_path);

    FILE *out = fopen(zip_path.c_str(), "wb");
    if (out == nullptr)
    {
        dbglogger_log("[Bootstrap] Failed to create %s", zip_path.c_str());
        return false;
    }

    CURL *curl = curl_easy_init();
    if (curl == nullptr)
    {
        fclose(out);
        RemoveFile(zip_path);
        dbglogger_log("[Bootstrap] curl_easy_init failed");
        return false;
    }

    curl_easy_setopt(curl, CURLOPT_URL, BOOTSTRAP_PACKAGE_URL);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 10L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, FileWriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, out);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "ezRemoteClient-bootstrap/1.0");
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);
    curl_easy_setopt(curl, CURLOPT_LOW_SPEED_TIME, 60L);
    curl_easy_setopt(curl, CURLOPT_LOW_SPEED_LIMIT, 1024L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0L);

    CURLcode ret = curl_easy_perform(curl);
    long status = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    curl_easy_cleanup(curl);
    fclose(out);

    int64_t downloaded_size = GetFileSize(zip_path);
    if (ret != CURLE_OK || status < 200 || status >= 300 || downloaded_size <= 0)
    {
        dbglogger_log("[Bootstrap] Download failed: curl=%d http=%ld size=%lld", ret, status, (long long)downloaded_size);
        RemoveFile(zip_path);
        return false;
    }

    return true;
}

static bool IsSafeArchivePath(const char *path)
{
    if (path == nullptr || path[0] == '\0' || path[0] == '/' || strchr(path, '\\') != nullptr)
    {
        return false;
    }

    const char *segment = path;
    while (*segment != '\0')
    {
        while (*segment == '/')
        {
            ++segment;
        }

        const char *end = strchr(segment, '/');
        size_t len = end == nullptr ? strlen(segment) : static_cast<size_t>(end - segment);
        if (len == 2 && segment[0] == '.' && segment[1] == '.')
        {
            return false;
        }
        if (end == nullptr)
        {
            break;
        }
        segment = end + 1;
    }

    return true;
}

static bool ExtractRegularFile(struct archive *archive, const std::string &path)
{
    if (!MkDirs(path, true))
    {
        dbglogger_log("[Bootstrap] Failed to create parent directory for %s", path.c_str());
        return false;
    }

    int fd = open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0777);
    if (fd < 0)
    {
        dbglogger_log("[Bootstrap] Failed to open %s for extraction", path.c_str());
        return false;
    }

    void *buffer = malloc(BOOTSTRAP_TRANSFER_SIZE);
    if (buffer == nullptr)
    {
        close(fd);
        return false;
    }

    bool ok = true;
    while (ok)
    {
        la_ssize_t len = archive_read_data(archive, buffer, BOOTSTRAP_TRANSFER_SIZE);
        if (len == 0)
        {
            break;
        }
        if (len < 0)
        {
            dbglogger_log("[Bootstrap] archive_read_data failed: %s", archive_error_string(archive));
            ok = false;
            break;
        }

        if (!WriteAll(fd, buffer, static_cast<size_t>(len)))
        {
            ok = false;
        }
    }

    free(buffer);
    close(fd);
    return ok;
}

static bool ExtractBootstrapPackage(const std::string &zip_path)
{
    struct archive *archive = archive_read_new();
    if (archive == nullptr)
    {
        return false;
    }

    archive_read_support_format_zip(archive);
    archive_read_support_filter_all(archive);

    int ret = archive_read_open_filename(archive, zip_path.c_str(), BOOTSTRAP_TRANSFER_SIZE);
    if (ret < ARCHIVE_OK)
    {
        dbglogger_log("[Bootstrap] Failed to open archive %s: %s", zip_path.c_str(), archive_error_string(archive));
        archive_read_free(archive);
        return false;
    }

    if (!MkDirs(DATA_PATH))
    {
        archive_read_free(archive);
        return false;
    }

    struct archive_entry *entry = nullptr;
    bool ok = true;
    while (ok)
    {
        ret = archive_read_next_header(archive, &entry);
        if (ret == ARCHIVE_EOF)
        {
            break;
        }
        if (ret < ARCHIVE_OK)
        {
            dbglogger_log("[Bootstrap] Failed to read archive header: %s", archive_error_string(archive));
            ok = false;
            break;
        }

        const char *entry_path = archive_entry_pathname(entry);
        if (!IsSafeArchivePath(entry_path))
        {
            dbglogger_log("[Bootstrap] Skipping unsafe archive path: %s", entry_path == nullptr ? "(null)" : entry_path);
            archive_read_data_skip(archive);
            continue;
        }

        mode_t filetype = archive_entry_filetype(entry);
        std::string output_path = JoinPath(DATA_PATH, entry_path);
        size_t path_len = strlen(entry_path);

        if (S_ISDIR(filetype) || (path_len > 0 && entry_path[path_len - 1] == '/'))
        {
            ok = MkDirs(output_path);
            archive_read_data_skip(archive);
        }
        else if (S_ISREG(filetype))
        {
            ok = ExtractRegularFile(archive, output_path);
        }
        else
        {
            archive_read_data_skip(archive);
        }
    }

    archive_read_free(archive);
    if (!ok)
    {
        return false;
    }

    if (!AppDataHasPackagedFiles())
    {
        dbglogger_log("[Bootstrap] Extract completed but required files are missing");
        return false;
    }

    return true;
}

static bool BootstrapAppData()
{
    dbglogger_log("[Bootstrap] Installing ezRemote Client package from %s", BOOTSTRAP_PACKAGE_URL);
    printf("Installing ezRemote Client files...\n");

    std::string parent_path = AppDataParentPath();
    std::string zip_path = BootstrapZipPath();
    MkDirs(parent_path);

    if (!DownloadBootstrapPackage(zip_path))
    {
        printf("ezRemote Client package download failed\n");
        return false;
    }

    bool extracted = ExtractBootstrapPackage(zip_path);
    RemoveFile(zip_path);

    if (!extracted)
    {
        printf("ezRemote Client package extraction failed\n");
        return false;
    }

    dbglogger_log("[Bootstrap] ezRemote Client package installed");
    printf("ezRemote Client files installed\n");
    return true;
}

static bool GetServerVersion(std::string *version)
{
    version->clear();

    CURL *curl = curl_easy_init();
    if (curl == nullptr)
    {
        return false;
    }

    curl_easy_setopt(curl, CURLOPT_URL, "http://127.0.0.1:6701/version");
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, StringWriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, version);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 1L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 1L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    CURLcode res = curl_easy_perform(curl);
    long http_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK || http_code != 200)
    {
        version->clear();
        return false;
    }

    Trim(*version);
    return !version->empty();
}

static bool ServerVersionMatches(const std::string &version)
{
    return version == EZREMOTE_SERVER_REQUIRED_VERSION;
}

static bool CheckServerRunning()
{
    std::string version;
    return GetServerVersion(&version) && ServerVersionMatches(version);
}

static void StopRunningServer()
{
    CURL *curl = curl_easy_init();
    if (curl == nullptr)
    {
        return;
    }

    std::string body;
    curl_easy_setopt(curl, CURLOPT_URL, "http://127.0.0.1:6701/stop");
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, StringWriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 1L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 2L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}

static bool WaitForServerStop()
{
    for (int i = 0; i < 5; ++i)
    {
        std::string version;
        if (!GetServerVersion(&version))
        {
            return true;
        }
        sleep(1);
    }
    return false;
}

static int StartEzRemoteServer()
{
    char buffer[8192];
    in_addr_t in_addr;
    int filefd = -1;
    int sockfd = -1;
    ssize_t read_return;
    struct hostent *hostent;
    struct sockaddr_in sockaddr_in;
    unsigned short server_port = 9021;

    std::string version;
    if (GetServerVersion(&version))
    {
        if (ServerVersionMatches(version))
        {
            dbglogger_log("Server already running version %s.", version.c_str());
            return 0;
        }

        dbglogger_log("Server version mismatch. Running %s, required %s. Restarting server.",
                      version.c_str(), EZREMOTE_SERVER_REQUIRED_VERSION);
        StopRunningServer();
        if (!WaitForServerStop())
        {
            dbglogger_log("Timed out waiting for old ezRemote Server to stop.");
            return -1;
        }
    }

    filefd = open(SERVER_ELF_PATH, O_RDONLY);
    if (filefd == -1)
    {
        goto err;
    }

    sockfd = socket(AF_INET, SOCK_STREAM, 0);
    if (sockfd == -1)
    {
        goto err;
    }

    hostent = gethostbyname("127.0.0.1");
    if (hostent == NULL)
    {
        goto err;
    }

    in_addr = inet_addr(inet_ntoa(*(struct in_addr *)*(hostent->h_addr_list)));
    if (in_addr == (in_addr_t)-1)
    {
        goto err;
    }

    memset(&sockaddr_in, 0, sizeof(sockaddr_in));
    sockaddr_in.sin_addr.s_addr = in_addr;
    sockaddr_in.sin_family = AF_INET;
    sockaddr_in.sin_port = htons(server_port);

    if (connect(sockfd, (struct sockaddr *)&sockaddr_in, sizeof(sockaddr_in)) == -1)
    {
        goto err;
    }

    while (1)
    {
        read_return = read(filefd, buffer, sizeof(buffer));
        if (read_return == 0)
        {
            break;
        }
        if (read_return == -1)
        {
            goto err;
        }
        if (!WriteAll(sockfd, buffer, static_cast<size_t>(read_return)))
        {
            goto err;
        }
    }

    close(filefd);
    close(sockfd);
    return 0;

err:
    if (filefd != -1)
    {
        close(filefd);
    }
    if (sockfd != -1)
    {
        close(sockfd);
    }
    return -1;
}

static void terminate()
{
    if (g_libnetMemId != -1)
    {
        sceNetPoolDestroy(g_libnetMemId);
    }
    if (curl_initialized)
    {
        curl_global_cleanup();
    }
}

int main()
{
    setvbuf(stdout, NULL, _IONBF, 0);

    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    MkDirs(DATA_PATH);
    dbglogger_init_str("file:/data/homebrew/ezremote-client/client.log");
    dbglogger_log("ezRemote Client bootstrapper starting...");

    if (sceNetInit() != 0)
    {
        dbglogger_log("sceNetInit failed!");
        return -1;
    }
    if ((g_libnetMemId = sceNetPoolCreate("ezremote_client", NET_HEAP_SIZE, 0)) < 0)
    {
        dbglogger_log("sceNetPoolCreate failed!");
        return -1;
    }

    curl_global_init(CURL_GLOBAL_DEFAULT);
    curl_initialized = true;
    atexit(terminate);

    if (!IsDirectory(DATA_PATH))
    {
        dbglogger_log("ezRemote Client data path is not a directory");
        printf("ezRemote Client data path is not a directory\n");
        return -1;
    }

    bool needs_bootstrap = AppDataNeedsBootstrap();
    dbglogger_log("AppDataNeedsBootstrap returned: %d", needs_bootstrap);

    if (needs_bootstrap && !BootstrapAppData() && !AppDataCanLaunchServer())
    {
        dbglogger_log("[Bootstrap] Cannot continue without UI assets and ezRemote Server payload");
        return -1;
    }

    if (StartEzRemoteServer() != 0)
    {
        dbglogger_log("Failed to request ezRemote Server start.");
    }

    dbglogger_log("Waiting for ezRemote Server %s to start...", EZREMOTE_SERVER_REQUIRED_VERSION);
    int wait_attempts = 0;
    while (!done && !CheckServerRunning())
    {
        sleep(1);
        ++wait_attempts;
        if (wait_attempts % 5 == 0)
        {
            StartEzRemoteServer();
        }
    }

    if (done)
    {
        return 0;
    }

    dbglogger_log("ezRemote Server is serving on port 6701.");

    sceSystemServiceLaunchWebBrowser("http://127.0.0.1:6701");

    dbglogger_log("Bootstrapping complete. Server injected successfully. Main loop waiting...");
    printf("ezRemote Server is running.\nOpen your browser to the PS5's IP address on port 6701.\n");

    while (!done)
    {
        sleep(2);

        std::string version;
        bool server_running = GetServerVersion(&version);
        if (server_running && ServerVersionMatches(version))
        {
            continue;
        }

        if (FileExists(DATA_PATH "/restart.flag"))
        {
            RemoveFile(DATA_PATH "/restart.flag");
            dbglogger_log("Restart flag detected. Restarting ezRemote Server...");
            StartEzRemoteServer();
        }
        else if (server_running)
        {
            dbglogger_log("ezRemote Server version changed to %s. Restarting required version %s.",
                          version.c_str(), EZREMOTE_SERVER_REQUIRED_VERSION);
            StartEzRemoteServer();
        }
        else
        {
            dbglogger_log("ezRemote Server stopped. Exiting bootstrapper.");
            done = true;
        }
    }

    dbglogger_log("ezRemote Client shutting down.");

    return 0;
}
