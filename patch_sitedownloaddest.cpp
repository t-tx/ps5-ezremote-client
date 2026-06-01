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
            std::string basename = FS::GetFileName(path);
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
