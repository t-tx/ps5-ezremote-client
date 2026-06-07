#ifndef EZ_WINDOWS_H
#define EZ_WINDOWS_H

#include <stdint.h>

extern bool stop_activity;
extern char status_message[1024];
extern char activity_message[1024];
extern uint64_t bytes_to_download;
extern uint64_t bytes_transfered;
extern uint64_t prev_tick;

#endif
