#!/usr/bin/env bash
# Build all third-party dependencies for ps5-ezremote-client
# Adapted from PacBrew PKGBUILD recipes
set -e

export PS5_PAYLOAD_SDK="${PS5_PAYLOAD_SDK:-/opt/ps5-payload-sdk}"
source "${PS5_PAYLOAD_SDK}/toolchain/prospero.sh"

BUILDDIR="/tmp/deps-build"
mkdir -p "$BUILDDIR"

HBROOT="${PS5_SYSROOT}${PREFIX}"  # /opt/ps5-payload-sdk/target/user/homebrew
sudo mkdir -p "${HBROOT}/lib" "${HBROOT}/include"

ok() { echo "  ✓ $1 already built, skipping"; }

# ── 1. zlib ──────────────────────────────────────────
echo "=== [1/23] zlib ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libz.a" ]; then ok zlib; else
    wget -q -nc "https://zlib.net/zlib-1.3.2.tar.gz" || true
    rm -rf zlib-1.3.2; tar xf zlib-1.3.2.tar.gz
    cd zlib-1.3.2
    ./configure --prefix="${PREFIX}"
    ${MAKE}
    sudo ${MAKE} install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 2. bzip2 ─────────────────────────────────────────
echo "=== [2/23] bzip2 ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libbz2.a" ]; then ok bzip2; else
    wget -q -nc "https://sourceware.org/pub/bzip2/bzip2-1.0.8.tar.gz" || true
    rm -rf bzip2-1.0.8; tar xf bzip2-1.0.8.tar.gz
    cd bzip2-1.0.8
    ${MAKE} libbz2.a CC=${CC} AR=${AR} RANLIB=${RANLIB}
    sudo install -Dm 644 bzlib.h -t "${HBROOT}/include"
    sudo install -Dm 644 libbz2.a -t "${HBROOT}/lib"
fi

# ── 3. xz (lzma) ────────────────────────────────────
echo "=== [3/23] xz ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/liblzma.a" ]; then ok xz; else
    wget -q -nc "https://github.com/tukaani-project/xz/releases/download/v5.4.6/xz-5.4.6.tar.xz" || true
    rm -rf xz-5.4.6; tar xf xz-5.4.6.tar.xz
    cd xz-5.4.6
    ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared \
                --disable-nls --disable-rpath --disable-scripts
    ${MAKE}
    sudo ${MAKE} install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 4. zstd ──────────────────────────────────────────
echo "=== [4/23] zstd ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libzstd.a" ]; then ok zstd; else
    wget -q -nc "https://github.com/facebook/zstd/releases/download/v1.5.6/zstd-1.5.6.tar.gz" || true
    rm -rf zstd-1.5.6; tar xf zstd-1.5.6.tar.gz
    cd zstd-1.5.6
    ${CMAKE} -DCMAKE_BUILD_TYPE=Release \
             -DZSTD_BUILD_STATIC=YES \
             -DZSTD_BUILD_SHARED=NO \
             -B builddir -S build/cmake
    ${MAKE} -C builddir
    sudo ${MAKE} -C builddir install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 5. openssl ───────────────────────────────────────
echo "=== [5/23] openssl ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libssl.a" ]; then ok openssl; else
    wget -q -nc "https://github.com/openssl/openssl/releases/download/openssl-3.5.2/openssl-3.5.2.tar.gz" || true
    rm -rf openssl-3.5.2; tar xf openssl-3.5.2.tar.gz
    cd openssl-3.5.2
    ./Configure BSD-x86_64 no-tests no-apps no-shared --prefix="${PREFIX}"
    ${MAKE} build_sw
    sudo ${MAKE} install_sw DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 6. libiconv ──────────────────────────────────────
echo "=== [6/23] libiconv ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libiconv.a" ]; then ok libiconv; else
    wget -q -nc "https://ftp.gnu.org/pub/gnu/libiconv/libiconv-1.17.tar.gz" || true
    rm -rf libiconv-1.17; tar xf libiconv-1.17.tar.gz
    cd libiconv-1.17
    ./configure --prefix="${PS5_HBROOT}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared
    ${MAKE}
    sudo make install DESTDIR="${PS5_PAYLOAD_SDK}/target"
    sudo ${PS5_CROSS_FIX_ROOT} "${PS5_PAYLOAD_SDK}/target/${PS5_HBROOT}"
fi

# ── 7. libpng ────────────────────────────────────────
echo "=== [7/23] libpng ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libpng.a" ]; then ok libpng; else
    wget -q -nc "https://download.sourceforge.net/libpng/libpng-1.6.43.tar.xz" || true
    rm -rf libpng-1.6.43; tar xf libpng-1.6.43.tar.xz
    cd libpng-1.6.43
    ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared --disable-tests
    ${MAKE}
    sudo ${MAKE} install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 8. libjpeg-turbo ────────────────────────────────
echo "=== [8/23] libjpeg-turbo ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libjpeg.a" ]; then ok libjpeg-turbo; else
    wget -q -nc "https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/3.0.2/libjpeg-turbo-3.0.2.tar.gz" || true
    rm -rf libjpeg-turbo-3.0.2; tar xf libjpeg-turbo-3.0.2.tar.gz
    cd libjpeg-turbo-3.0.2
    ${CMAKE} -DCMAKE_BUILD_TYPE=Release \
             -DENABLE_STATIC=YES \
             -DENABLE_SHARED=NO \
             -B build -S .
    ${MAKE} -C build
    sudo ${MAKE} -C build install DESTDIR="${DESTDIR}"
fi

# ── 9. libwebp ───────────────────────────────────────
echo "=== [9/23] libwebp ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libwebp.a" ]; then ok libwebp; else
    wget -q -nc "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.4.0.tar.gz" || true
    rm -rf libwebp-1.4.0; tar xf libwebp-1.4.0.tar.gz
    cd libwebp-1.4.0
    ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared
    ${MAKE}
    sudo ${MAKE} install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 10. libpsl ───────────────────────────────────────
echo "=== [10/23] libpsl ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libpsl.a" ]; then ok libpsl; else
    wget -q -nc "https://github.com/rockdaboot/libpsl/releases/download/0.21.5/libpsl-0.21.5.tar.gz" || true
    rm -rf libpsl-0.21.5; tar xf libpsl-0.21.5.tar.gz
    cd libpsl-0.21.5
    ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared --disable-nls \
                --disable--gtk-doc-html
    ${MAKE}
    sudo ${MAKE} install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 11. libssh2 ─────────────────────────────────────
echo "=== [11/23] libssh2 ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libssh2.a" ]; then ok libssh2; else
    wget -q -nc "https://www.libssh2.org/download/libssh2-1.11.1.tar.gz" || true
    rm -rf libssh2-1.11.1; tar xf libssh2-1.11.1.tar.gz
    cd libssh2-1.11.1
    ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared \
                --disable-docker-tests
    ${MAKE} V=1
    sudo ${MAKE} install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 12. curl ─────────────────────────────────────────
echo "=== [12/23] curl ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libcurl.a" ]; then ok curl; else
    wget -q -nc "https://curl.haxx.se/download/curl-8.18.0.tar.xz" || true
    rm -rf curl-8.18.0; tar xf curl-8.18.0.tar.xz
    cd curl-8.18.0
    ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared \
                --with-openssl --disable-docs
    ${MAKE}
    sudo ${MAKE} install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 13. json-c ───────────────────────────────────────
echo "=== [13/23] json-c ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libjson-c.a" ]; then ok json-c; else
    wget -q -nc "https://github.com/json-c/json-c/archive/refs/tags/json-c-0.17-20230812.tar.gz" -O json-c-0.17.tar.gz || true
    rm -rf json-c-json-c-0.17-20230812; tar xf json-c-0.17.tar.gz
    cd json-c-json-c-0.17-20230812
    ${CMAKE} -DCMAKE_BUILD_TYPE=Release \
             -DCMAKE_C_FLAGS="-Wno-unreachable-code-generic-assoc" \
             -B build -S .
    ${MAKE} -C build
    sudo ${MAKE} -C build install DESTDIR="${DESTDIR}"
fi

# ── 14. libxml2 ──────────────────────────────────────
echo "=== [14/23] libxml2 ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libxml2.a" ]; then ok libxml2; else
    wget -q -nc "https://github.com/GNOME/libxml2/archive/refs/tags/v2.13.5.tar.gz" -O libxml2-2.13.5.tar.gz || true
    rm -rf libxml2-2.13.5; tar xf libxml2-2.13.5.tar.gz
    cd libxml2-2.13.5
    ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared \
                --without-python
    ${MAKE} V=1
    sudo make install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 15. lexbor ───────────────────────────────────────
echo "=== [15/23] lexbor ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/liblexbor_static.a" ]; then ok lexbor; else
    wget -q -nc "https://github.com/lexbor/lexbor/archive/refs/tags/v3.0.0.tar.gz" -O lexbor-3.0.0.tar.gz || true
    rm -rf lexbor-3.0.0; tar xf lexbor-3.0.0.tar.gz
    cd lexbor-3.0.0
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
if [ -f "${HBROOT}/lib/libminizip.a" ]; then ok minizip; else
    cd zlib-1.3.2/contrib/minizip
    sed -i 's|ioapi.h|ioapi.h ints.h|g' Makefile.am
    autoreconf --force --verbose --install
    ./configure --prefix="${PREFIX}" --host=x86_64
    ${MAKE}
    sudo ${MAKE} install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 17. libarchive ───────────────────────────────────
echo "=== [17/23] libarchive ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libarchive.a" ]; then ok libarchive; else
    wget -q -nc "http://www.libarchive.org/downloads/libarchive-3.7.4.tar.gz" || true
    rm -rf libarchive-3.7.4; tar xf libarchive-3.7.4.tar.gz
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
if [ -f "${HBROOT}/lib/libnfs.a" ]; then ok libnfs; else
    wget -q -nc "https://github.com/sahlberg/libnfs/archive/libnfs-5.0.3.tar.gz" || true
    rm -rf libnfs-libnfs-5.0.3; tar xf libnfs-5.0.3.tar.gz
    cd libnfs-libnfs-5.0.3
    autoreconf -vif
    export CFLAGS="-Wno-cast-align"
    ./configure --prefix="${PREFIX}" --host=x86_64-pc-freebsd \
                --enable-static --disable-shared \
                --without-libkrb5
    ${MAKE}
    sudo make install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
    unset CFLAGS
fi

# ── 19. libsmb2 ──────────────────────────────────────
echo "=== [19/23] libsmb2 ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libsmb2.a" ]; then ok libsmb2; else
    wget -q -nc "https://github.com/sahlberg/libsmb2/archive/refs/tags/libsmb2-6.2.tar.gz" || true
    rm -rf libsmb2-libsmb2-6.2; tar xf libsmb2-6.2.tar.gz
    cd libsmb2-libsmb2-6.2
    ${CMAKE} -DCMAKE_BUILD_TYPE=Release \
             -B build -S .
    ${MAKE} -C build
    sudo ${MAKE} -C build install DESTDIR="${DESTDIR}"
    sudo ${PS5_CROSS_FIX_ROOT} "${DESTDIR}/${PREFIX}"
fi

# ── 20. libsamplerate ───────────────────────────────
echo "=== [20/23] libsamplerate ==="
cd "$BUILDDIR"
if [ -f "${HBROOT}/lib/libsamplerate.a" ]; then ok libsamplerate; else
    wget -q -nc "https://github.com/libsndfile/libsamplerate/releases/download/0.2.2/libsamplerate-0.2.2.tar.xz" || true
    rm -rf libsamplerate-0.2.2; tar xf libsamplerate-0.2.2.tar.xz
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
if [ -f "${HBROOT}/lib/libSDL2.a" ]; then ok SDL2; else
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
if [ -f "${HBROOT}/lib/libSDL2_image.a" ]; then ok SDL2_image; else
    wget -q -nc "https://github.com/libsdl-org/SDL_image/releases/download/release-2.8.2/SDL2_image-2.8.2.tar.gz" || true
    rm -rf SDL2_image-2.8.2; tar xf SDL2_image-2.8.2.tar.gz
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
if [ -f "${HBROOT}/lib/libhttpclient.a" ]; then ok httpclient-cpp; else
    if [ ! -d httpclient-cpp ]; then
        git clone --depth 1 https://github.com/embeddedmz/httpclient-cpp.git
    fi
    cd httpclient-cpp
    # Build manually - this is a simple wrapper library
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
echo "  All dependencies built successfully!"
echo "============================================="
