#include <string>
#include <chrono>
#include <atomic>
#include <unistd.h>
#include <fcntl.h>
#include <shared_mutex>
#include <vector>
#include <queue>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <errno.h>
#include <string.h>
#include <json-c/json.h>
#include <server/range_parser.h>
#include "http/httplib.h"
#include "server/http_server.h"
#include "clients/smbclient.h"
#include "clients/sftpclient.h"
#include "clients/ftpclient.h"
#include "clients/nfsclient.h"
#include "clients/webdav.h"
#include "clients/apache.h"
#include "clients/archiveorg.h"
#include "clients/iis.h"
#include "clients/github.h"
#include "clients/myrient.h"
#include "clients/nginx.h"
#include "clients/npxserve.h"
#include "clients/rclone.h"
#include "filehost/filehost.h"
#include "config.h"
#include "fs.h"
#include "windows.h"
#include "lang.h"
#include "zip_util.h"
#include "util.h"
#include "dbglogger.h"
#include "actions.h"

#define SUCCESS_MSG "{ \"result\": { \"success\": true, \"error\": null } }"
#define FAILURE_MSG "{ \"result\": { \"success\": false, \"error\": \"%s\" } }"
#define SUCCESS_MSG_LEN 48
#define PKG_INITIAL_REQUEST_SIZE 8388608ul
#define WEB_UPLOAD_PAYLOAD_MAX_LENGTH (static_cast<size_t>(2ull * 1024ull * 1024ull * 1024ull))


std::shared_mutex mutex_;

using namespace httplib;

Server *svr;
int http_server_port = 9090;
int http_int_server_port = 6701;
char compressed_file_path[1024];
bool web_server_enabled = false;

namespace HttpServer
{
    static const char *EXTRACT_STAGING_ROOT = "/data/extracting";

    enum ExtractJobState
    {
        EXTRACT_STATE_PENDING = 0,
        EXTRACT_STATE_IN_PROGRESS = 1,
        EXTRACT_STATE_COMPLETED = 2,
        EXTRACT_STATE_FAILED = 3
    };

    struct ExtractJob
    {
        uint64_t id;
        int site_idx;
        std::string item;
        std::string folder_name;
        std::string staging_path;
        std::string final_path;
        std::string message;
        std::string error;
        uint64_t bytes_transfered;
        uint64_t bytes_to_download;
        uint64_t started_at;
        uint64_t finished_at;
        ExtractJobState state;
    };

    struct ExtractThreadArgs
    {
        uint64_t id;
        int site_idx;
        std::string item;
        std::string folder_name;
        std::string staging_path;
        std::string final_path;
    };

    static std::mutex extract_jobs_mutex;
    static std::vector<ExtractJob> extract_jobs;

    static const char *ExtractStateText(ExtractJobState state)
    {
        switch (state)
        {
        case EXTRACT_STATE_PENDING:
            return "pending";
        case EXTRACT_STATE_IN_PROGRESS:
            return "in_progress";
        case EXTRACT_STATE_COMPLETED:
            return "completed";
        case EXTRACT_STATE_FAILED:
            return "failed";
        default:
            return "unknown";
        }
    }

    static std::string JoinPath(const std::string &base, const std::string &name)
    {
        if (base.empty() || base == "/")
            return "/" + name;
        return base + (FS::hasEndSlash(base.c_str()) ? "" : "/") + name;
    }

    static std::string BaseName(const std::string &path)
    {
        size_t end = path.find_last_not_of('/');
        if (end == std::string::npos)
            return "extract";

        size_t slash = path.find_last_of('/', end);
        if (slash == std::string::npos)
            return path.substr(0, end + 1);
        return path.substr(slash + 1, end - slash);
    }

    static std::string StripArchiveExtension(const std::string &name)
    {
        std::string lower = Util::ToLower(name);
        const char *extensions[] = {".tar.gz", ".tar.xz", ".tar.bz2", ".zip", ".rar", ".7z", ".gz", ".xz", ".bz2"};
        for (size_t i = 0; i < sizeof(extensions) / sizeof(extensions[0]); i++)
        {
            std::string ext = extensions[i];
            if (lower.length() > ext.length() && lower.compare(lower.length() - ext.length(), ext.length(), ext) == 0)
                return name.substr(0, name.length() - ext.length());
        }

        size_t dot = name.find_last_of('.');
        if (dot != std::string::npos && dot > 0)
            return name.substr(0, dot);
        return name;
    }

    static std::string SanitizeExtractFolderName(const std::string &requested, const std::string &item)
    {
        std::string source = requested.empty() ? StripArchiveExtension(BaseName(item)) : requested;
        std::string out;
        out.reserve(source.length());

        for (size_t i = 0; i < source.length() && out.length() < 180; i++)
        {
            unsigned char c = static_cast<unsigned char>(source[i]);
            if (source[i] == '/' || source[i] == '\\' || c < 32)
                out.push_back('_');
            else
                out.push_back(source[i]);
        }

        while (!out.empty() && (out[0] == ' ' || out[0] == '.'))
            out.erase(out.begin());
        while (!out.empty() && out[out.length() - 1] == ' ')
            out.erase(out.end() - 1);

        if (out.empty() || out == "." || out == "..")
            out = "extract";
        return out;
    }

    static bool IsSafeAbsolutePath(const std::string &path)
    {
        if (path.empty() || path[0] != '/')
            return false;
        if (path.find("/../") != std::string::npos)
            return false;
        if (path.length() >= 3 && path.compare(path.length() - 3, 3, "/..") == 0)
            return false;
        return true;
    }

    static void UpdateExtractJob(uint64_t id, ExtractJobState state, const std::string &message, const std::string &error, bool finished)
    {
        std::lock_guard<std::mutex> lock(extract_jobs_mutex);
        for (auto &job : extract_jobs)
        {
            if (job.id == id)
            {
                job.state = state;
                job.message = message;
                job.error = error;
                job.bytes_transfered = bytes_transfered;
                job.bytes_to_download = bytes_to_download;
                if (finished)
                    job.finished_at = Util::GetTick();
                return;
            }
        }
    }

    static void ResetExtractState()
    {
        {
            std::lock_guard<std::mutex> lock(extract_jobs_mutex);
            extract_jobs.clear();
        }

        bool prev_stop_activity = stop_activity;
        stop_activity = false;
        if (FS::FolderExists(EXTRACT_STAGING_ROOT) || FS::FileExists(EXTRACT_STAGING_ROOT))
            FS::RmRecursive(EXTRACT_STAGING_ROOT);
        FS::MkDirs(EXTRACT_STAGING_ROOT);
        stop_activity = prev_stop_activity;
    }

    static void SetExtractGlobals(bool in_progress, const std::string &message)
    {
        activity_inprogess = in_progress;
        file_transfering = in_progress;
        if (in_progress)
        {
            stop_activity = false;
            bytes_transfered = 0;
            bytes_to_download = 0;
            prev_tick = Util::GetTick();
            snprintf(status_message, 1024, "%s", "");
            snprintf(activity_message, 1024, "%s", message.c_str());
            Windows::SetModalMode(true);
        }
        else
        {
            Windows::SetModalMode(false);
        }
    }

    static void *ExtractJobThread(void *argp)
    {
        dbglogger_log("Thread ExtractJobThread started.");
        pthread_detach(pthread_self());

        ExtractThreadArgs *args = static_cast<ExtractThreadArgs *>(argp);
        uint64_t id = args->id;
        std::string item = args->item;
        std::string folder_name = args->folder_name;
        std::string staging_path = args->staging_path;
        std::string final_path = args->final_path;
        int site_idx = args->site_idx;
        delete args;

        UpdateExtractJob(id, EXTRACT_STATE_IN_PROGRESS, "Preparing extraction", "", false);
        snprintf(activity_message, 1024, "Extracting %s", folder_name.c_str());
        FS::MkDirs(EXTRACT_STAGING_ROOT);
        if (FS::FolderExists(staging_path) || FS::FileExists(staging_path))
            FS::RmRecursive(staging_path);
        FS::MkDirs(staging_path);

        DirEntry entry;
        memset(&entry, 0, sizeof(entry));
        snprintf(entry.name, sizeof(entry.name), "%s", BaseName(item).c_str());
        snprintf(entry.path, sizeof(entry.path), "%s", item.c_str());
        entry.isDir = false;

        RemoteClient *client = nullptr;
        int ret = 0;
        if (site_idx >= 0)
        {
            client = GetPooledClient(site_idx);
            if (client == nullptr || !client->IsConnected())
            {
                if (client != nullptr)
                    ReleasePooledClient(site_idx, client);
                std::string error = "Failed to connect to remote site";
                UpdateExtractJob(id, EXTRACT_STATE_FAILED, error, error, true);
                if (FS::FolderExists(staging_path) || FS::FileExists(staging_path))
                    FS::RmRecursive(staging_path);
                SetExtractGlobals(false, "");
                selected_action = ACTION_REFRESH_LOCAL_FILES;
                Util::Notify("%s", error.c_str());
                return NULL;
            }
            ret = ZipUtil::Extract(entry, staging_path, client);
            ReleasePooledClient(site_idx, client);
        }
        else
        {
            ret = ZipUtil::Extract(entry, staging_path);
        }

        if (stop_activity)
        {
            std::string error = "Extraction cancelled";
            UpdateExtractJob(id, EXTRACT_STATE_FAILED, error, error, true);
            stop_activity = false;
            if (FS::FolderExists(staging_path) || FS::FileExists(staging_path))
                FS::RmRecursive(staging_path);
            SetExtractGlobals(false, "");
            selected_action = ACTION_REFRESH_LOCAL_FILES;
            Util::Notify("%s", error.c_str());
            return NULL;
        }

        if (ret <= 0)
        {
            std::string error = ret == -1 ? "Unsupported compressed file format" : "Failed to extract file";
            if (strlen(status_message) > 0)
                error = status_message;
            UpdateExtractJob(id, EXTRACT_STATE_FAILED, error, error, true);
            if (FS::FolderExists(staging_path) || FS::FileExists(staging_path))
                FS::RmRecursive(staging_path);
            SetExtractGlobals(false, "");
            selected_action = ACTION_REFRESH_LOCAL_FILES;
            Util::Notify("Failed to extract %s", folder_name.c_str());
            return NULL;
        }

        if (FS::FolderExists(final_path) || FS::FileExists(final_path))
        {
            std::string error = "Destination already exists: " + final_path;
            UpdateExtractJob(id, EXTRACT_STATE_FAILED, error, error, true);
            if (FS::FolderExists(staging_path) || FS::FileExists(staging_path))
                FS::RmRecursive(staging_path);
            SetExtractGlobals(false, "");
            selected_action = ACTION_REFRESH_LOCAL_FILES;
            Util::Notify("%s", error.c_str());
            return NULL;
        }

        FS::MkDirs(final_path, true);
        errno = 0;
        if (rename(staging_path.c_str(), final_path.c_str()) != 0)
        {
            std::string error = "Failed to move extracted directory: ";
            error += strerror(errno);
            UpdateExtractJob(id, EXTRACT_STATE_FAILED, error, error, true);
            if (FS::FolderExists(staging_path) || FS::FileExists(staging_path))
                FS::RmRecursive(staging_path);
            SetExtractGlobals(false, "");
            selected_action = ACTION_REFRESH_LOCAL_FILES;
            Util::Notify("%s", error.c_str());
            return NULL;
        }

        std::string done = "Extracted to " + final_path;
        UpdateExtractJob(id, EXTRACT_STATE_COMPLETED, done, "", true);
        snprintf(status_message, 1024, "%s", done.c_str());
        SetExtractGlobals(false, "");
        selected_action = ACTION_REFRESH_LOCAL_FILES;
        Util::Notify("%s", done.c_str());
        return NULL;
    }

    static bool StartExtractJob(int site_idx, const std::string &item, const std::string &destination, const std::string &requested_folder, std::string *error, uint64_t *job_id)
    {
        if (item.empty())
        {
            *error = "Required item parameter missing";
            return false;
        }

        if (!IsSafeAbsolutePath(destination))
        {
            *error = "Invalid extraction destination";
            return false;
        }

        if (site_idx >= 0 && (site_idx >= static_cast<int>(sites.size()) || site_settings[sites[site_idx]].server[0] == '\0'))
        {
            *error = "Invalid site_idx";
            return false;
        }

        uint64_t id = Util::GetTick();
        std::string folder_name = SanitizeExtractFolderName(requested_folder, item);
        std::string staging_path = JoinPath(EXTRACT_STAGING_ROOT, folder_name);
        std::string final_path = JoinPath(destination, folder_name);

        ExtractJob job;
        job.id = id;
        job.site_idx = site_idx;
        job.item = item;
        job.folder_name = folder_name;
        job.staging_path = staging_path;
        job.final_path = final_path;
        job.message = "Queued";
        job.error = "";
        job.bytes_transfered = 0;
        job.bytes_to_download = 0;
        job.started_at = id;
        job.finished_at = 0;
        job.state = EXTRACT_STATE_PENDING;

        {
            std::lock_guard<std::mutex> lock(extract_jobs_mutex);
            bool active_extract = activity_inprogess;
            for (const auto &existing_job : extract_jobs)
            {
                if (existing_job.state == EXTRACT_STATE_PENDING || existing_job.state == EXTRACT_STATE_IN_PROGRESS)
                {
                    active_extract = true;
                    break;
                }
            }

            if (active_extract)
            {
                *error = lang_strings[STR_ACTIVITY_IN_PROGRESS_MSG];
                return false;
            }

            extract_jobs.push_back(job);
        }

        SetExtractGlobals(true, "Queued extraction");

        ExtractThreadArgs *args = new ExtractThreadArgs();
        args->id = id;
        args->site_idx = site_idx;
        args->item = item;
        args->folder_name = folder_name;
        args->staging_path = staging_path;
        args->final_path = final_path;

        pthread_t extract_thread;
        int res = pthread_create(&extract_thread, NULL, ExtractJobThread, args);
        if (res != 0)
        {
            delete args;
            SetExtractGlobals(false, "");
            std::string thread_error = "Failed to start extraction thread";
            UpdateExtractJob(id, EXTRACT_STATE_FAILED, thread_error, thread_error, true);
            *error = thread_error;
            return false;
        }

        *job_id = id;
        return true;
    }

    static void ExtractStatusResponse(Response &res)
    {
        json_object *result = json_object_new_object();
        json_object *jobs = json_object_new_array();

        std::lock_guard<std::mutex> lock(extract_jobs_mutex);
        for (auto &job : extract_jobs)
        {
            json_object *job_obj = json_object_new_object();
            uint64_t job_bytes_transfered = job.bytes_transfered;
            uint64_t job_bytes_to_download = job.bytes_to_download;
            std::string job_message = job.message;

            if (job.state == EXTRACT_STATE_IN_PROGRESS)
            {
                job_bytes_transfered = bytes_transfered;
                job_bytes_to_download = bytes_to_download;
                if (strlen(activity_message) > 0)
                    job_message = activity_message;
            }

            json_object_object_add(job_obj, "id", json_object_new_uint64(job.id));
            json_object_object_add(job_obj, "site_idx", json_object_new_int(job.site_idx));
            json_object_object_add(job_obj, "item", json_object_new_string(job.item.c_str()));
            json_object_object_add(job_obj, "folder_name", json_object_new_string(job.folder_name.c_str()));
            json_object_object_add(job_obj, "staging_path", json_object_new_string(job.staging_path.c_str()));
            json_object_object_add(job_obj, "final_path", json_object_new_string(job.final_path.c_str()));
            json_object_object_add(job_obj, "state", json_object_new_int(job.state));
            json_object_object_add(job_obj, "state_text", json_object_new_string(ExtractStateText(job.state)));
            json_object_object_add(job_obj, "message", json_object_new_string(job_message.c_str()));
            json_object_object_add(job_obj, "error", json_object_new_string(job.error.c_str()));
            json_object_object_add(job_obj, "bytes_transfered", json_object_new_uint64(job_bytes_transfered));
            json_object_object_add(job_obj, "bytes_to_download", json_object_new_uint64(job_bytes_to_download));
            json_object_object_add(job_obj, "started_at", json_object_new_uint64(job.started_at / 1000000));
            json_object_object_add(job_obj, "finished_at", json_object_new_uint64(job.finished_at / 1000000));
            json_object_array_add(jobs, job_obj);
        }

        json_object_object_add(result, "success", json_object_new_boolean(true));
        json_object_object_add(result, "error", json_object_new_null());
        json_object_object_add(result, "extracting_dir", json_object_new_string(EXTRACT_STAGING_ROOT));
        json_object_object_add(result, "jobs", jobs);

        json_object *response = json_object_new_object();
        json_object_object_add(response, "result", result);
        const char *response_str = json_object_to_json_string(response);
        res.status = 200;
        res.set_content(response_str, strlen(response_str), "application/json");
        json_object_put(response);
    }

    static void ExtractQueuedResponse(Response &res, uint64_t id)
    {
        json_object *result = json_object_new_object();
        json_object_object_add(result, "success", json_object_new_boolean(true));
        json_object_object_add(result, "error", json_object_new_null());
        json_object_object_add(result, "id", json_object_new_uint64(id));

        json_object *response = json_object_new_object();
        json_object_object_add(response, "result", result);
        const char *response_str = json_object_to_json_string(response);
        res.status = 200;
        res.set_content(response_str, strlen(response_str), "application/json");
        json_object_put(response);
    }

    std::string dump_headers(const Headers &headers)
    {
        std::string s;
        char buf[BUFSIZ];

        for (auto it = headers.begin(); it != headers.end(); ++it)
        {
            const auto &x = *it;
            snprintf(buf, sizeof(buf), "%s: %s\n", x.first.c_str(), x.second.c_str());
            s += buf;
        }

        return s;
    }

    std::string log(const Request &req, const Response &res)
    {
        std::string s;
        char buf[BUFSIZ];

        s += "================================\n";

        snprintf(buf, sizeof(buf), "%s %s %s", req.method.c_str(),
                 req.version.c_str(), req.path.c_str());
        s += buf;

        std::string query;
        for (auto it = req.params.begin(); it != req.params.end(); ++it)
        {
            const auto &x = *it;
            snprintf(buf, sizeof(buf), "%c%s=%s",
                     (it == req.params.begin()) ? '?' : '&', x.first.c_str(),
                     x.second.c_str());
            query += buf;
        }
        snprintf(buf, sizeof(buf), "%s\n", query.c_str());
        s += buf;

        s += dump_headers(req.headers);

        s += "--------------------------------\n";

        snprintf(buf, sizeof(buf), "%d %s\n", res.status, res.version.c_str());
        s += buf;
        s += dump_headers(res.headers);
        s += "\n";

        if (!res.body.empty())
        {
            s += res.body;
        }

        s += "\n";

        return s;
    }

    void failed(Response &res, int status, const std::string &msg)
    {
        res.status = status;
        char response_msg[msg.length() + strlen(FAILURE_MSG) + 2];
        snprintf(response_msg, sizeof(response_msg), "{ \"result\": { \"success\": false, \"error\": \"%s\" } }", msg.c_str());
        res.set_content(response_msg, strlen(response_msg), "application/json");
        return;
    }

    void bad_request(Response &res, const std::string &msg)
    {
        failed(res, 200, msg);
        return;
    }

    void success(Response &res)
    {
        res.status = 200;
        res.set_content(SUCCESS_MSG, SUCCESS_MSG_LEN, "application/json");
        return;
    }

    int CopyOrMove(const DirEntry &src, const char *dest, bool isCopy)
    {
        int ret;
        if (src.isDir)
        {
            int err;
            std::vector<DirEntry> entries = FS::ListDir(src.path, &err);
            FS::MkDirs(dest);
            for (int i = 0; i < entries.size(); i++)
            {
                std::string new_path = std::string(dest) + (FS::hasEndSlash(dest) ? "" : "/") + entries[i].name;
                if (entries[i].isDir)
                {
                    if (strcmp(entries[i].name, "..") == 0)
                        continue;

                    FS::MkDirs(new_path);
                    ret = CopyOrMove(entries[i], new_path.c_str(), isCopy);
                    if (ret <= 0)
                    {
                        return ret;
                    }
                }
                else
                {
                    if (isCopy)
                    {
                        ret = FS::Copy(entries[i].path, new_path.c_str());
                    }
                    else
                    {
                        ret = FS::Move(entries[i].path, new_path.c_str());
                    }
                    if (ret <= 0)
                    {
                        return ret;
                    }
                }
            }
        }
        else
        {
            std::string new_path = std::string(dest) + (FS::hasEndSlash(dest) ? "" : "/") + src.name;
            if (isCopy)
            {
                ret = FS::Copy(src.path, new_path.c_str());
            }
            else
            {
                ret = FS::Move(src.path, new_path.c_str());
            }
            if (ret <= 0)
            {
                return 0;
            }
        }
        return 1;
    }

    static std::mutex client_pool_mutex;
    static std::map<int, std::vector<RemoteClient*>> client_pool;

    RemoteClient* GetPooledClient(int site_idx)
    {
        std::lock_guard<std::mutex> lock(client_pool_mutex);
        auto& pool = client_pool[site_idx];
        if (!pool.empty()) {
            RemoteClient* client = pool.back();
            pool.pop_back();
            return client;
        }
        return INSTALLER::GetRemoteClient(site_idx);
    }

    void ReleasePooledClient(int site_idx, RemoteClient *tmp_client)
    {
        if (site_idx == 98) {
            tmp_client->Quit();
            delete tmp_client;
            return;
        }
        std::lock_guard<std::mutex> lock(client_pool_mutex);
        client_pool[site_idx].push_back(tmp_client);
    }

    static void DeleteRemoteClient(RemoteClient *tmp_client)
    {
        tmp_client->Quit();
        delete tmp_client;
    }

    void *ServerThread(void *argp)
    {
    dbglogger_log("Thread ServerThread started.");
    pthread_detach(pthread_self());
        ResetExtractState();
        auto serve_log_file = [&](const std::string& path, Response &res) {
            if (!FS::FileExists(path.c_str())) {
                res.status = 404;
                res.set_content("Log file not found", "text/plain");
                return;
            }
            FILE *in = FS::OpenRead(path.c_str());
            if (in == nullptr) {
                res.status = 500;
                res.set_content("Could not open log file", "text/plain");
                return;
            }
            size_t size = FS::GetSize(path.c_str());
            std::string content;
            content.resize(size);
            FS::Read(in, (void*)content.data(), size);
            FS::Close(in);
            res.set_content(content, "text/plain");
        };

        svr->Get("/debug/client.log", [&](const Request &req, Response &res)
                 { serve_log_file("/data/homebrew/ezremote-client/client.log", res); });

        svr->Get("/debug/server.log", [&](const Request &req, Response &res)
                 { serve_log_file("/data/homebrew/ezremote-client/server.log", res); });

        svr->Get("/debug/log", [&](const Request &req, Response &res)
                 { res.set_redirect("/debug/client.log"); });

        svr->Get("/", [&](const Request &req, Response &res)
                 { res.set_redirect("/index.html"); });

        svr->Get("/index.html", [&](const Request &req, Response &res)
                 {
            FILE *in = FS::OpenRead("/data/homebrew/ezremote-client/assets/index.html");
            if (in == nullptr) {
                res.status = 404;
                return;
            }
            size_t size = FS::GetSize("/data/homebrew/ezremote-client/assets/index.html");
            res.set_content_provider(
                size, "text/html",
                [in](size_t offset, size_t length, DataSink &sink) {
                    size_t size_to_read = std::min(static_cast<size_t>(length), (size_t)1048576);
                    std::vector<char> buff(size_to_read);
                    size_t read_len;
                    FS::Seek(in, offset);
                    read_len = FS::Read(in, buff.data(), size_to_read);
                    sink.write(buff.data(), read_len);
                    return read_len == size_to_read;
                },
                [in](bool success) {
                    FS::Close(in);
                }); });

        svr->Get("/__local__/tmp_icon.png", [&](const Request &req, Response &res)
                 {
            FILE *in = FS::OpenRead("/data/homebrew/ezremote-client/tmp_icon.png");
            if (!in) {
                res.status = 404;
                return;
            }
            size_t size = FS::GetSize("/data/homebrew/ezremote-client/tmp_icon.png");
            res.set_content_provider(
                size, "image/png",
                [in](size_t offset, size_t length, DataSink &sink) {
                    size_t size_to_read = std::min(static_cast<size_t>(length), (size_t)1048576);
                    std::vector<char> buff(size_to_read);
                    size_t read_len;
                    FS::Seek(in, offset);
                    read_len = FS::Read(in, buff.data(), size_to_read);
                    sink.write(buff.data(), read_len);
                    return read_len == size_to_read;
                },
                [in](bool success) {
                    FS::Close(in);
                }); });

        svr->Get("/favicon.ico", [&](const Request &req, Response &res)
                 {
            FILE *in = FS::OpenRead("/data/homebrew/ezremote-client/assets/favicon.ico");
            if (in == nullptr) {
                res.status = 404;
                return;
            }
            size_t size = FS::GetSize("/data/homebrew/ezremote-client/assets/favicon.ico");
            res.set_content_provider(
                size, "image/vnd.microsoft.icon",
                [in](size_t offset, size_t length, DataSink &sink) {
                    size_t size_to_read = std::min(static_cast<size_t>(length), (size_t)1048576);
                    std::vector<char> buff(size_to_read);
                    size_t read_len;
                    FS::Seek(in, offset);
                    read_len = FS::Read(in, buff.data(), size_to_read);
                    sink.write(buff.data(), read_len);
                    return read_len == size_to_read;
                },
                [in](bool success) {
                    FS::Close(in);
                }); });

        svr->Get("/api/sites", [&](const Request &req, Response &res) {
            json_object *json_sites = json_object_new_array();
            for (size_t i = 0; i < sites.size(); i++) {
                RemoteSettings& s = site_settings[sites[i]];
                if (s.server[0] != '\0') {
                    json_object *site = json_object_new_object();
                    json_object_object_add(site, "index", json_object_new_int(i));
                    json_object_object_add(site, "name", json_object_new_string(s.site_name));
                    json_object_object_add(site, "server", json_object_new_string(s.server));
                    json_object_array_add(json_sites, site);
                }
            }
            json_object *results = json_object_new_object();
            json_object_object_add(results, "result", json_sites);
            const char *results_str = json_object_to_json_string(results);
            res.status = 200;
            res.set_content(results_str, strlen(results_str), "application/json");
            json_object_put(results);
        });

        svr->Post("/api/sitelist", [&](const Request &req, Response &res) {
            const char *path;
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (!jobj) { bad_request(res, "Invalid payload"); return; }
            path = json_object_get_string(json_object_object_get(jobj, "path"));
            int site_idx = json_object_get_int(json_object_object_get(jobj, "site_idx"));
            if (!path) { bad_request(res, "Missing path"); json_object_put(jobj); return; }

            RemoteClient *client = GetPooledClient(site_idx);
            if (!client || !client->IsConnected()) {
                if (client) ReleasePooledClient(site_idx, client);
                bad_request(res, "Failed to connect to remote site");
                json_object_put(jobj);
                return;
            }

            std::vector<DirEntry> files = client->ListDir(path);
            DirEntry::Sort(files);

            json_object *json_files = json_object_new_array();
            for (auto& file : files) {
                if (strcmp(file.name, "..") != 0) {
                    json_object *new_file = json_object_new_object();
                    char display_date[32];
                    sprintf(display_date, "%04d-%02d-%02d %02d:%02d:%02d", file.modified.year, file.modified.month, file.modified.day, file.modified.hours, file.modified.minutes, file.modified.seconds);
                    json_object_object_add(new_file, "name", json_object_new_string(file.name));
                    json_object_object_add(new_file, "rights", json_object_new_string(file.isDir ? "drwxrwxrwx" : "rw-rw-rw-"));
                    json_object_object_add(new_file, "date", json_object_new_string(display_date));
                    json_object_object_add(new_file, "size", json_object_new_string(file.isDir ? "" : std::to_string(file.file_size).c_str()));
                    json_object_object_add(new_file, "type", json_object_new_string(file.isDir ? "dir" : "file"));
                    json_object_array_add(json_files, new_file);
                }
            }
            ReleasePooledClient(site_idx, client);

            json_object *results = json_object_new_object();
            json_object_object_add(results, "result", json_files);
            const char *results_str = json_object_to_json_string(results);
            res.status = 200;
            res.set_content(results_str, strlen(results_str), "application/json");
            json_object_put(results);
            json_object_put(jobj);
        });

        svr->Post("/api/sitedownloaddest", [&](const Request &req, Response &res) {
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (!jobj) { bad_request(res, "Invalid payload"); return; }
            int site_idx = json_object_get_int(json_object_object_get(jobj, "site_idx"));
            const char *path = json_object_get_string(json_object_object_get(jobj, "path"));
            
            RemoteClient *client = GetPooledClient(site_idx);
            if (!client || !client->IsConnected()) {
                if (client) ReleasePooledClient(site_idx, client);
                json_object_put(jobj);
                failed(res, 500, "Connection failed");
                return;
            }

            uint64_t file_size = 0;
            client->Size(path, &file_size);
            ReleasePooledClient(site_idx, client);

            if (site_idx < 0 || site_idx >= sites.size()) {
                json_object_put(jobj);
                failed(res, 500, "Invalid site_idx");
                return;
            }

            RemoteSettings& s = site_settings[sites[site_idx]];
            std::string path_str = path;
            size_t last_slash = path_str.find_last_of('/');
            std::string basename = (last_slash == std::string::npos) ? path_str : path_str.substr(last_slash + 1);
            std::string dest = std::string("/data/homebrew/ezremote-client/") + basename;
            
            uint64_t id = Util::GetTick();
            json_object *params = json_object_new_object();
            json_object_object_add(params, "type", json_object_new_int(s.type));
            json_object_object_add(params, "url", json_object_new_string(s.server));
            json_object_object_add(params, "username", json_object_new_string(s.username));
            json_object_object_add(params, "password", json_object_new_string(s.password));
            json_object_object_add(params, "src_path", json_object_new_string(path));
            json_object_object_add(params, "dest_path", json_object_new_string(dest.c_str()));
            json_object_object_add(params, "size", json_object_new_uint64(file_size));
            json_object_object_add(params, "id", json_object_new_uint64(id));
            if (s.type == CLIENT_TYPE_HTTP_SERVER) {
                json_object_object_add(params, "http_server_type", json_object_new_string(s.http_server_type));
            }
            
            std::string params_payload = json_object_to_json_string(params);
            
            CHTTPClient::HttpResponse resp;
            CHTTPClient::HeadersMap headers;
            CHTTPClient tmp_client([](const std::string& log){});
            tmp_client.InitSession(true, CHTTPClient::SettingsFlag::NO_FLAGS);
            tmp_client.SetCertificateFile(CACERT_FILE);
            headers["Content-Type"] = "application/json";

            std::string download_url = std::string("http://localhost:") + std::to_string(http_int_server_port) + "/download_url";
            bool success_flag = false;
            if (tmp_client.Post(download_url, headers, params_payload.c_str(), resp)) {
                if (HTTP_SUCCESS(resp.iCode)) {
                    bool queued = true;
                    if (!resp.strBody.empty()) {
                        json_object *resp_obj = json_tokener_parse(resp.strBody.data());
                        if (resp_obj) {
                            json_object *result = json_object_object_get(resp_obj, "result");
                            if (result) queued = json_object_get_boolean(json_object_object_get(result, "success"));
                            json_object_put(resp_obj);
                        }
                    }
                    if (queued) {
                        Util::RichNotify(id, "%s queued for download", basename.c_str());
                        success_flag = true;
                    }
                }
            }
            
            json_object_put(params);
            json_object_put(jobj);
            
            if (success_flag) {
                success(res);
            } else {
                Util::RichNotify(id, "Failed to queue %s for download in background", basename.c_str());
                failed(res, 500, "Failed to queue download");
            }
        });

        svr->Post("/api/siteextract", [&](const Request &req, Response &res) {
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (!jobj) { bad_request(res, "Invalid payload"); return; }

            json_object *site_obj = json_object_object_get(jobj, "site_idx");
            const char *item = json_object_get_string(json_object_object_get(jobj, "item"));
            const char *folderName = json_object_get_string(json_object_object_get(jobj, "folderName"));
            if (site_obj == nullptr || item == nullptr)
            {
                bad_request(res, "Required site_idx or item parameter missing");
                json_object_put(jobj);
                return;
            }

            uint64_t job_id = 0;
            std::string error;
            int site_idx = json_object_get_int(site_obj);
            if (!StartExtractJob(site_idx, item, "/data", folderName != nullptr ? folderName : "", &error, &job_id))
            {
                failed(res, 200, error);
                json_object_put(jobj);
                return;
            }

            ExtractQueuedResponse(res, job_id);
            json_object_put(jobj);
        });

        svr->Get("/api/sitedownload", [&](const Request &req, Response &res) {
            if (!req.has_param("site_idx") || !req.has_param("path")) {
                res.status = 400;
                res.set_content("Missing params", "text/plain");
                return;
            }
            int site_idx = std::stoi(req.get_param_value("site_idx"));
            std::string path = req.get_param_value("path");

            RemoteClient *client = GetPooledClient(site_idx);
            if (!client || !client->IsConnected()) {
                if (client) ReleasePooledClient(site_idx, client);
                res.status = 500;
                res.set_content("Connection failed", "text/plain");
                return;
            }

            uint64_t file_size = 0;
            client->Size(path, &file_size);

            res.set_content_provider(
                file_size, "application/octet-stream",
                [client, path](size_t offset, size_t length, DataSink &sink) {
                    return client->GetRange(path, sink, length, offset) == 0;
                },
                [client, site_idx](bool success) {
                    ReleasePooledClient(site_idx, client);
                });
        });

        svr->Post("/api/siteinstall", [&](const Request &req, Response &res) {
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (!jobj) {
                bad_request(res, "Invalid payload");
                return;
            }

            json_object *items = json_object_object_get(jobj, "items");
            json_object *site_idx_obj = json_object_object_get(jobj, "site_idx");
            int site_idx = -1;

            if (site_idx_obj && json_object_get_type(site_idx_obj) != json_type_null) {
                site_idx = json_object_get_int(site_idx_obj);
            }

            if (!items || site_idx < 0) {
                bad_request(res, "Required items or site_idx parameter missing");
                json_object_put(jobj);
                return;
            }

            RemoteClient *client = GetPooledClient(site_idx);
            if (!client || !client->IsConnected()) {
                if (client) ReleasePooledClient(site_idx, client);
                failed(res, 500, "Connection failed");
                json_object_put(jobj);
                return;
            }

            Actions::RemoteInstallJob *job = new Actions::RemoteInstallJob();
            job->client = client;
            job->site_idx = site_idx;
            job->settings = &site_settings[sites[site_idx]];
            job->from_web = true;

            size_t len = json_object_array_length(items);
            for (size_t i=0; i < len; i++) {
                const char *item = json_object_get_string(json_object_array_get_idx(items, i));
                DirEntry entry;
                memset(&entry, 0, sizeof(entry));
                std::string temp = std::string(item);
                size_t slash_pos = temp.find_last_of("/");
                sprintf(entry.name, "%s", temp.substr(slash_pos+1).c_str());
                sprintf(entry.path, "%s", item);
                entry.isDir = false;
                job->files.push_back(entry);
            }

            pthread_t thread_id;
            pthread_create(&thread_id, NULL, Actions::InstallRemotePkgsThread, job);

            success(res);
            json_object_put(jobj);
        });

        svr->Post("/api/sitemkdir", [&](const Request &req, Response &res) {
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (!jobj) { bad_request(res, "Invalid payload"); return; }
            json_object *site_idx_obj = json_object_object_get(jobj, "site_idx");
            json_object *path_obj = json_object_object_get(jobj, "newPath");
            if (!site_idx_obj || !path_obj) { bad_request(res, "Missing parameters"); json_object_put(jobj); return; }
            int site_idx = json_object_get_int(site_idx_obj);
            const char* path = json_object_get_string(path_obj);
            RemoteClient *client = GetPooledClient(site_idx);
            if (!client || !client->IsConnected()) { if (client) ReleasePooledClient(site_idx, client); failed(res, 500, "Connection failed"); json_object_put(jobj); return; }
            int r = client->Mkdir(path);
            ReleasePooledClient(site_idx, client);
            if (r != 0) success(res); else failed(res, 500, "Mkdir failed");
            json_object_put(jobj);
        });

        svr->Post("/api/siterename", [&](const Request &req, Response &res) {
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (!jobj) { bad_request(res, "Invalid payload"); return; }
            json_object *site_idx_obj = json_object_object_get(jobj, "site_idx");
            json_object *oldPath_obj = json_object_object_get(jobj, "oldPath");
            json_object *newPath_obj = json_object_object_get(jobj, "newPath");
            if (!site_idx_obj || !oldPath_obj || !newPath_obj) { bad_request(res, "Missing parameters"); json_object_put(jobj); return; }
            int site_idx = json_object_get_int(site_idx_obj);
            const char* oldPath = json_object_get_string(oldPath_obj);
            const char* newPath = json_object_get_string(newPath_obj);
            RemoteClient *client = GetPooledClient(site_idx);
            if (!client || !client->IsConnected()) { if (client) ReleasePooledClient(site_idx, client); failed(res, 500, "Connection failed"); json_object_put(jobj); return; }
            int r = client->Rename(oldPath, newPath);
            ReleasePooledClient(site_idx, client);
            if (r != 0) success(res); else failed(res, 500, "Rename failed");
            json_object_put(jobj);
        });

        svr->Post("/api/siteremove", [&](const Request &req, Response &res) {
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (!jobj) { bad_request(res, "Invalid payload"); return; }
            json_object *site_idx_obj = json_object_object_get(jobj, "site_idx");
            json_object *items_obj = json_object_object_get(jobj, "items");
            if (!site_idx_obj || !items_obj || json_object_get_type(items_obj) != json_type_array) { bad_request(res, "Missing or invalid parameters"); json_object_put(jobj); return; }
            int site_idx = json_object_get_int(site_idx_obj);
            RemoteClient *client = GetPooledClient(site_idx);
            if (!client || !client->IsConnected()) { if (client) ReleasePooledClient(site_idx, client); failed(res, 500, "Connection failed"); json_object_put(jobj); return; }
            bool all_success = true;
            size_t len = json_object_array_length(items_obj);
            for (size_t i=0; i<len; i++) {
                const char* item = json_object_get_string(json_object_array_get_idx(items_obj, i));
                if (client->Delete(item) == 0) {
                    if (client->Rmdir(item, true) == 0) {
                        all_success = false;
                    }
                }
            }
            ReleasePooledClient(site_idx, client);
            if (all_success) success(res); else failed(res, 500, "Some removes failed");
            json_object_put(jobj);
        });

        svr->Post("/api/pkginfo", [&](const Request &req, Response &res) {
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (!jobj) {
                bad_request(res, "Invalid payload");
                return;
            }

            const char *path = json_object_get_string(json_object_object_get(jobj, "path"));
            json_object *site_idx_obj = json_object_object_get(jobj, "site_idx");
            int site_idx = -1;

            if (site_idx_obj && json_object_get_type(site_idx_obj) != json_type_null) {
                site_idx = json_object_get_int(site_idx_obj);
            }

            if (!path) {
                bad_request(res, "Required path parameter missing");
                json_object_put(jobj);
                return;
            }

            RemoteClient *client = nullptr;
            if (site_idx >= 0) {
                client = GetPooledClient(site_idx);
                if (!client || !client->IsConnected()) {
                    if (client) ReleasePooledClient(site_idx, client);
                    failed(res, 500, "Connection failed");
                    json_object_put(jobj);
                    return;
                }
            }

            std::map<std::string, std::string> sfo_params;
            if (!INSTALLER::GetPkgSfoInfo(path, client, sfo_params)) {
                if (client) ReleasePooledClient(site_idx, client);
                failed(res, 400, "Could not read PKG metadata");
                json_object_put(jobj);
                return;
            }

            std::string title_id = sfo_params["TITLE_ID"];
            std::string icon_url = "";
            if (!title_id.empty()) {
                std::string icon_path = std::string("/data/homebrew/ezremote-client/game-icons/") + title_id + ".png";
                FS::MkDirs("/data/homebrew/ezremote-client/game-icons");
                
                if (!FS::FileExists(icon_path)) {
                    if (client) {
                        INSTALLER::ExtractRemotePkg(client, path, "/data/homebrew/ezremote-client/temp.sfo", icon_path);
                    } else {
                        INSTALLER::ExtractLocalPkg(path, "/data/homebrew/ezremote-client/temp.sfo", icon_path);
                    }
                }

                if (FS::FileExists(icon_path)) {
                    icon_url = "/game-icons/" + title_id + ".png";
                }
            }

            if (client) {
                ReleasePooledClient(site_idx, client);
            }

            json_object *res_obj = json_object_new_object();
            for (auto const& [key, val] : sfo_params) {
                json_object_object_add(res_obj, key.c_str(), json_object_new_string(val.c_str()));
            }
            if (!icon_url.empty()) {
                json_object_object_add(res_obj, "ICON_URL", json_object_new_string(icon_url.c_str()));
            }

            const char *res_str = json_object_to_json_string(res_obj);
            res.status = 200;
            res.set_content(res_str, strlen(res_str), "application/json");

            json_object_put(res_obj);
            json_object_put(jobj);
        });

        svr->Post("/__local__/list", [&](const Request &req, Response &res)
        {
            const char *path;
            bool onlyFolders = false;
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                path = json_object_get_string(json_object_object_get(jobj, "path"));
                const char *onlyFolders_text = json_object_get_string(json_object_object_get(jobj, "onlyFolders"));
                if (onlyFolders_text != nullptr && strcasecmp(onlyFolders_text, "true")==0)
                    onlyFolders = true;
                if (path == nullptr)
                {
                    bad_request(res, "Required path parameter missing");
                    json_object_put(jobj);
                    return;
                }
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            int err;
            std::vector<DirEntry> files = FS::ListDir(path, &err);
            DirEntry::Sort(files);
            json_object *json_files = json_object_new_array();
            for (std::vector<DirEntry>::iterator it = files.begin(); it != files.end();)
            {
                if (((onlyFolders && it->isDir) || !onlyFolders) && strcmp(it->name, "..") != 0)
                {
                    json_object *new_file = json_object_new_object();
                    char display_date[32];
                    sprintf(display_date, "%04d-%02d-%02d %02d:%02d:%02d", it->modified.year, it->modified.month, it->modified.day, it->modified.hours, it->modified.minutes, it->modified.seconds);
                    json_object_object_add(new_file, "name", json_object_new_string(it->name));
                    json_object_object_add(new_file, "rights", json_object_new_string(it->isDir ? "drwxrwxrwx" : "rw-rw-rw-"));
                    json_object_object_add(new_file, "date", json_object_new_string(display_date));
                    json_object_object_add(new_file, "size", json_object_new_string(it->isDir ? "" : std::to_string(it->file_size).c_str()));
                    json_object_object_add(new_file, "type", json_object_new_string(it->isDir ? "dir" : "file"));
                    json_object_array_add(json_files, new_file);
                }
                it++;
            }
            json_object *results = json_object_new_object();
            json_object_object_add(results, "result", json_files);
            const char *results_str = json_object_to_json_string(results);

            res.status = 200;
            res.set_content(results_str, strlen(results_str), "application/json");
            json_object_put(results);
            json_object_put(jobj); });

        svr->Post("/__local__/rename", [&](const Request &req, Response &res)
        {
            const char *item;
            const char *newItemPath;
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                item = json_object_get_string(json_object_object_get(jobj, "item"));
                newItemPath = json_object_get_string(json_object_object_get(jobj, "newItemPath"));
                if (item == nullptr || newItemPath == nullptr)
                {
                    bad_request(res, "Required item or newItemPath parameter missing");
                    json_object_put(jobj);
                    return;
                }
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            FS::Rename(item, newItemPath);
            success(res);
            json_object_put(jobj);
            return; });

        svr->Post("/__local__/move", [&](const Request &req, Response &res)
        {
            if (activity_inprogess)
            {
                failed(res, 200, lang_strings[STR_ACTIVITY_IN_PROGRESS_MSG]);
                return;
            }

            const json_object *items;
            const char *newPath;
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                items = json_object_object_get(jobj, "items");
                newPath = json_object_get_string(json_object_object_get(jobj, "newPath"));
                if (items == nullptr || newPath == nullptr)
                {
                    bad_request(res, "Required items or newPath parameter missing");
                    json_object_put(jobj);
                    return;
                }
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            std::string failed_items;
            size_t len = json_object_array_length(items);
            for (size_t i=0; i < len; i++)
            {
                const char *item = json_object_get_string(json_object_array_get_idx(items, i));
                DirEntry entry;
                std::string temp = std::string(item);
                size_t slash_pos = temp.find_last_of("/");
                sprintf(entry.name, "%s", temp.substr(slash_pos+1).c_str());
                sprintf(entry.path, "%s", item);
                entry.isDir = FS::IsFolder(item);
                std::string new_path = std::string(newPath);
                if (entry.isDir)
                    new_path =  new_path + "/" + entry.name;
                bool ret = CopyOrMove(entry, new_path.c_str(), false);
                if (!ret)
                {
                    failed_items += std::string(item) + ",";
                }
                if (entry.isDir && ret)
                {
                    FS::RmRecursive(item);
                }
            }

            if (failed_items.length() > 0)
            {
                std::string error_msg = std::string("One or more file(s) failed to move. ") + failed_items;
                failed(res, 200, error_msg);
            }
            else
                success(res);
            json_object_put(jobj); });

        svr->Post("/__local__/copy", [&](const Request &req, Response &res)
        {
            if (activity_inprogess)
            {
                failed(res, 200, lang_strings[STR_ACTIVITY_IN_PROGRESS_MSG]);
                return;
            }

            const json_object *items;
            const char *newPath;
            const char *singleFilename;

            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                items = json_object_object_get(jobj, "items");
                newPath = json_object_get_string(json_object_object_get(jobj, "newPath"));
                singleFilename = json_object_get_string(json_object_object_get(jobj, "singleFilename"));

                if (items == nullptr || newPath == nullptr)
                {
                    bad_request(res, "Required items or newPath or singleFilename parameter missing");
                    json_object_put(jobj);
                    return;
                }
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            std::string failed_items;
            if (singleFilename != nullptr)
            {
                const char *src = json_object_get_string(json_object_array_get_idx(items, 0));
                std::string dest = std::string(newPath) + "/" + singleFilename;

                std::string temp = std::string(src);
                size_t slash_pos = temp.find_last_of("/");
                DirEntry entry;
                sprintf(entry.name, "%s", temp.substr(slash_pos+1).c_str());
                sprintf(entry.path, "%s", src);
                entry.isDir = FS::IsFolder(src);
                if (entry.isDir)
                if (dest.compare(src) != 0 && !CopyOrMove(entry, dest.c_str(), true))
                {
                    failed_items += src;
                }
            }
            else
            {
                size_t len = json_object_array_length(items);
                for (size_t i=0; i < len; i++)
                {
                    const char *item = json_object_get_string(json_object_array_get_idx(items, i));
                    DirEntry entry;
                    std::string temp = std::string(item);
                    size_t slash_pos = temp.find_last_of("/");
                    sprintf(entry.name, "%s", temp.substr(slash_pos+1).c_str());
                    sprintf(entry.path, "%s", item);
                    entry.isDir = FS::IsFolder(item);
                    std::string new_path = std::string(newPath);
                    if (entry.isDir)
                        new_path =  new_path + "/" + entry.name;
                    bool ret = CopyOrMove(entry, new_path.c_str(), true);
                    if (!ret)
                    {
                        failed_items += std::string(item) + ",";
                    }
                }
            }

            if (failed_items.length() > 0)
            {
                std::string error_msg = std::string("One or more file(s) failed to copy. ") + failed_items;
                failed(res, 200, error_msg);
            }
            else
                success(res);
            json_object_put(jobj); });

        svr->Post("/__local__/remove", [&](const Request &req, Response &res)
        {
            if (activity_inprogess)
            {
                failed(res, 200, lang_strings[STR_ACTIVITY_IN_PROGRESS_MSG]);
                return;
            }

            json_object *items;
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                items = json_object_object_get(jobj, "items");
                if (items == nullptr)
                {
                    bad_request(res, "Required items parameter missing");
                    json_object_put(jobj);
                    return;
                }
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            std::string failed_items;
            size_t len = json_object_array_length(items);
            for (size_t i=0; i < len; i++)
            {
                const char *item = json_object_get_string(json_object_array_get_idx(items, i));
                bool ret = FS::RmRecursive(item);
                if (!ret)
                {
                    failed_items += std::string(item) + ",";
                }
            }

            if (failed_items.length() > 0)
            {
                std::string error_msg = std::string("One or more file(s) failed to delete. ") + failed_items;
                failed(res, 200, error_msg);
            }
            else
                success(res);
            json_object_put(jobj); });

        svr->Post("/__local__/install", [&](const Request &req, Response &res)
        {
            if (activity_inprogess)
            {
                failed(res, 200, lang_strings[STR_ACTIVITY_IN_PROGRESS_MSG]);
                return;
            }

            json_object *items;
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                items = json_object_object_get(jobj, "items");
                if (items == nullptr)
                {
                    bad_request(res, "Required items parameter missing");
                    json_object_put(jobj);
                    return;
                }
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            std::string failed_items;
            size_t len = json_object_array_length(items);
            for (size_t i=0; i < len; i++)
            {
                const char *item = json_object_get_string(json_object_array_get_idx(items, i));
                if (!INSTALLER::InstallLocalPkg(item))
                    failed_items += (std::string(item) + ",");
            }

            if (failed_items.length() > 0)
            {
                std::string error_msg = std::string("One or more file(s) failed to install. ") + failed_items;
                failed(res, 200, error_msg);
            }
            else
                success(res);
            json_object_put(jobj);
        });

        svr->Post("/__local__/edit", [&](const Request &req, Response &res)
        {
            const char *item;
            const char *content;
            size_t content_len;
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                item = json_object_get_string(json_object_object_get(jobj, "item"));
                json_object *content_obj = json_object_object_get(jobj, "content");
                content = json_object_get_string(content_obj);
                content_len = json_object_get_string_len(content_obj);
                if (item == nullptr || content == nullptr)
                {
                    bad_request(res, "Required item or content parameter missing");
                    json_object_put(jobj);
                    return;
                }
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            bool ret = FS::Save(item, content, content_len);
            if (!ret)
            {
                failed(res, 200, "Failed to save content to file.");
                json_object_put(jobj);
                return;
            }

            success(res);
            json_object_put(jobj); });

        svr->Post("/__local__/getContent", [&](const Request &req, Response &res)
        {
            const char *item;
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                item = json_object_get_string(json_object_object_get(jobj, "item"));
                if (item == nullptr)
                {
                    bad_request(res, "Required item parameter missing");
                    json_object_put(jobj);
                    return;
                }
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            std::vector<char> content = FS::Load(item);
            json_object *result = json_object_new_object();
            json_object_object_add(result, "result", json_object_new_string(content.data()));
            const char *result_str = json_object_to_json_string(result);

            res.status = 200;
            res.set_content(result_str, strlen(result_str), "application/json");
            json_object_put(result);
            json_object_put(jobj);
        });

        svr->Post("/__local__/createFolder", [&](const Request &req, Response &res)
        {
            const char *newPath;
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                newPath = json_object_get_string(json_object_object_get(jobj, "newPath"));
                if (newPath == nullptr)
                {
                    bad_request(res, "Required newPath parameter missing");
                    json_object_put(jobj);
                    return;
                }
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            FS::MkDirs(newPath);
            success(res);
            json_object_put(jobj); });

        svr->Post("/__local__/permission", [&](const Request &req, Response &res)
                  { failed(res, 200, "Operation not supported"); });

        svr->Post("/__local__/compress", [&](const Request &req, Response &res)
        {
            if (activity_inprogess)
            {
                failed(res, 200, lang_strings[STR_ACTIVITY_IN_PROGRESS_MSG]);
                return;
            }

            json_object *items;
            const char* destination;
            const char* compressedFilename;
            
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                items = json_object_object_get(jobj, "items");
                destination = json_object_get_string(json_object_object_get(jobj, "destination"));
                compressedFilename = json_object_get_string(json_object_object_get(jobj, "compressedFilename"));

                if (items == nullptr || destination == nullptr || compressedFilename == nullptr)
                {
                    bad_request(res, "Required items,destination,compressedFilename parameter missing");
                    json_object_put(jobj);
                    return;
                }
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            if (!FS::FolderExists(compressed_file_path))
                FS::MkDirs(compressed_file_path);
            std::string zip_file = std::string(compressed_file_path) + "/" + compressedFilename;
            zipFile zf = zipOpen64(zip_file.c_str(), APPEND_STATUS_CREATE);
            if (zf != NULL)
            {
                size_t len = json_object_array_length(items);
                for (size_t i=0; i < len; i++)
                {
                    const char *item = json_object_get_string(json_object_array_get_idx(items, i));
                    std::string src = std::string(item);
                    size_t slash_pos = src.find_last_of("/");
                    int ret = ZipUtil::ZipAddPath(zf, src, (slash_pos != std::string::npos ? slash_pos + 1 : 1), Z_DEFAULT_COMPRESSION);
                    if (ret != 1)
                    {
                        zipClose(zf, NULL);
                        FS::Rm(zip_file);
                        failed(res, 200, "Failed to create zip");
                    }
                }
                zipClose(zf, NULL);
                success(res);
            }
            else
            {
                failed(res, 200, "Failed to create zip");
            }
            json_object_put(jobj); });

        svr->Post("/__local__/extract", [&](const Request &req, Response &res)
        {
            const char* item;
            const char* destination;
            const char* folderName;
            
            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                item = json_object_get_string(json_object_object_get(jobj, "item"));
                destination = json_object_get_string(json_object_object_get(jobj, "destination"));
                folderName = json_object_get_string(json_object_object_get(jobj, "folderName"));

                if (item == nullptr || destination == nullptr || folderName == nullptr)
                {
                    bad_request(res, "Required item,destination,folderName parameter missing");
                    json_object_put(jobj);
                    return;
                }
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            uint64_t job_id = 0;
            std::string error;
            if (!StartExtractJob(-1, item, destination, folderName, &error, &job_id))
            {
                failed(res, 200, error);
                json_object_put(jobj);
                return;
            }

            ExtractQueuedResponse(res, job_id);
            json_object_put(jobj); });

        svr->Get("/__local__/extract/status", [&](const Request &req, Response &res)
        {
            ExtractStatusResponse(res);
        });

        svr->Get("/api/extract/status", [&](const Request &req, Response &res)
        {
            ExtractStatusResponse(res);
        });

        svr->Get("/__local__/uploadResumeSize", [&](const Request &req, Response &res)
        {
            std::string destination = req.get_param_value("destination");
            std::string filename = req.get_param_value("filename");
            std::string file_path = destination + "/" + filename;
            int64_t size = 0;
            if (FS::FileExists(file_path))
                size = FS::GetSize(file_path);
            std::string result_str = "{\"size\":" + std::to_string(size) + "}";
            res.status = 200;
            res.set_content(result_str.c_str(), result_str.length(), "application/json"); });

        svr->Post("/__local__/upload", [&](const Request &req, Response &res, const ContentReader &content_reader)
        {
            auto start_time = std::chrono::high_resolution_clock::now();
            int64_t disk_write_time_ms = 0;
            int64_t network_read_time_ms = 0;
            int64_t file_open_time_ms = 0;
            int64_t file_close_time_ms = 0;
            
            MultipartFormDataItems items;
            std::string destination;
            size_t chunk_size = 0;
            size_t chunk_number = -1;
            size_t total_size = 0;
            size_t currentChunkSize = 0;
            int out_fd = -1;
            std::string new_file;
            bool upload_failed = false;
            bool saw_file = false;
            std::string upload_error;
            size_t total_disk_bytes = 0;

            auto fail_upload = [&](const std::string &msg) {
                upload_failed = true;
                if (upload_error.empty())
                    upload_error = msg;
                return false;
            };

            auto read_start = std::chrono::high_resolution_clock::now();
            bool read_ok = content_reader(
                [&](const MultipartFormData &item)
                {
                    if (upload_failed) return false;
                    
                    items.push_back(item);
                    if (item.name == "file")
                    {
                        saw_file = true;
                        if (item.filename.empty())
                            return fail_upload("Upload filename is missing.");

                        if (destination.empty())
                            return fail_upload("Upload destination is missing.");

                        new_file = destination + "/" + item.filename;
                        
                        auto open_start = std::chrono::high_resolution_clock::now();
                        if (chunk_number == static_cast<size_t>(-1) || chunk_number == 0)
                            out_fd = open(new_file.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0666);
                        else if (chunk_number > 0)
                            out_fd = open(new_file.c_str(), O_WRONLY | O_CREAT | O_APPEND, 0666);
                        auto open_end = std::chrono::high_resolution_clock::now();
                        file_open_time_ms += std::chrono::duration_cast<std::chrono::milliseconds>(open_end - open_start).count();

                        if (out_fd == -1)
                            return fail_upload("Failed to open upload destination.");
                    }
                    return true;
                },
                [&](const char *data, size_t data_length)
                {
                    if (upload_failed) return false;
                    
                    if (items.empty()) return fail_upload("Invalid multipart upload data.");

                    if (items.back().name != "file")
                    {
                        items.back().content.append(data, data_length);
                        
                        if (items.back().name == "destination") {
                            destination = items.back().content;
                        } else if (items.back().name == "_chunkNumber") {
                            std::stringstream ss(items.back().content);
                            ss >> chunk_number;
                        }
                    }
                    else
                    {
                        if (out_fd != -1 && data_length > 0)
                        {
                            auto write_start = std::chrono::high_resolution_clock::now();
                            int written = write(out_fd, data, data_length);
                            auto write_end = std::chrono::high_resolution_clock::now();
                            disk_write_time_ms += std::chrono::duration_cast<std::chrono::milliseconds>(write_end - write_start).count();
                            
                            if (written != static_cast<int>(data_length)) {
                                return fail_upload("Failed to write uploaded file data.");
                            }
                            total_disk_bytes += written;
                        }
                    }
                    return true;
                });
            
            auto read_end = std::chrono::high_resolution_clock::now();
            network_read_time_ms = std::chrono::duration_cast<std::chrono::milliseconds>(read_end - read_start).count();

            if (!read_ok || upload_failed || !saw_file)
            {
                if (out_fd != -1)
                {
                    close(out_fd);
                    out_fd = -1;
                }

                if (upload_error.empty()) {
                    upload_error = res.status == 413 ? "Upload payload is too large." : "Failed to read uploaded file data.";
                }

                failed(res, 200, upload_error);
                return;
            }

            if (out_fd != -1)
            {
                auto close_start = std::chrono::high_resolution_clock::now();
                close(out_fd);
                auto close_end = std::chrono::high_resolution_clock::now();
                file_close_time_ms += std::chrono::duration_cast<std::chrono::milliseconds>(close_end - close_start).count();
            }
            auto end_time = std::chrono::high_resolution_clock::now();
            auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end_time - start_time).count();
            
            std::string result_str = "{ \"result\": { \"success\": true, \"error\": null, "
                                     "\"duration_ms\": " + std::to_string(duration) + ", "
                                     "\"disk_write_time_ms\": " + std::to_string(disk_write_time_ms) + ", "
                                     "\"network_read_time_ms\": " + std::to_string(network_read_time_ms) + ", "
                                     "\"file_open_time_ms\": " + std::to_string(file_open_time_ms) + ", "
                                     "\"file_close_time_ms\": " + std::to_string(file_close_time_ms) + ", "
                                     "\"total_disk_bytes\": " + std::to_string(total_disk_bytes) + 
                                     "} }";
            res.status = 200;
            res.set_content(result_str.c_str(), result_str.length(), "application/json"); });

        // Download multiple files as ZIP
        svr->Get("/__local__/downloadMultiple", [&](const Request &req, Response &res)
        {
            if (req.get_param_value_count("items") == 0 || req.get_param_value_count("toFilename") == 0)
            {
                failed(res, 200, "Required items and toFilename parameter missing");
                return;
            }

            if (!FS::FolderExists(compressed_file_path))
                FS::MkDirs(compressed_file_path);

            std::string toFilename = req.get_param_value("toFilename");
            std::string zip_file = std::string(compressed_file_path) + "/" + toFilename;
            zipFile zf = zipOpen64(zip_file.c_str(), APPEND_STATUS_CREATE);
            if (zf != NULL)
            {
                int items_count = req.get_param_value_count("items");
                for (size_t i=0; i < items_count; i++)
                {
                    std::string src = req.get_param_value("items", i);
                    size_t slash_pos = src.find_last_of("/");
                    int ret = ZipUtil::ZipAddPath(zf, src, (slash_pos != std::string::npos ? slash_pos + 1 : 1), Z_DEFAULT_COMPRESSION);
                    if (ret != 1)
                    {
                        zipClose(zf, NULL);
                        FS::Rm(zip_file);
                        failed(res, 200, "Failed to create zip file");
                        return;
                    }
                }
                zipClose(zf, NULL);

                // start stream the zip
                FILE *in = FS::OpenRead(zip_file);
                if (in == nullptr)
                {
                    FS::Rm(zip_file);
                    failed(res, 200, "Failed to open zip file");
                    return;
                }
                uint64_t size = FS::GetSize(zip_file);
                res.set_header("Content-Disposition", "attachment; filename=\"" + std::string(toFilename) + "\"");
                res.set_content_provider(
                    size, "application/octet-stream",
                    [in](size_t offset, size_t length, DataSink &sink) {
                        size_t size_to_read = std::min(static_cast<size_t>(length), (size_t)1048576);
                        std::vector<char> buff(size_to_read);
                        size_t read_len;
                        FS::Seek(in, offset);
                        read_len = FS::Read(in, buff.data(), size_to_read);
                        sink.write(buff.data(), read_len);
                        return read_len == size_to_read;
                    },
                    [in, zip_file](bool success) {
                        FS::Close(in);
                        FS::Rm(zip_file);
                    });
            }
            else
            {
                failed(res, 200, "Failed to create zip");
            } });

        // Download single file
        svr->Get("/__local__/downloadFile", [&](const Request &req, Response &res)
        {
            std::string path = req.get_param_value("path", 0);
            if (path.empty())
            {
                bad_request(res, "Failed to download");
                return;
            }

            int64_t size = FS::GetSize(path);
            FILE *in = FS::OpenRead(path);
            if (in == nullptr || size < 0)
            {
                bad_request(res, "Failed to download");
                return;
            }

            size_t slash_pos = path.find_last_of("/");
            std::string name = path;
            if (slash_pos != std::string::npos)
                name = path.substr(slash_pos+1);

            res.set_header("Content-Disposition", "attachment; filename=\"" + name + "\"");
            res.set_content_provider(
                size, "application/octet-stream",
                [in](size_t offset, size_t length, DataSink &sink) {
                    size_t size_to_read = std::min(static_cast<size_t>(length), (size_t)1048576);
                    std::vector<char> buff(size_to_read);
                    size_t read_len;
                    FS::Seek(in, offset);
                    read_len = FS::Read(in, buff.data(), size_to_read);
                    sink.write(buff.data(), read_len);
                    return read_len == size_to_read;
                },
                [in](bool success) {
                    FS::Close(in);
                }); });

        svr->Get("/google_auth", [](const Request &req, Response &res)
        {
            /* std::string auth_code = req.get_param_value("code");
            Client client(GOOGLE_OAUTH_HOST);
            client.set_follow_location(true);
            client.enable_server_certificate_verification(false);
            
            std::string url = std::string("/token");
            std::string post_data = std::string("code=") + auth_code +
                                                "&client_id=" + gg_app.client_id +
                                                "&client_secret=" + gg_app.client_secret +
                                                "&redirect_uri=http%3A//localhost%3A" + std::to_string(http_server_port) + "/google_auth"
                                                "&grant_type=authorization_code";
                            
            if (auto result = client.Post(url, post_data.c_str(), post_data.length(),  "application/x-www-form-urlencoded"))
            {
                if (HTTP_SUCCESS(result->status))
                {
                    json_object *jobj = json_tokener_parse(result.value().body.c_str());
                    enum json_type type;
                    json_object_object_foreach(jobj, key, val)
                        {
                            if (strcmp(key, "access_token")==0)
                                snprintf(remote_settings->gg_account.access_token, 255, "%s", json_object_get_string(val));
                            else if (strcmp(key, "refresh_token")==0)
                                snprintf(remote_settings->gg_account.refresh_token, 255, "%s", json_object_get_string(val));
                            else if (strcmp(key, "expires_in")==0)
                            {
                                OrbisTick tick;
                                sceRtcGetCurrentTick(&tick);
                                remote_settings->gg_account.token_expiry = tick.mytick + (json_object_get_uint64(val)*1000000);
                            }
                        }
                    CONFIG::SaveConfig();
                    login_state = 1;
                    res.set_content(lang_strings[STR_GET_TOKEN_SUCCESS_MSG], "text/plain");
                    return;
                }
                else
                {
                    login_state = -1;
                    std::string str = std::string(lang_strings[STR_FAIL_GET_TOKEN_MSG]) + " Google";
                    res.set_content(str.c_str(), "text/plain");
                }
            }
            login_state = -1;
            std::string str = std::string(lang_strings[STR_FAIL_GET_TOKEN_MSG]) + " Google";
            res.set_content(str.c_str(), "text/plain"); */
        });

        svr->Get("/rmt_inst/Site (\\d+)(/)(.*)", [&](const Request &req, Response &res)
        {
            RemoteClient *tmp_client = nullptr;
            auto site_idx = std::stoi(req.matches[1])-1;
            std::string path;
            if (site_idx != 98)
            {
                path = std::string("/") + std::string(req.matches[3]);
                tmp_client = GetPooledClient(site_idx);
            }
            else
            {
                std::string hash = std::string(req.matches[3]);
                std::string url = FileHost::GetCachedDownloadUrl(hash);
                size_t scheme_pos = url.find("://");
                size_t root_pos = url.find("/", scheme_pos + 3);
                std::string host = url.substr(0, root_pos);
                path = url.substr(root_pos);

                tmp_client = new BaseClient();
                tmp_client->Connect(host, "", "", false);
            }

            uint64_t file_size = 0;
            tmp_client->Size(path, &file_size);

            res.set_content_provider(
                file_size, "application/octet-stream",
                [tmp_client, path](size_t offset, size_t length, DataSink &sink) {
                    int ret;
                    ret = tmp_client->GetRange(path, sink, length, offset);
                    return (ret==1);
                },
                [tmp_client, site_idx](bool success) {
                    ReleasePooledClient(site_idx, tmp_client);
                });
        });

        svr->Get("/archive_inst/(.*)", [&](const Request &req, Response &res)
        {
            std::string hash = req.matches[1];
            ArchivePkgInstallData *pkg_data = INSTALLER::GetArchivePkgInstallData(hash);

            res.set_content_provider(
                pkg_data->archive_entry->filesize, "application/octet-stream",
                [pkg_data](size_t offset, size_t length, DataSink &sink) {
                    size_t size_to_read = std::min(static_cast<size_t>(length), (size_t)1048576);
                    std::vector<char> buf(size_to_read);
                    ssize_t bytes_read = pkg_data->split_file->Read(buf.data(), size_to_read, offset);
                    if (bytes_read < 0)
                        return false;
                    if (bytes_read > 0 && !sink.write(buf.data(), static_cast<size_t>(bytes_read)))
                        return false;
                    return static_cast<size_t>(bytes_read) == size_to_read;
                },
                [](bool success) {
                    return true;
                });
        });

        svr->Get("/split_inst/(.*)", [&](const Request &req, Response &res)
        {
            std::string hash = req.matches[1];

            SplitPkgInstallData *pkg_data = INSTALLER::GetSplitPkgInstallData(hash);

            if (pkg_data == nullptr)
            {
                failed(res, 500, "Cannot resume split_inst");
                return;
            }

            res.set_content_provider(
                pkg_data->size, "application/octet-stream",
                [pkg_data](size_t offset, size_t length, DataSink &sink) {
                    size_t size_to_read = std::min(static_cast<size_t>(length), (size_t)1048576);
                    std::vector<char> buf(size_to_read);
                    ssize_t bytes_read = pkg_data->split_file->Read(buf.data(), size_to_read, offset);
                    if (bytes_read < 0)
                        return false;
                    if (bytes_read > 0 && !sink.write(buf.data(), static_cast<size_t>(bytes_read)))
                        return false;
                    return static_cast<size_t>(bytes_read) == size_to_read;
                },
                [](bool success) {
                    return true;
                });
        });

        svr->Post("/__local__/install_url", [&](const Request &req, Response &res)
        {
            if (activity_inprogess)
            {
                failed(res, 200, lang_strings[STR_ACTIVITY_IN_PROGRESS_MSG]);
                return;
            }

            std::string url;
            const char *url_param;
            bool use_alldebrid = false;
            bool use_realdebrid = false;
            bool use_disk_cache = false;
            bool enable_rpi = false;

            std::string username = "";
            std::string password = "";

            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                url_param = json_object_get_string(json_object_object_get(jobj, "url"));
                use_alldebrid  = json_object_get_boolean(json_object_object_get(jobj, "use_alldebrid"));
                use_realdebrid = json_object_get_boolean(json_object_object_get(jobj, "use_realdebrid"));
                use_disk_cache = json_object_get_boolean(json_object_object_get(jobj, "use_disk_cache"));
                enable_rpi = json_object_get_boolean(json_object_object_get(jobj, "enable_rpi"));
                
                json_object *user_obj = json_object_object_get(jobj, "username");
                if (user_obj) username = json_object_get_string(user_obj);

                json_object *pass_obj = json_object_object_get(jobj, "password");
                if (pass_obj) password = json_object_get_string(pass_obj);

                if (url_param == nullptr)
                {
                    bad_request(res, "Required url_param parameter missing");
                    json_object_put(jobj);
                    return;
                }

                url = std::string(url_param);
                json_object_put(jobj);
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            if ((use_alldebrid && strlen(alldebrid_api_key) == 0) || (use_realdebrid && strlen(realdebrid_api_key) == 0))
            {
                failed(res, 200, lang_strings[STR_ALLDEBRID_API_KEY_MISSING_MSG]);
                return;
            }

            if (!INSTALLER::IsDirectPackageInstallerEnabled())
            {
                failed(res, 200, lang_strings[STR_DPI_NOT_STARTED_ERROR_MSG]);
                return;
            }
            FileHost *filehost = FileHost::getFileHost(url, use_alldebrid, use_realdebrid);

            if (!filehost->IsValidUrl())
            {
                delete(filehost);
                failed(res, 200, lang_strings[STR_INVALID_URL]);
                return;
            }

            std::string hash = Util::UrlHash(filehost->GetUrl());
            snprintf(activity_message, 1023, "%s %s", lang_strings[STR_INSTALLING], filehost->GetUrl().c_str());
            activity_inprogess = true;
            file_transfering = true;
            bytes_to_download = 100;
            bytes_transfered = 0;
            prev_tick = Util::GetTick();

            Windows::SetModalMode(true);

            std::string download_url = filehost->GetDownloadUrl();
            if (download_url.empty())
            {
                failed(res, 200, lang_strings[STR_CANT_EXTRACT_URL_MSG]);
                activity_inprogess = false;
                file_transfering = false;
                Windows::SetModalMode(false);
                return;
            }
            delete(filehost);

			size_t scheme_pos = download_url.find("://");
			size_t root_pos = download_url.find("/", scheme_pos + 3);
			std::string host = download_url.substr(0, root_pos);
			std::string path = download_url.substr(root_pos);
            pkg_header header;

            BaseClient *baseclient = new BaseClient();
            baseclient->Connect(host, username, password);
            auto cleanup_baseclient = [&]() {
                if (baseclient != nullptr)
                {
                    baseclient->Quit();
                    delete baseclient;
                    baseclient = nullptr;
                }
            };
            
            if (!baseclient->FileExists(path))
            {
                failed(res, 200, baseclient->LastResponse());
                cleanup_baseclient();
                activity_inprogess = false;
                file_transfering = false;
                Windows::SetModalMode(false);
                return;
            }
            baseclient->Head(path, &header, sizeof(pkg_header));

            FileHost::AddCacheDownloadUrl(hash, download_url);
            std::string title = INSTALLER::GetRemotePkgTitle(baseclient, path, &header);

            if (BE32(header.pkg_magic) == 0x7F434E54)
            {
                if (enable_rpi && !use_disk_cache)
                {
                    std::string remote_install_url = download_url;
                    bool can_passthrough = username.empty() && password.empty() && INSTALLER::CanDirectDownloadUrl(download_url);
                    bool needs_redirect = can_passthrough && !INSTALLER::IsSafeDirectInstallUrl(download_url);
                    
                    if (!enable_direct_download_redirect) {
                        needs_redirect = false;
                        can_passthrough = INSTALLER::IsSafeDirectInstallUrl(download_url);
                    }

                    if (can_passthrough && !needs_redirect)
                    {
                        remote_install_url = download_url;
                    }
                    else
                    {
                        json_object *history_item_obj = json_object_new_object();
                        uint64_t file_size = 0;
                        baseclient->Size(path, &file_size);

                        json_object_object_add(history_item_obj, "hash", json_object_new_string(hash.c_str()));
                        json_object_object_add(history_item_obj, "url", json_object_new_string(host.c_str()));
                        json_object_object_add(history_item_obj, "path", json_object_new_string(path.c_str()));
                        json_object_object_add(history_item_obj, "username", json_object_new_string(username.c_str()));
                        json_object_object_add(history_item_obj, "password", json_object_new_string(password.c_str()));
                        json_object_object_add(history_item_obj, "type", json_object_new_int(CLIENT_TYPE_FILEHOST));
                        json_object_object_add(history_item_obj, "size", json_object_new_uint64(file_size));
                        
                        if (needs_redirect) {
                            json_object_object_add(history_item_obj, "direct_url", json_object_new_string(download_url.c_str()));
                        }

                        const char *params_str = json_object_to_json_string(history_item_obj);

                        CHTTPClient::HttpResponse resp;
                        CHTTPClient::HeadersMap headers;
                        CHTTPClient tmp_client([](const std::string& log){});
                        tmp_client.InitSession(true, CHTTPClient::SettingsFlag::NO_FLAGS);
                        tmp_client.SetCertificateFile(CACERT_FILE);
                        headers["Content-Type"] = "application/json";

                        std::string store_bg_install_data_url = std::string("http://localhost:") + std::to_string(http_int_server_port) + "/store_bg_install_data";
                        if (tmp_client.Post(store_bg_install_data_url, headers, params_str, resp))
                        {
                            if (!HTTP_SUCCESS(resp.iCode))
                            {
                                json_object_put(history_item_obj);
                                failed(res, 200, "Could not save host data for background install");
                                cleanup_baseclient();
                                activity_inprogess = false;
                                file_transfering = false;
                                Windows::SetModalMode(false);
                                return;
                            }
                        }
                        else
                        {
                            json_object_put(history_item_obj);
                            failed(res, 200, "Could not save host data for background install");
                            cleanup_baseclient();
                            activity_inprogess = false;
                            file_transfering = false;
                            Windows::SetModalMode(false);
                            return;
                        }
                        json_object_put(history_item_obj);
                        sleep(2);
                        if (needs_redirect) {
                            remote_install_url = std::string("http://localhost:") + std::to_string(http_int_server_port) + "/bg_redirect/" + hash;
                        } else {
                            remote_install_url = std::string("http://localhost:") + std::to_string(http_int_server_port) + "/bg_install/" + hash;
                        }
                    }

                    int rc = INSTALLER::InstallRemotePkg(baseclient, remote_install_url, &header, title);
                    cleanup_baseclient();
                    activity_inprogess = false;
                    file_transfering = false;
                    Windows::SetModalMode(false);
                }
                else if (enable_rpi && use_disk_cache)
                {
                    SplitPkgInstallData *install_data = new SplitPkgInstallData{};

                    std::string install_pkg_path = std::string(temp_folder) + "/" + std::to_string(Util::GetTick()) + ".pkg";
                    SplitFile *sp = new SplitFile(install_pkg_path, INSTALL_ARCHIVE_PKG_SPLIT_SIZE/2);

                    install_data->split_file = sp;
                    install_data->remote_client = baseclient;
                    baseclient = nullptr;
                    install_data->path = path;
                    baseclient->Size(path, &install_data->size);
                    install_data->stop_write_thread = false;
                    install_data->delete_client = true;

                    int ret = pthread_create(&install_data->thread, NULL, Actions::DownloadSplitPkg, install_data);

                    ret = INSTALLER::InstallSplitPkg(download_url, install_data, true);

                    if (ret == 0)
                    {
                        failed(res, 200, lang_strings[STR_FAIL_INSTALL_FROM_URL_MSG]);
                        activity_inprogess = false;
                        file_transfering = false;
                        Windows::SetModalMode(false);
                        return;
                    }
                }
            }
            else
            {
                ArchiveEntry *entry = ZipUtil::GetPackageEntry(path, baseclient);
                if (entry != nullptr)
                {
                    ArchivePkgInstallData *install_data = new ArchivePkgInstallData{};

                    std::string install_pkg_path = std::string(temp_folder) + "/" + entry->filename;
                    SplitFile *sp = new SplitFile(install_pkg_path, INSTALL_ARCHIVE_PKG_SPLIT_SIZE);
                    
                    install_data->archive_entry = entry;
                    install_data->split_file = sp;
                    install_data->stop_write_thread = false;
                    install_data->delete_client = true;
                    baseclient = nullptr;

                    int ret = pthread_create(&install_data->thread, NULL, Actions::ExtractArchivePkg, install_data);

                    ret = INSTALLER::InstallArchivePkg(entry->filename, install_data, true);

                    if (ret == 0)
                    {
                        failed(res, 200, lang_strings[STR_FAIL_INSTALL_FROM_URL_MSG]);
                        activity_inprogess = false;
                        file_transfering = false;
                        delete install_data;
                        Windows::SetModalMode(false);
                        return;
                    }
                }
                else
                {
                    failed(res, 200, lang_strings[STR_FAIL_INSTALL_FROM_URL_MSG]);
                    cleanup_baseclient();
                    activity_inprogess = false;
                    file_transfering = false;
                    Windows::SetModalMode(false);
                    return;
                }
            }
            cleanup_baseclient();
            success(res);
    
        });

        svr->Post("/__local__/download_url", [&](const Request &req, Response &res)
        {
            std::string url;
            std::string dest;
            const char *url_param;
            const char *dest_param;
            bool use_alldebrid = false;
            bool use_realdebrid = false;

            json_object *jobj = json_tokener_parse(req.body.c_str());
            if (jobj != nullptr)
            {
                url_param = json_object_get_string(json_object_object_get(jobj, "url"));
                dest_param = json_object_get_string(json_object_object_get(jobj, "dest"));
                use_alldebrid  = json_object_get_boolean(json_object_object_get(jobj, "use_alldebrid"));
                use_realdebrid = json_object_get_boolean(json_object_object_get(jobj, "use_realdebrid"));

                if (url_param == nullptr || dest_param == nullptr)
                {
                    bad_request(res, "Required url, dest parameter missing");
                    json_object_put(jobj);
                    return;
                }

                url = std::string(url_param);
                dest = std::string(dest_param);
                json_object_put(jobj);
            }
            else
            {
                bad_request(res, "Invalid payload");
                return;
            }

            if ((use_alldebrid && strlen(alldebrid_api_key) == 0) || (use_realdebrid && strlen(realdebrid_api_key) == 0))
            {
                failed(res, 200, lang_strings[STR_ALLDEBRID_API_KEY_MISSING_MSG]);
                return;
            }
            FileHost *filehost = FileHost::getFileHost(url, use_alldebrid, use_realdebrid);

            if (!filehost->IsValidUrl())
            {
                delete(filehost);
                failed(res, 200, lang_strings[STR_INVALID_URL]);
                return;
            }

            std::string download_url = filehost->GetDownloadUrl();
            if (download_url.empty())
            {
                delete(filehost);
                failed(res, 200, lang_strings[STR_CANT_EXTRACT_URL_MSG]);
                return;
            }
            delete(filehost);

			size_t scheme_pos = download_url.find("://");
			size_t root_pos = download_url.find("/", scheme_pos + 3);
			std::string host = download_url.substr(0, root_pos);
			std::string path = download_url.substr(root_pos);
			uint64_t file_size = 0;

            RemoteClient *baseclient = new BaseClient();
            baseclient->Connect(host, "", "");
            if (!baseclient->Size(path, &file_size))
            {
                failed(res, 200, baseclient->LastResponse());
                baseclient->Quit();
                delete baseclient;
                return;
            }
            baseclient->Quit();
            delete baseclient;

            uint64_t id = Util::GetTick();
            json_object *params = json_object_new_object();
            json_object_object_add(params, "type", json_object_new_int(CLIENT_TYPE_FILEHOST));
            json_object_object_add(params, "url", json_object_new_string(host.c_str()));
            json_object_object_add(params, "username", json_object_new_string(""));
            json_object_object_add(params, "password", json_object_new_string(""));
            json_object_object_add(params, "src_path", json_object_new_string(path.c_str()));
            json_object_object_add(params, "dest_path", json_object_new_string(dest.c_str()));
            json_object_object_add(params, "size", json_object_new_uint64(file_size));
            json_object_object_add(params, "id", json_object_new_uint64(id));

            std::string params_payload = json_object_to_json_string(params);

            CHTTPClient::HttpResponse resp;
            CHTTPClient::HeadersMap headers;
            CHTTPClient tmp_client([](const std::string &log) {});
            tmp_client.InitSession(true, CHTTPClient::SettingsFlag::NO_FLAGS);
            tmp_client.SetCertificateFile(CACERT_FILE);
            headers["Content-Type"] = "application/json";

            std::string download_req_url = std::string("http://localhost:") + std::to_string(http_int_server_port) + "/download_url";
            if (tmp_client.Post(download_req_url, headers, params_payload.c_str(), resp))
            {
                if (HTTP_SUCCESS(resp.iCode))
                {
                    bool queued = true;
                    if (!resp.strBody.empty())
                    {
                        json_object *resp_obj = json_tokener_parse(resp.strBody.data());
                        if (resp_obj != nullptr)
                        {
                            json_object *result = json_object_object_get(resp_obj, "result");
                            if (result != nullptr)
                                queued = json_object_get_boolean(json_object_object_get(result, "success"));
                            json_object_put(resp_obj);
                        }
                    }

                    if (queued)
                    {
                        Util::RichNotify(id, "%s queued for download", path.c_str());
                        success(res);
                        json_object_put(params);
                        return;
                    }
                }
            }

            json_object_put(params);
            Util::RichNotify(id, "Failed to queue %s for download in background", path.c_str());
            failed(res, 200, "Failed to download");
        });

        svr->Get("/__local__/restart_daemon", [&](const Request & /*req*/, Response & res) {
            Actions::RestartServer();
            res.set_content("{\"status\":\"restarting\"}", "application/json");
        });

        svr->Get("/stop", [&](const Request & /*req*/, Response & /*res*/) {
            svr->stop();
        });

        // Add global CORS headers for dev frontend
        auto set_cors_headers = [](Response &res) {
            res.set_header("Access-Control-Allow-Origin", "*");
            res.set_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
            res.set_header("Access-Control-Allow-Headers", "Content-Type");
        };

        svr->Options(".*", [set_cors_headers](const Request &req, Response &res) {
            set_cors_headers(res);
            res.status = 200;
        });

        svr->set_post_routing_handler([set_cors_headers](const Request &req, Response &res) {
            set_cors_headers(res);
        });

        svr->Post("/speedtest", [&](const Request &req, Response &res, const ContentReader &content_reader)
        {
            auto start = std::chrono::high_resolution_clock::now();
            size_t total_received = 0;
            
            content_reader([&](const char *data, size_t data_length) {
                total_received += data_length;
                return true;
            });
            
            auto end = std::chrono::high_resolution_clock::now();
            auto duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();
            
            double mbps = 0;
            if (duration_ms > 0) {
                mbps = (static_cast<double>(total_received) * 8.0 / 1000000.0) / (static_cast<double>(duration_ms) / 1000.0);
            }
            
            std::string result = "{ \"result\": { \"success\": true, \"duration_ms\": " + std::to_string(duration_ms) + ", \"total_bytes\": " + std::to_string(total_received) + ", \"mbps\": " + std::to_string(mbps) + " } }";
            set_cors_headers(res);
            res.set_content(result, "application/json");
        });

        svr->Get("/speedtest_download", [&](const Request &req, Response &res)
        {
            size_t total_size = 200 * 1024 * 1024; // 200MB
            set_cors_headers(res);
            res.set_content_provider(
                total_size,
                "application/octet-stream",
                [](size_t offset, size_t length, DataSink &sink) {
                    size_t chunk_size = std::min(length, (size_t)(1024 * 1024)); // 1MB chunks
                    std::vector<char> buffer(chunk_size, '0');
                    sink.write(buffer.data(), chunk_size);
                    return true;
                },
                [](bool success) {}
            );
        });

        svr->Post("/speedtest_multipart", [&](const Request &req, Response &res, const ContentReader &content_reader)
        {
            auto start = std::chrono::high_resolution_clock::now();
            size_t total_received = 0;
            
            content_reader(
                [&](const MultipartFormData &item) {
                    return true;
                },
                [&](const char *data, size_t data_length) {
                    total_received += data_length;
                    return true;
                }
            );
            
            auto end = std::chrono::high_resolution_clock::now();
            auto duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();
            
            double mbps = 0;
            if (duration_ms > 0) {
                mbps = (static_cast<double>(total_received) * 8.0 / 1000000.0) / (static_cast<double>(duration_ms) / 1000.0);
            }
            
            std::string result = "{ \"result\": { \"success\": true, \"duration_ms\": " + std::to_string(duration_ms) + ", \"total_bytes\": " + std::to_string(total_received) + ", \"mbps\": " + std::to_string(mbps) + " } }";
            set_cors_headers(res);
            res.set_content(result, "application/json");
        });

        svr->set_error_handler([](const Request & /*req*/, Response &res)
        {
            const char *fmt = "<p>Error Status: <span style='color:red;'>%d</span></p>";
            char buf[BUFSIZ];
            snprintf(buf, sizeof(buf), fmt, res.status);
            res.set_content(buf, "text/html");
        });

        /*
        svr->set_logger([](const Request &req, const Response &res)
        {
            dbglogger_log("%s", log(req, res).c_str());
        });
        */
       
        svr->set_payload_max_length(WEB_UPLOAD_PAYLOAD_MAX_LENGTH);
        svr->set_tcp_nodelay(true);
        FS::MkDirs("/data/homebrew/ezremote-client/game-icons");
        svr->set_mount_point("/game-icons", "/data/homebrew/ezremote-client/game-icons");
        svr->set_mount_point("/", "/");

        if (web_server_enabled)
            svr->listen("0.0.0.0", http_server_port);
        else
            svr->listen("127.0.0.1", http_server_port);

        return NULL;
    }

    void Start()
    {
        if (svr == nullptr)
            svr = new Server();
        if (!svr->is_valid())
        {
            return;
        }
        int ret = pthread_create(&http_server_thid, NULL, ServerThread, NULL);
    }

    void Stop()
    {
        if (svr != nullptr)
            svr->stop();
    }
}
