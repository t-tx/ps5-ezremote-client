# ezremote-client Feature Roadmap

This document outlines the expected features, enhancements, and bug fixes that have been discussed. We will use this roadmap to track progress and plan future implementations.

## 1. Remote PKG Installation Support
*   **Goal:** Allow users to install `.pkg` files directly from remote sites (FTP, Google Drive, WebDAV, etc.) via the Web UI.
*   **Details:** 
    *   Create a new C++ endpoint (`POST /api/siteinstall`).
    *   Decouple the backend remote installation queue (`InstallRemotePkgsThread`) from the ImGui GUI state so it can be safely triggered by the HTTP server.
    *   Wire the `FileActionModal`'s "Install PKG" button to trigger this API when interacting with remote sites.

## 2. Controller Navigation Shortcuts (Web UI)
*   **Goal:** Enable seamless gamepad navigation within the Web UI.
*   **Details:**
    *   Map the `L1` button to automatically jump focus to the sidebar navigation.
    *   Map the `R1` button to automatically jump focus to the main content panel (e.g., the file list or the active view).
    *   Ensure focus outlines clearly indicate where the user is.

## 3. Speed Test Accuracy Investigation
*   **Goal:** Determine why the internal speed test caps at ~100Mbps.
*   **Details:**
    *   Investigate the chunk generation and transfer logic in both `http_server.cpp` (backend) and `SpeedTestView.jsx` (frontend).
    *   Identify potential bottlenecks (e.g., TCP window sizes, chunk streaming overhead, single-thread limitations, or physical network 100Mbit switch limits).
    *   Optimize the `/mem` or `/speedtest` endpoints for maximum throughput.

## 4. USB & Quick Directory Shortcuts
*   **Goal:** Make it easier to access common local paths without manual typing.
*   **Details:**
    *   Add common quick-access paths to the sidebar (e.g., `/data/etahen`, `/data/homebrew`).
    *   Dynamically scan for non-empty external storage devices (`/mnt/ext*` and `/mnt/usb*`) on the PS5.
    *   Inject detected drives as selectable quick-links into the local navigation menu.

## 5. Remote Site "List File" Viewing
*   **Goal:** Better integration for custom predefined list files from remote sources.
*   **Details:**
    *   Allow the app to connect to configured remote sites and parse their list files (e.g., Myrient, Archive.org configurations).
    *   Add a dedicated view to display the contents of these lists elegantly inside the Web UI.
