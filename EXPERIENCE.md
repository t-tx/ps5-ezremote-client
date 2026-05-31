# EXPERIENCE.md

This document serves as a memory bank for known failure patterns, gotchas, and their proven solutions within this project. It is intended to help developers and AI agents avoid repeating past mistakes.

## 1. The "Silent Reject" Symptom (PS5 ELF `rtld` Load Failure)

### The Failure Attempt
When building a smaller, standalone payload (such as `ezremote-dpi.elf`), one might intuitively try to "clean up" the `Makefile` by only linking the specific libraries the payload directly calls (e.g., `-lSceAppInstUtil` and `-lkernel_sys`).

### The Pattern / Symptom
The compiled ELF payload is successfully pushed to the PS5, but **it fails to run entirely and fails silently**. No ports are bound (e.g., `:9040` doesn't listen), no crash logs are immediately obvious, and the process simply dies during the load phase.

### The Solution
The issue lies in the PS5's runtime linker (`rtld`). Libraries like `libSceAppInstUtil` have internal `DT_NEEDED` dependencies on other Sce libraries. If these transitive dependencies are not explicitly included in the payload's own `DT_NEEDED` header, `rtld` will refuse to load the ELF.
**Solution:** Always mirror the main payload's library set for these standalone payloads. For example, explicitly link:
```makefile
LIBS := -lSceSystemService -lSceUserService -lSceAppInstUtil -lSceNotification -lkernel_sys
```
This forces the required libraries into the payload's ELF header and guarantees the dependency graph resolves correctly on all supported firmwares. **Never remove these "unused" libraries from the Makefile.**

---

## 2. HTTP Upload Bottleneck (The `cpp-httplib` Byte-by-Byte Copy)

### The Failure Attempt
Using the default multipart form parsing implementation in `cpp-httplib` for handling large file uploads from the Web UI to the PS5.

### The Pattern / Symptom
Network upload speeds to the PS5 are severely artificially capped (e.g., around ~70Mbps on a gigabit connection). Profiling shows massive CPU bottlenecks during the upload process.

### The Solution
The default `cpp-httplib` implementation uses byte-by-byte copies (e.g., `std::vector::insert` or `std::string::append` loops) during multipart parsing, which is extremely inefficient on the PS5 hardware.
**Solution:** Optimize the hot paths by using `memcpy`/`memmove` instead, and ensure receive buffers are adequately sized. Large data buffers should be heap-backed rather than stack-allocated, as the PS5 runtime imposes strict stack size limits that can lead to crashes if exceeded.

---

## 3. Curl Rejects URLs With Literal Square Brackets

### The Failure Attempt
Testing an HTTP file URL that contains literal square brackets, such as `[DLPSGAME.COM]`, with a normal quoted `curl` command.

### The Pattern / Symptom
`curl` fails before making the request with `curl: (3) bad range in URL`, because curl treats square brackets as URL glob/range syntax even when the shell argument is quoted.

### The Solution
Disable curl URL globbing with `--globoff`, or percent-encode the brackets as `%5B` and `%5D`. Use this especially when validating installer passthrough/range behavior for hosted files with release-site naming conventions.

---

## 4. `git diff --check` Fails On Blank Lines With Tabs

### The Failure Attempt
While fixing resource lifetime bugs, a patch left tab characters on otherwise blank lines in `source/installer.cpp`.

### The Pattern / Symptom
`git diff --check` reports trailing whitespace on blank lines, even though the code logic is correct.

### The Solution
Keep blank lines completely empty when editing C/C++ files. After patches that touch indented blocks, run `git diff --check` and remove tabs/spaces from blank lines before further verification.

---

*(Add new failure patterns and solutions here as they are discovered)*
