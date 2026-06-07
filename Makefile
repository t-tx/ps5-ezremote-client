.PHONY: all require-sdk build deps clean build-frontend deploy deploy-elves deploy-frontend zip release

BUILD_DIR := build
DATA_DIR := data
ASSETS_DIR := $(DATA_DIR)/assets
FRONTEND_DIR := frontend
FRONTEND_DIST_DIR := $(FRONTEND_DIR)/dist
NODE_BIN ?= /workspace/node-v22.14.0-linux-x64/bin

RELEASE_ZIP := ezremote_client.zip
RELEASE_NOTES = $(BUILD_DIR)/release-notes-$(VERSION).md
RELEASE_TITLE = ezRemote Client $(VERSION)
CLIENT_RELEASE_ASSET := ezremote-client.elf

# CMake emits the runtime/bootstrap ELF with an underscore. GitHub releases also
# publish a hyphenated standalone ELF to match the repository/app naming style.
CLIENT_BUILD_ELF := $(BUILD_DIR)/ezremote_client.elf
CLIENT_RELEASE_ELF := $(BUILD_DIR)/$(CLIENT_RELEASE_ASSET)
SERVER_ELF := $(BUILD_DIR)/ps5-ezremote-server/ezremote-server.elf
PACKAGE_ELFS := $(CLIENT_BUILD_ELF) $(SERVER_ELF)
RELEASE_ASSETS := $(RELEASE_ZIP) $(CLIENT_RELEASE_ELF)

PS5_HOST ?= 192.168.50.235
PS5_FTP_USER ?= anonymous:anonymous
PS5_APP_DIR := /data/homebrew/ezremote-client
PS5_FTP_ROOT := ftp://$(PS5_HOST):2121$(PS5_APP_DIR)
PS5_CLIENT_ELF := $(PS5_FTP_ROOT)/ezremote_client.elf
PS5_SERVER_ELF := $(PS5_FTP_ROOT)/ezremote-server.elf
PS5_ASSETS_ROOT := $(PS5_FTP_ROOT)/assets

define ftp_upload
curl --fail --ftp-create-dirs -T "$(1)" "$(2)" --user "$(PS5_FTP_USER)"
endef

all: build

require-sdk:
	@if [ -z "$(PS5_PAYLOAD_SDK)" ]; then \
		echo "Error: PS5_PAYLOAD_SDK is not set."; \
		exit 1; \
	fi

build: require-sdk
	cmake -B $(BUILD_DIR) -G Ninja -DCMAKE_TOOLCHAIN_FILE="$(PS5_PAYLOAD_SDK)/toolchain/prospero.cmake"
	cmake --build $(BUILD_DIR)

deps: require-sdk
	chmod +x build_deps.sh build_deps_remaining.sh
	./build_deps.sh
	./build_deps_remaining.sh

clean:
	rm -rf $(BUILD_DIR)

deploy: deploy-elves deploy-frontend
	@echo "Deployment completed."

deploy-elves: build
	$(call ftp_upload,$(CLIENT_BUILD_ELF),$(PS5_CLIENT_ELF))
	$(call ftp_upload,$(SERVER_ELF),$(PS5_SERVER_ELF))

# Build the React frontend into frontend/dist.
build-frontend:
	@cd $(FRONTEND_DIR) && PATH="$(NODE_BIN):$$PATH" npm install
	@cd $(FRONTEND_DIR) && PATH="$(NODE_BIN):$$PATH" npm run build

deploy-frontend: build-frontend
	@echo "Uploading frontend assets to PS5 via FTP..."
	@cd $(FRONTEND_DIST_DIR) && find . -type f -exec sh -c 'for file do file=$${file#./}; dir=$${file%/*}; if [ "$$dir" = "$$file" ]; then remote_dir="$(PS5_ASSETS_ROOT)/"; else remote_dir="$(PS5_ASSETS_ROOT)/$$dir/"; fi; curl --silent --show-error --fail --ftp-create-dirs -T "$$file" "$$remote_dir" --user "$(PS5_FTP_USER)" >/dev/null || exit $$?; done' sh {} +
	@echo "Frontend assets deployed."

# Creates the release zip package. Usage: make zip
zip: build build-frontend
	@echo "Packaging release..."
	@rm -f $(RELEASE_ZIP) $(CLIENT_RELEASE_ELF)
	@echo "Staging frontend assets for release zip..."
	@rm -rf $(ASSETS_DIR)
	@mkdir -p $(ASSETS_DIR)
	@cp -r $(FRONTEND_DIST_DIR)/* $(ASSETS_DIR)/
	@rm -f $(DATA_DIR)/*.elf
	@cp $(PACKAGE_ELFS) $(DATA_DIR)/
	@cp $(CLIENT_BUILD_ELF) $(CLIENT_RELEASE_ELF)
	@zip -r $(RELEASE_ZIP) $(DATA_DIR)
	@echo "Release assets ready: $(RELEASE_ASSETS)"

# Creates a git tag and optionally publishes a GitHub Release using the gh CLI.
# Usage: make release VERSION=vX.YY
release:
	@if [ -z "$(VERSION)" ]; then \
		echo "Error: VERSION is not set. Usage: make release VERSION=vX.YY"; \
		exit 1; \
	fi
	$(MAKE) zip
	@mkdir -p $(BUILD_DIR)
	@printf '%s\n' \
		'# $(RELEASE_TITLE)' \
		'' \
		'## Overview' \
		'' \
		'This release provides the ezRemote Client PS5 bootstrap payload, bundled server payload, and packaged web UI assets.' \
		'' \
		'## Assets' \
		'' \
		'- `$(CLIENT_RELEASE_ASSET)`: standalone bootstrap ELF for launching ezRemote Client.' \
		'- `$(RELEASE_ZIP)`: full application bundle for `/data/homebrew/ezremote-client`, including the server payload and web UI assets.' \
		'' \
		'## Installation' \
		'' \
		'1. Launch `ezremote-client.elf` with your preferred PS5 payload loader.' \
		'2. On first start, the client can download and extract `$(RELEASE_ZIP)` automatically when the app data directory is missing.' \
		'3. For manual installation, extract the contents of `$(RELEASE_ZIP)` into `/data/homebrew/ezremote-client`.' \
		'' \
		'## Updating' \
		'' \
		'Extract the contents of `$(RELEASE_ZIP)` into `/data/homebrew/ezremote-client`, replacing existing packaged files. User configuration files are not intentionally overwritten by this package.' \
		'' \
		'## Notes' \
		'' \
		'- The bundled server payload is required by the bootstrap client.' \
		'- If troubleshooting is needed, check `/data/homebrew/ezremote-client/client.log` and `/data/homebrew/ezremote-client/server.log` on the PS5.' \
		> "$(RELEASE_NOTES)"
	@echo "Tagging $(VERSION)..."
	git tag -a $(VERSION) -m "$(RELEASE_TITLE)"
	git push origin $(VERSION)
	@if command -v gh >/dev/null 2>&1; then \
		echo "Creating GitHub Release $(VERSION) with gh CLI..."; \
		gh release create $(VERSION) $(RELEASE_ASSETS) --title "$(RELEASE_TITLE)" --notes-file "$(RELEASE_NOTES)"; \
	else \
		echo "gh CLI not found. Tag pushed. Upload $(RELEASE_ASSETS) and use $(RELEASE_NOTES) for release notes."; \
	fi
