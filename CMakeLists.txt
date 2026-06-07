cmake_minimum_required(VERSION 3.5)

project(ezremote_client)

include("${CMAKE_CURRENT_LIST_DIR}/cmake/ezremote_versions.cmake")

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -DDONT_HAVE_STRUPR -fstack-protector-all")
set(CMAKE_CXX_FLAGS "${CMAKE_C_FLAGS} -fpermissive")

add_subdirectory(ps5-ezremote-server)

include_directories(
  source
)

add_executable(ezremote_client.elf
  source/dbglogger.c
  source/main.cpp
)

target_compile_definitions(ezremote_client.elf PRIVATE
  EZREMOTE_CLIENT_DISPLAY_VERSION="${EZREMOTE_CLIENT_DISPLAY_VERSION}"
  EZREMOTE_SERVER_REQUIRED_VERSION="${EZREMOTE_SERVER_REQUIRED_VERSION}"
)

target_link_libraries(ezremote_client.elf
  c
  c++
  z
  curl
  ssl
  crypto
  psl
  zstd
  pthread
  archive
  bz2
  lzma
  charset
  iconv
  SceNet
  SceSysCore
  SceSystemService
  SceLibcInternal
  kernel_sys
)

set(APPDIR "ezremote-client")
set(APP_VERSION "${EZREMOTE_CLIENT_PACKAGE_VERSION}")

add_custom_target(package
   DEPENDS ezremote_client.elf
   DEPENDS ezremote-server.elf
   COMMAND rm -rf ${APPDIR}
   COMMAND rm -f ezremote-client.zip
   COMMAND mkdir -p ${APPDIR}
   COMMAND ${PS5_PAYLOAD_SDK}/bin/prospero-strip ezremote_client.elf
   COMMAND ${PS5_PAYLOAD_SDK}/bin/prospero-strip ps5-ezremote-server/ezremote-server.elf
   COMMAND cp ezremote_client.elf ${APPDIR}
   COMMAND cp ps5-ezremote-server/ezremote-server.elf ${APPDIR}
   COMMAND cp -R ${PROJECT_SOURCE_DIR}/data/* ${APPDIR}
   COMMAND sed -i "s/ezRemote Client/ezRemote Client v${APP_VERSION}/g"  ${APPDIR}/homebrew.js

   COMMAND zip -r ezremote-client.zip ${APPDIR}/
)
