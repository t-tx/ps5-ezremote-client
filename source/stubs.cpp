#include "lang.h"
#include "windows.h"

const char *lang_strings[STR_MAX] = {
    "Folder",
    "Failed to delete dir",
    "Deleting",
    "Failed to delete file",
    "Deleted"
};

bool stop_activity = false;
char status_message[1024];
char activity_message[1024];
uint64_t bytes_to_download = 0;
uint64_t bytes_transfered = 0;
uint64_t prev_tick = 0;
