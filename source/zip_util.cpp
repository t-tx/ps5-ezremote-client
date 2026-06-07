#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <minizip/unzip.h>
#include <minizip/zip.h>
#include <archive.h>
#include <archive_entry.h>

#include "common.h"
#include "fs.h"
#include "util.h"
#include "zip_util.h"

namespace ZipUtil
{
    static char password[128];
    static int password_attempt_idx = 0;

    void callback_7zip(const char *fileName, unsigned long fileSize, unsigned fileNum, unsigned numFiles)
    {
    }

    void convertToZipTime(time_t time, tm_zip *tmzip)
    {
        struct tm tm = *localtime(&time);
        tmzip->tm_sec = tm.tm_sec;
        tmzip->tm_min = tm.tm_min;
        tmzip->tm_hour = tm.tm_hour;
        tmzip->tm_mday = tm.tm_mday;
        tmzip->tm_mon = tm.tm_mon;
        tmzip->tm_year = tm.tm_year;
    }

    int ZipAddFile(zipFile zf, const std::string &path, int filename_start, int level)
    {
        int res;
        struct stat file_stat;
        memset(&file_stat, 0, sizeof(file_stat));
        res = stat(path.c_str(), &file_stat);
        if (res < 0) return res;

        zip_fileinfo zi;
        memset(&zi, 0, sizeof(zip_fileinfo));
        convertToZipTime(file_stat.st_mtim.tv_sec, &zi.tmz_date);

        int use_zip64 = (file_stat.st_size >= 0xFFFFFFFF);
        res = zipOpenNewFileInZip3_64(zf, path.substr(filename_start).c_str(), &zi,
                                      NULL, 0, NULL, 0, NULL,
                                      (level != 0) ? Z_DEFLATED : 0,
                                      level, 0,
                                      -MAX_WBITS, DEF_MEM_LEVEL, Z_DEFAULT_STRATEGY,
                                      NULL, 0, use_zip64);
        if (res < 0) return res;

        FILE *fd = FS::OpenRead(path);
        if (fd == NULL)
        {
            zipCloseFileInZip(zf);
            return 0;
        }

        void *buf = nullptr;
        posix_memalign(&buf, 4096, ARCHIVE_TRANSFER_SIZE);

        while (1)
        {
            int read = FS::Read(fd, buf, ARCHIVE_TRANSFER_SIZE);
            if (read < 0)
            {
                free(buf);
                FS::Close(fd);
                zipCloseFileInZip(zf);
                return read;
            }

            if (read == 0) break;

            int written = zipWriteInFileInZip(zf, buf, read);
            if (written < 0)
            {
                free(buf);
                FS::Close(fd);
                zipCloseFileInZip(zf);
                return written;
            }
        }

        free(buf);
        FS::Close(fd);
        zipCloseFileInZip(zf);

        return 1;
    }

    int ZipAddFolder(zipFile zf, const std::string &path, int filename_start, int level)
    {
        int res;
        struct stat file_stat;
        memset(&file_stat, 0, sizeof(file_stat));
        res = stat(path.c_str(), &file_stat);
        if (res < 0) return res;

        zip_fileinfo zi;
        memset(&zi, 0, sizeof(zip_fileinfo));
        convertToZipTime(file_stat.st_mtim.tv_sec, &zi.tmz_date);

        std::string folder = path.substr(filename_start);
        if (folder[folder.length() - 1] != '/') folder = folder + "/";

        res = zipOpenNewFileInZip3_64(zf, folder.c_str(), &zi,
                                      NULL, 0, NULL, 0, NULL,
                                      (level != 0) ? Z_DEFLATED : 0,
                                      level, 0,
                                      -MAX_WBITS, DEF_MEM_LEVEL, Z_DEFAULT_STRATEGY,
                                      NULL, 0, 0);

        if (res < 0) return res;
        zipCloseFileInZip(zf);
        return 1;
    }

    int ZipAddPath(zipFile zf, const std::string &path, int filename_start, int level)
    {
        DIR *dfd = opendir(path.c_str());
        if (dfd != NULL)
        {
            int ret = ZipAddFolder(zf, path, filename_start, level);
            if (ret <= 0) return ret;

            struct dirent *dirent;
            do
            {
                dirent = readdir(dfd);
                if (dirent != NULL && strcmp(dirent->d_name, ".") != 0 && strcmp(dirent->d_name, "..") != 0)
                {
                    int new_path_length = path.length() + strlen(dirent->d_name) + 2;
                    char *new_path = (char *)malloc(new_path_length);
                    snprintf(new_path, new_path_length, "%s%s%s", path.c_str(), FS::hasEndSlash(path.c_str()) ? "" : "/", dirent->d_name);

                    int ret = 0;
                    if (dirent->d_type & DT_DIR)
                    {
                        ret = ZipAddPath(zf, new_path, filename_start, level);
                    }
                    else
                    {
                        ret = ZipAddFile(zf, new_path, filename_start, level);
                    }

                    free(new_path);

                    if (ret <= 0)
                    {
                        closedir(dfd);
                        return ret;
                    }
                }
            } while (dirent != NULL);
            closedir(dfd);
        }
        else
        {
            return ZipAddFile(zf, path, filename_start, level);
        }

        return 1;
    }

    static char *pathdup(const char *path)
    {
        char *str;
        size_t len;
        if (path == NULL || path[0] == '\0') return (NULL);

        len = strlen(path);
        while (len && path[len - 1] == '/') len--;
        if ((str = (char *)malloc(len + 1)) == NULL) errno = ENOMEM;
        memcpy(str, path, len);
        str[len] = '\0';
        return (str);
    }

    static char *pathcat(const char *prefix, const char *path)
    {
        char *str;
        size_t prelen, len;
        prelen = prefix ? strlen(prefix) + 1 : 0;
        len = strlen(path) + 1;
        if ((str = (char *)malloc(prelen + len)) == NULL) errno = ENOMEM;
        if (prefix)
        {
            memcpy(str, prefix, prelen);
            str[prelen - 1] = '/';
        }
        memcpy(str + prelen, path, len);
        return (str);
    }

    static void extract_dir(struct archive *a, struct archive_entry *e, const std::string &path)
    {
        if (path[0] == '\0') return;
        archive_read_data_skip(a);
    }

    static int extract2fd(struct archive *a, const std::string &pathname, int fd, bool *cancel_flag)
    {
        ssize_t len;
        unsigned char *buffer = (unsigned char *)malloc(ARCHIVE_TRANSFER_SIZE);

        for (int n = 0;; n++)
        {
            if (cancel_flag && *cancel_flag)
            {
                free(buffer);
                return 0;
            }

            len = archive_read_data(a, buffer, ARCHIVE_TRANSFER_SIZE);
            if (len == 0)
            {
                free(buffer);
                return 1;
            }

            if (len < 0)
            {
                free(buffer);
                return 0;
            }

            if (write(fd, buffer, len) != len)
            {
                free(buffer);
                return 0;
            }
        }
        free(buffer);
        return 1;
    }

    static void extract_file(struct archive *a, struct archive_entry *e, const std::string &path, bool *cancel_flag)
    {
        struct stat sb;
        int fd;
        const char *linkname;

        if (lstat(path.c_str(), &sb) == 0)
        {
            (void)unlink(path.c_str());
        }

        linkname = archive_entry_symlink(e);
        if (linkname != NULL)
        {
            if (symlink(linkname, path.c_str()) != 0) return;
            return;
        }

        if ((fd = open(path.c_str(), O_RDWR | O_CREAT | O_TRUNC, 0777)) < 0) return;
        extract2fd(a, path, fd, cancel_flag);
        close(fd);
    }

    static void extract(struct archive *a, struct archive_entry *e, const std::string &base_dir, bool *cancel_flag)
    {
        char *pathname, *realpathname;
        mode_t filetype;
        const char *original_name = archive_entry_pathname(e);

        if ((pathname = pathdup(original_name)) == NULL)
        {
            archive_read_data_skip(a);
            return;
        }
        filetype = archive_entry_filetype(e);

        if (pathname[0] == '/' || strncmp(pathname, "../", 3) == 0 || strstr(pathname, "/../") != NULL)
        {
            archive_read_data_skip(a);
            free(pathname);
            return;
        }

        if (!S_ISDIR(filetype) && !S_ISREG(filetype) && !S_ISLNK(filetype))
        {
            archive_read_data_skip(a);
            free(pathname);
            return;
        }

        realpathname = pathcat(base_dir.c_str(), pathname);

        if (S_ISDIR(filetype) || original_name[strlen(original_name)-1] == '/')
            extract_dir(a, e, realpathname);
        else
        {
            FS::MkDirs(realpathname, true);
            extract_file(a, e, realpathname, cancel_flag);
        }

        free(realpathname);
        free(pathname);
    }

    static const char *passphrase_callback(struct archive *a, void *_client_data)
    {
        memset(password, 0, sizeof(password));
        return password;
    }

    int Extract(const DirEntry &file, const std::string &basepath, bool* cancel_flag)
    {
        struct archive *a;
        struct archive_entry *e;
        int ret;

        password_attempt_idx = 0;

        if ((a = archive_read_new()) == NULL) return 0;

        archive_read_support_format_all(a);
        archive_read_support_filter_all(a);
        archive_read_set_passphrase_callback(a, NULL, &passphrase_callback);

        ret = archive_read_open_filename(a, file.path, ARCHIVE_TRANSFER_SIZE);
        if (ret < ARCHIVE_OK)
        {
            archive_read_free(a);
            return 0;
        }

        FS::MkDirs(basepath.c_str());
        for (;;)
        {
            ret = archive_read_next_header(a, &e);
            if (ret < ARCHIVE_OK)
            {
                archive_read_free(a);
                return 0;
            }

            if (ret == ARCHIVE_EOF) break;

            extract(a, e, basepath, cancel_flag);
        }

        archive_read_free(a);
        return 1;
    }

    ArchiveEntry *GetPackageEntry(const std::string &zip_file)
    {
        struct archive *a;
        struct archive_entry *e;
        char *pathname;
        mode_t filetype;
        ArchiveEntry *pkg_entry = nullptr;
        int ret;

        password_attempt_idx = 0;

        if ((a = archive_read_new()) == NULL) return nullptr;

        archive_read_support_format_all(a);
        archive_read_support_filter_all(a);
        archive_read_set_passphrase_callback(a, NULL, &passphrase_callback);

        ret = archive_read_open_filename(a, zip_file.c_str(), ARCHIVE_TRANSFER_SIZE);
        if (ret < ARCHIVE_OK)
        {
            archive_read_free(a);
            return nullptr;
        }

        for (;;)
        {
            ret = archive_read_next_header(a, &e);

            if (ret < ARCHIVE_OK)
            {
                archive_read_free(a);
                return nullptr;
            }

            if (ret == ARCHIVE_EOF) break;

            if ((pathname = pathdup(archive_entry_pathname(e))) == NULL)
            {
                archive_read_data_skip(a);
                continue;
            }

            filetype = archive_entry_filetype(e);

            if (pathname[0] == '/' || strncmp(pathname, "../", 3) == 0 || strstr(pathname, "/../") != NULL)
            {
                archive_read_data_skip(a);
                free(pathname);
                continue;
            }

            if (!S_ISREG(filetype))
            {
                archive_read_data_skip(a);
                free(pathname);
                continue;
            }

            if (Util::EndsWith(Util::ToLower(pathname), ".pkg"))
            {
                pkg_entry = new ArchiveEntry{};
                pkg_entry->archive = a;
                pkg_entry->entry = e;
                pkg_entry->filename = pathname;
                pkg_entry->filesize = archive_entry_size(e);

                free(pathname);
                return pkg_entry;
            }

            free(pathname);
        }

        archive_read_free(a);
        return nullptr;
    }

    ArchiveEntry *GetNextPackageEntry(ArchiveEntry *archive_entry)
    {
        struct archive *a = archive_entry->archive;
        struct archive_entry *e = nullptr;
        char *pathname;
        mode_t filetype;
        ArchiveEntry *pkg_entry = nullptr;
        int ret;

        for (;;)
        {
            ret = archive_read_next_header(a, &e);

            if (ret < ARCHIVE_OK)
            {
                archive_read_free(a);
                return nullptr;
            }

            if (ret == ARCHIVE_EOF) break;

            if ((pathname = pathdup(archive_entry_pathname(e))) == NULL)
            {
                archive_read_data_skip(a);
                continue;
            }

            filetype = archive_entry_filetype(e);

            if (pathname[0] == '/' || strncmp(pathname, "../", 3) == 0 || strstr(pathname, "/../") != NULL)
            {
                archive_read_data_skip(a);
                free(pathname);
                continue;
            }

            if (!S_ISREG(filetype))
            {
                archive_read_data_skip(a);
                free(pathname);
                continue;
            }

            if (Util::EndsWith(Util::ToLower(pathname), ".pkg"))
            {
                pkg_entry = new ArchiveEntry{};
                pkg_entry->archive = a;
                pkg_entry->entry = e;
                pkg_entry->filename = pathname;
                pkg_entry->filesize = archive_entry_size(e);

                free(pathname);
                return pkg_entry;
            }

            free(pathname);
        }

        archive_read_free(a);
        return nullptr;
    }
}
