# =============================================================================
# Dev Container for ps5-ezremote-client
# Builds the PS5 Payload SDK from source and provides all dependencies needed
# to cross-compile the project for PS5.
# =============================================================================
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

# ── 1. System packages ──────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        # PS5 Payload SDK requirements
        bash \
        clang-18 \
        lld-18 \
        llvm-18 \
        # Build tools
        cmake \
        ninja-build \
        make \
        pkg-config \
        meson \
        # General development utilities
        git \
        curl \
        wget \
        ca-certificates \
        zip \
        unzip \
        socat \
        # Editor / shell niceties (optional, useful inside container)
        nano \
        less \
        sudo \
    && rm -rf /var/lib/apt/lists/*

# ── 2. Build & install the PS5 Payload SDK ──────────────────────────────────
#    We clone, build, and install the SDK into /opt/ps5-payload-sdk.
ARG PS5_SDK_REPO=https://github.com/ps5-payload-dev/sdk.git
ARG PS5_SDK_BRANCH=master
ARG PS5_SDK_INSTALL_DIR=/opt/ps5-payload-sdk

ENV LLVM_CONFIG=/usr/bin/llvm-config-18

RUN git clone --depth 1 --branch ${PS5_SDK_BRANCH} ${PS5_SDK_REPO} /tmp/ps5-sdk \
    && cd /tmp/ps5-sdk \
    && make \
    && make DESTDIR=${PS5_SDK_INSTALL_DIR} install \
    && rm -rf /tmp/ps5-sdk

# ── 3. Environment variables ────────────────────────────────────────────────
ENV PS5_PAYLOAD_SDK=${PS5_SDK_INSTALL_DIR}
ENV PATH="${PS5_SDK_INSTALL_DIR}/bin:${PATH}"

# ── 4. Create non-root dev user ─────────────────────────────────────────────
ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=${USER_UID}

RUN userdel -r ubuntu 2>/dev/null || true \
    && groupdel ubuntu 2>/dev/null || true \
    && groupadd --force --gid ${USER_GID} ${USERNAME} \
    && useradd --no-log-init --uid ${USER_UID} --gid ${USER_GID} -m ${USERNAME} -s /bin/bash \
    && echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/${USERNAME} \
    && chmod 0440 /etc/sudoers.d/${USERNAME}

USER ${USERNAME}
WORKDIR /workspace
