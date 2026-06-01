#include "usecase/pkg_install_usecase.h"
#include "usecase/file_manager_usecase.h"

static Usecase::PkgInstallUseCase g_pkg_installer;
static Usecase::FileManagerUseCase g_file_manager;

void RegisterNewEndpoints(httplib::Server* svr) {
    svr->Post("/api/install_remote_pkg", [&](const httplib::Request &req, httplib::Response &res) {
        json_object *jobj = json_tokener_parse(req.body.c_str());
        if (!jobj) {
            char buf[256];
            sprintf(buf, FAILURE_MSG, "Invalid JSON");
            res.set_content(buf, "application/json");
            return;
        }

        const char *url = json_object_get_string(json_object_object_get(jobj, "url"));
        const char *path = json_object_get_string(json_object_object_get(jobj, "path"));
        
        if (!url || !path) {
            char buf[256];
            sprintf(buf, FAILURE_MSG, "Missing url or path");
            res.set_content(buf, "application/json");
            return;
        }

        RemoteSettings settings; // Dummy settings
        memset(&settings, 0, sizeof(settings));

        // Use a default HTTP client for now
        RemoteClient* client = nullptr; // Would be resolved based on URL/Settings

        bool started = g_pkg_installer.StartRemoteInstall(client, url, path, &settings);
        if (started) {
            res.set_content(SUCCESS_MSG, "application/json");
        } else {
            char buf[256];
            sprintf(buf, FAILURE_MSG, "Already installing");
            res.set_content(buf, "application/json");
        }
    });

    svr->Get("/api/get_install_progress", [&](const httplib::Request &req, httplib::Response &res) {
        Usecase::InstallProgress prog = g_pkg_installer.GetProgress();
        char buf[1024];
        sprintf(buf, "{\"status\": %d, \"message\": \"%s\", \"downloaded\": %lu, \"total\": %lu}", 
                prog.status, prog.activity_message.c_str(), prog.bytes_downloaded, prog.bytes_total);
        res.set_content(buf, "application/json");
    });
}
