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

    static RemoteClient* GetPooledClient(int site_idx)
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

    static void ReleasePooledClient(int site_idx, RemoteClient *tmp_client)
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
            if (activity_inprogess)
            {
                failed(res, 200, lang_strings[STR_ACTIVITY_IN_PROGRESS_MSG]);
                return;
            }

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

            std::string extract_zip_folder = std::string(destination) + "/" + folderName;
            DirEntry entry;
            sprintf(entry.name, "%s", "");
            sprintf(entry.path, "%s", item);
            entry.isDir = false;
            FS::MkDirs(extract_zip_folder);
            int ret = ZipUtil::Extract(entry, extract_zip_folder);
            if (ret == 0)
                failed(res, 200, "Failed to extract file");
            else if (ret == -1)
                failed(res, 200, "Unsupported compressed file format");
            else
                success(res);
            json_object_put(jobj); });

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

                    int rc = INSTALLER::InstallRemotePkg(remote_install_url, &header, title);
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

        svr->Get("/stop", [&](const Request & /*req*/, Response & /*res*/) {
            svr->stop();
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
            res.set_content(result, "application/json");
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
