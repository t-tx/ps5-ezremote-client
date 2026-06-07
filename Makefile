.PHONY: all build deps clean deploy zip release tag frontend deploy-frontend

RELEASE_ZIP := ezremote_client.zip
CLIENT_ELF := build/ezremote_client.elf
CLIENT_RELEASE_ELF := build/ezremote-client.elf
SERVER_ELF := build/ps5-ezremote-server/ezremote-server.elf
RELEASE_ASSETS := $(RELEASE_ZIP) $(CLIENT_RELEASE_ELF)

all: build

build:
	@if [ -z "$(PS5_PAYLOAD_SDK)" ]; then \
		echo "Error: PS5_PAYLOAD_SDK is not set."; \
		exit 1; \
	fi
	cmake -B build -G Ninja -DCMAKE_TOOLCHAIN_FILE=$(PS5_PAYLOAD_SDK)/toolchain/prospero.cmake
	cmake --build build

deps:
	@if [ -z "$(PS5_PAYLOAD_SDK)" ]; then \
		echo "Error: PS5_PAYLOAD_SDK is not set."; \
		exit 1; \
	fi
	chmod +x build_deps.sh build_deps_remaining.sh
	./build_deps.sh
	./build_deps_remaining.sh

clean:
	rm -rf build

deploy: build
	curl -T $(CLIENT_ELF) ftp://192.168.50.235:2121/data/homebrew/ezremote-client/ezremote_client.elf --user anonymous:anonymous
	curl -T $(SERVER_ELF) ftp://192.168.50.235:2121/data/homebrew/ezremote-client/ezremote-server.elf --user anonymous:anonymous
	@cd data/assets && find . -type f -exec sh -c 'for file do file=$${file#./}; dir=$${file%/*}; if [ "$$dir" = "$$file" ]; then remote_dir="ftp://192.168.50.235:2121/data/homebrew/ezremote-client/assets/"; else remote_dir="ftp://192.168.50.235:2121/data/homebrew/ezremote-client/assets/$$dir/"; fi; curl --silent --show-error --fail --ftp-create-dirs -T "$$file" "$$remote_dir" --user anonymous:anonymous >/dev/null || exit $$?; done' sh {} +

# Build and deploy the new React frontend
frontend:
	@cd frontend && export PATH=/workspace/node-v22.14.0-linux-x64/bin:$$PATH && npm install
	@cd frontend && export PATH=/workspace/node-v22.14.0-linux-x64/bin:$$PATH && npm run build

sync-frontend: frontend-local
	@echo "Uploading frontend assets to PS5 via FTP..."
	@cd data/assets && find . -type f -exec sh -c 'for file do file=$${file#./}; dir=$${file%/*}; if [ "$$dir" = "$$file" ]; then remote_dir="ftp://192.168.50.235:2121/data/homebrew/ezremote-client/assets/"; else remote_dir="ftp://192.168.50.235:2121/data/homebrew/ezremote-client/assets/$$dir/"; fi; curl --silent --show-error --fail --ftp-create-dirs -T "$$file" "$$remote_dir" --user anonymous:anonymous >/dev/null || exit $$?; done' sh {} +
	@echo "Frontend assets deployed."

frontend-local: frontend
	@echo "Deploying frontend assets locally..."
	@rm -rf data/assets
	@mkdir -p data/assets
	@cp -r frontend/dist/* data/assets/

sync-homebrew:
	@echo "Syncing homebrew files..."
	curl -T data/homebrew.js ftp://192.168.50.235:2121/data/homebrew/ezremote-client/homebrew.js --user anonymous:anonymous
	@cd data/sce_sys && find . -type f -exec sh -c 'for file do file=$${file#./}; dir=$${file%/*}; if [ "$$dir" = "$$file" ]; then remote_dir="ftp://192.168.50.235:2121/data/homebrew/ezremote-client/sce_sys/"; else remote_dir="ftp://192.168.50.235:2121/data/homebrew/ezremote-client/sce_sys/$$dir/"; fi; curl --silent --show-error --fail --ftp-create-dirs -T "$$file" "$$remote_dir" --user anonymous:anonymous >/dev/null || exit $$?; done' sh {} +
	@echo "Homebrew files synced."
deploy-frontend: frontend sync-frontend
all: deploy deploy-frontend
	@echo "Deploying all! DONE"
# Creates the release zip package. Usage: make zip
zip: build frontend-local
	@echo "Packaging release..."
	@rm -f $(RELEASE_ZIP) $(CLIENT_RELEASE_ELF)
	@rm -f data/*.elf
	@cp $(CLIENT_ELF) data/
	@cp $(SERVER_ELF) data/
	@cp $(CLIENT_ELF) $(CLIENT_RELEASE_ELF)
	@cd data && zip -r ../$(RELEASE_ZIP) .
	@echo "Release assets ready: $(RELEASE_ASSETS)"

# Creates a git tag and optionally publishes a GitHub Release using the gh CLI.
# Usage: make release VERSION=vX.YY
release:
	@if [ -z "$(VERSION)" ]; then \
		echo "Error: VERSION is not set. Usage: make release VERSION=vX.YY"; \
		exit 1; \
	fi
	$(MAKE) zip
	@echo "Tagging $(VERSION)..."
	git tag -a $(VERSION) -m "Release $(VERSION)"
	git push origin $(VERSION)
	@if command -v gh >/dev/null 2>&1; then \
		echo "Creating GitHub Release $(VERSION) with gh CLI..."; \
		gh release create $(VERSION) $(RELEASE_ASSETS) --title "$(VERSION)" --notes "Release $(VERSION)"; \
	else \
		echo "gh CLI not found. Tag pushed. Upload $(RELEASE_ASSETS) to GitHub manually."; \
	fi
