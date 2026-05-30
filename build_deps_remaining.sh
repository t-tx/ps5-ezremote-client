#!/usr/bin/env bash
# Build remaining dependencies (15-23) that failed after libxml2
set -e

export PS5_PAYLOAD_SDK="${PS5_PAYLOAD_SDK:-/opt/ps5-payload-sdk}"
source "${PS5_PAYLOAD_SDK}/toolchain/prospero.sh"

BUILDDIR="/tmp/deps-build"
HBROOT="${PS5_SYSROOT}${PREFIX}"

# ── 15. lexbor ───────────────────────────────────────
echo "=== [15/23] lexbor ==="
cd "$BUILDDIR"
if [ ! -f "${HBROOT}/lib/liblexbor_static.a" ]; then
    cd lexbor-3.0.0
    rm -rf build
    ${CMAKE} -B build -S . \
             -DCMAKE_BUILD_TYPE=Release \
             -DLEXBOR_BUILD_STATIC=YES \
             -DLEXBOR_INSTALL_HEADERS=YES \
             -DLEXBOR_BUILD_SHARED=NO \
             -DLEXBOR_BUILD_TESTS=NO \
             -DLEXBOR_BUILD_TESTS_CPP=NO
    ${MAKE} -C build
    sudo ${MAKE} -C build install DESTDIR="${DESTDIR}"
fi

# ── 16. minizip ──────────────────────────────────────
echo "=== [16/23] minizip ==="
cd "$BUILDDIR"
if [ ! -f "${HBROOT}/lib/libminizip.a" ]; then
    cd zlib-1.3.2/contrib/minizip
    # Clean any previous attempts
    make clean 2>/dev/null || true
    sed -i 's|ioapi.h|ioapi.h ints.h|g' Makefile.am 2>/dev/null || true
    autoreconf --force --verbose --install
    ./configure --prefix="${PREFIX}" --host=x86_64
    ${MAKE}
    sudo ${MAKE} install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 17. libarchive ───────────────────────────────────
echo "=== [17/23] libarchive ==="
cd "$BUILDDIR"
if [ ! -f "${HBROOT}/lib/libarchive.a" ]; then
    cd libarchive-3.7.4
    ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared \
                --disable-bsdtar --disable-bsdcat \
                --disable-bsdcpio --disable-acl \
                --without-openssl --without-xml2
    ${MAKE}
    sudo make install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 18. libnfs ───────────────────────────────────────
echo "=== [18/23] libnfs ==="
cd "$BUILDDIR"
if [ ! -f "${HBROOT}/lib/libnfs.a" ]; then
    cd libnfs-libnfs-5.0.3
    autoreconf -vif
    CFLAGS="-Wno-cast-align" ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared \
                --without-libkrb5
    ${MAKE}
    sudo make install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 19. libsmb2 ──────────────────────────────────────
echo "=== [19/23] libsmb2 ==="
cd "$BUILDDIR"
if [ ! -f "${HBROOT}/lib/libsmb2.a" ]; then
    cd libsmb2-libsmb2-6.2
    ${CMAKE} -DCMAKE_BUILD_TYPE=Release -B build -S .
    ${MAKE} -C build
    sudo ${MAKE} -C build install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 20. libsamplerate ───────────────────────────────
echo "=== [20/23] libsamplerate ==="
cd "$BUILDDIR"
if [ ! -f "${HBROOT}/lib/libsamplerate.a" ]; then
    cd libsamplerate-0.2.2
    ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared
    ${MAKE}
    sudo make install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 21. SDL2 ─────────────────────────────────────────
echo "=== [21/23] SDL2 ==="
cd "$BUILDDIR"
if [ ! -f "${HBROOT}/lib/libSDL2.a" ]; then
    if [ ! -d SDL ]; then
        git clone --depth 1 https://github.com/ps5-payload-dev/SDL.git
    fi
    cd SDL
    ${CMAKE} -DCMAKE_BUILD_TYPE=Release \
             -DSDL_OPENGL=YES \
             -DSDL_LOADSO=YES \
             -B build -S .
    ${MAKE} -C build
    sudo ${MAKE} -C build install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 22. SDL2_image ───────────────────────────────────
echo "=== [22/23] SDL2_image ==="
cd "$BUILDDIR"
if [ ! -f "${HBROOT}/lib/libSDL2_image.a" ]; then
    cd SDL2_image-2.8.2
    ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared
    ${MAKE}
    sudo ${MAKE} install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 23. httpclient-cpp ───────────────────────────────
echo "=== [23/23] httpclient-cpp ==="
cd "$BUILDDIR"
if [ ! -f "${HBROOT}/lib/libhttpclient.a" ]; then
    if [ ! -d httpclient-cpp ]; then
        git clone --depth 1 https://github.com/embeddedmz/httpclient-cpp.git
    fi
    cd httpclient-cpp
    ${CXX} -std=c++17 -c -I"${HBROOT}/include" -I. \
           -I HTTPClient HTTPClient/HTTPClient.cpp -o HTTPClient.o 2>/dev/null || \
    ${CXX} -std=c++14 -c -I"${HBROOT}/include" -I. \
           -I HTTPClient HTTPClient/HTTPClient.cpp -o HTTPClient.o
    ${AR} rcs libhttpclient.a HTTPClient.o
    sudo cp libhttpclient.a "${HBROOT}/lib/"
    sudo mkdir -p "${HBROOT}/include/httpclient"
    sudo cp HTTPClient/HTTPClient.h "${HBROOT}/include/httpclient/"
fi

echo ""
echo "============================================="
echo "  Remaining dependencies built!"
echo "============================================="
