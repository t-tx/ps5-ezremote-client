#undef main

#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <dirent.h>
#include <sys/stat.h>
#include <curl/curl.h>
#include <signal.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <fcntl.h>

#include "dbglogger.h"
#include "fs.h"
#include "zip_util.h"

#include "sceSystemService.h"
extern "C"
{
	static int g_libnetMemId  = -1;
	int sceNetInit();
	int sceNetPoolCreate(const char*, int, int);
	int sceNetPoolDestroy(int);	
};

#define NET_HEAP_SIZE   (5 * 1024 * 1024)

#define APP_ID "ezremote-client"
#define DATA_PATH "/data/homebrew/" APP_ID
#define CACERT_FILE DATA_PATH "/assets/certs/cacert.pem"
#define SERVER_ELF_PATH DATA_PATH "/ezremote-server.elf"
#define CLIENT_ELF_PATH DATA_PATH "/ezremote_client.elf"

static const char *BOOTSTRAP_PACKAGE_URL = "https://github.com/t-tx/ps5-ezremote-client/releases/latest/download/ezremote_client.zip";
static const char *BOOTSTRAP_ZIP_NAME = "ezremote_client_bootstrap.zip";

static bool done = false;

static void signal_handler(int sig)
{
	dbglogger_log("Received signal %d, shutting down...", sig);
	done = true;
}

static std::string AppDataParentPath()
{
	std::string path(DATA_PATH);
	size_t slash = path.find_last_of('/');
	if (slash == std::string::npos || slash == 0)
		return "/";
	return path.substr(0, slash);
}

static std::string BootstrapZipPath()
{
	return FS::GetPath(AppDataParentPath(), BOOTSTRAP_ZIP_NAME);
}

static bool AppDataHasUiFiles()
{
	return FS::FileExists(DATA_PATH "/assets/index.html") &&
		   FS::FileExists(DATA_PATH "/assets/fonts/Roboto.ttf") &&
		   FS::FileExists(DATA_PATH "/assets/fonts/Roboto_ext.ttf") &&
		   FS::FileExists(DATA_PATH "/assets/fonts/fa-solid-900.ttf") &&
		   FS::FileExists(DATA_PATH "/assets/fonts/OpenFontIcons.ttf");
}

static bool AppDataHasPackagedFiles()
{
	return AppDataHasUiFiles() &&
		   FS::FileExists(CACERT_FILE) &&
		   FS::FileExists(CLIENT_ELF_PATH) &&
		   FS::FileExists(SERVER_ELF_PATH);
}

static bool AppDataNeedsBootstrap()
{
	return !AppDataHasPackagedFiles();
}

static size_t BootstrapWriteCallback(void *contents, size_t size, size_t nmemb, void *userp)
{
	FILE *out = static_cast<FILE *>(userp);
	return fwrite(contents, 1, size * nmemb, out);
}

static bool DownloadBootstrapPackage(const std::string &zip_path)
{
	FS::Rm(zip_path);

	FILE *out = FS::Create(zip_path);
	if (out == nullptr)
	{
		dbglogger_log("[Bootstrap] Failed to create %s", zip_path.c_str());
		return false;
	}

	curl_global_init(CURL_GLOBAL_DEFAULT);
	CURL *curl = curl_easy_init();
	if (curl == nullptr)
	{
		FS::Close(out);
		FS::Rm(zip_path);
		dbglogger_log("[Bootstrap] curl_easy_init failed");
		return false;
	}

	curl_easy_setopt(curl, CURLOPT_URL, BOOTSTRAP_PACKAGE_URL);
	curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
	curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 10L);
	curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, BootstrapWriteCallback);
	curl_easy_setopt(curl, CURLOPT_WRITEDATA, out);
	curl_easy_setopt(curl, CURLOPT_USERAGENT, "ezRemoteClient-bootstrap/1.0");
	curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);
	curl_easy_setopt(curl, CURLOPT_LOW_SPEED_TIME, 60L);
	curl_easy_setopt(curl, CURLOPT_LOW_SPEED_LIMIT, 1024L);
	curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

	if (FS::FileExists(CACERT_FILE))
	{
		curl_easy_setopt(curl, CURLOPT_CAINFO, CACERT_FILE);
	}
	else
	{
		curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);
		curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0L);
	}

	CURLcode ret = curl_easy_perform(curl);
	long status = 0;
	curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
	curl_easy_cleanup(curl);
	FS::Close(out);

	if (ret != CURLE_OK || (status < 200 || status >= 300) || FS::GetSize(zip_path) <= 0)
	{
		dbglogger_log("[Bootstrap] Download failed: curl=%d http=%ld size=%ld", ret, status, FS::GetSize(zip_path));
		FS::Rm(zip_path);
		return false;
	}

	return true;
}

static bool ExtractBootstrapPackage(const std::string &zip_path)
{
	DirEntry zip_file;
	memset(&zip_file, 0, sizeof(zip_file));

	std::string parent_path = AppDataParentPath();
	snprintf(zip_file.directory, sizeof(zip_file.directory), "%s", parent_path.c_str());
	snprintf(zip_file.name, sizeof(zip_file.name), "%s", BOOTSTRAP_ZIP_NAME);
	snprintf(zip_file.path, sizeof(zip_file.path), "%s", zip_path.c_str());
	zip_file.file_size = FS::GetSize(zip_path);
	zip_file.isDir = false;
	zip_file.selectable = true;

	if (ZipUtil::Extract(zip_file, DATA_PATH) == 0)
	{
		dbglogger_log("[Bootstrap] Extract failed");
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
	FS::MkDirs(parent_path);

	if (!DownloadBootstrapPackage(zip_path))
	{
		printf("ezRemote Client package download failed\n");
		return false;
	}

	bool extracted = ExtractBootstrapPackage(zip_path);
	FS::Rm(zip_path);

	if (!extracted)
	{
		printf("ezRemote Client package extraction failed\n");
		return false;
	}

	dbglogger_log("[Bootstrap] ezRemote Client package installed");
	printf("ezRemote Client files installed\n");
	return true;
}

static bool CheckServerRunning()
{
	CURL *curl = curl_easy_init();
	if(curl) {
		curl_easy_setopt(curl, CURLOPT_URL, "http://127.0.0.1:6701/version");
		curl_easy_setopt(curl, CURLOPT_NOBODY, 1L); // HEAD request
		curl_easy_setopt(curl, CURLOPT_TIMEOUT, 1L);
		CURLcode res = curl_easy_perform(curl);
		long http_code = 0;
		curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
		curl_easy_cleanup(curl);
		if(res == CURLE_OK && http_code == 200) {
			return true;
		}
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

	if (CheckServerRunning())
	{
		dbglogger_log("Server already running.");
		return 0;
	}

	filefd = open(SERVER_ELF_PATH, O_RDONLY);
	if (filefd == -1) goto err;

	sockfd = socket(AF_INET, SOCK_STREAM, 0);
	if (sockfd == -1) goto err;

	hostent = gethostbyname("127.0.0.1");
	if (hostent == NULL) goto err;

	in_addr = inet_addr(inet_ntoa(*(struct in_addr *)*(hostent->h_addr_list)));
	if (in_addr == (in_addr_t)-1) goto err;

	sockaddr_in.sin_addr.s_addr = in_addr;
	sockaddr_in.sin_family = AF_INET;
	sockaddr_in.sin_port = htons(server_port);

	if (connect(sockfd, (struct sockaddr *)&sockaddr_in, sizeof(sockaddr_in)) == -1) goto err;

	while (1)
	{
		read_return = read(filefd, buffer, 8192);
		if (read_return == 0) break;
		if (read_return == -1) goto err;
		if (write(sockfd, buffer, read_return) == -1) goto err;
	}

	close(filefd);
	close(sockfd);
	return 0;

err:
	if (filefd != -1) close(filefd);
	if (sockfd != -1) close(sockfd);
	return -1;
}

static void terminate()
{
	if (g_libnetMemId != -1)
	{
		sceNetPoolDestroy(g_libnetMemId);
	}
}

int main()
{
	setvbuf(stdout, NULL, _IONBF, 0);

	signal(SIGINT, signal_handler);
	signal(SIGTERM, signal_handler);

	// Ensure the base directory exists before initializing logger
	FS::MkDirs(DATA_PATH);
	dbglogger_init_str("file:/data/homebrew/ezremote-client/client.log");
	dbglogger_log("ezRemote Client bootstrapper starting...");

	if (sceNetInit() != 0)
	{
		dbglogger_log("sceNetInit failed!");
		return -1;
	}
	if ((g_libnetMemId=sceNetPoolCreate("ezremote_client", NET_HEAP_SIZE, 0)) < 0)
	{
		dbglogger_log("sceNetPoolCreate failed!");
		return -1;
	}

	if (FS::IsFolder(DATA_PATH) == 0)
	{
		dbglogger_log("ezRemote Client data path is not a directory");
		printf("ezRemote Client data path is not a directory\n");
		return -1;
	}

	bool needs_bootstrap = AppDataNeedsBootstrap();
	dbglogger_log("AppDataNeedsBootstrap returned: %d", needs_bootstrap);

	if (needs_bootstrap && !BootstrapAppData() && !AppDataHasUiFiles())
	{
		dbglogger_log("[Bootstrap] Cannot continue without UI assets");
		return -1;
	}

	StartEzRemoteServer();

	dbglogger_log("Waiting for ezRemote Server to start...");
	while (!CheckServerRunning())
	{
		sleep(1);
	}
	dbglogger_log("ezRemote Server is serving on port 6701.");

	sceSystemServiceLaunchWebBrowser("http://127.0.0.1:6701");

	atexit(terminate);

	dbglogger_log("Bootstrapping complete. Server injected successfully. Main loop waiting...");
	printf("ezRemote Server is running.\nOpen your browser to the PS5's IP address on port 6701.\n");

	while (!done)
	{
		sleep(1);
	}

	dbglogger_log("ezRemote Client shutting down.");

	return 0;
}
