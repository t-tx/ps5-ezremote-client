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

## 5. Curl FTP Deploy Fails On Asset Filenames With Spaces

### The Failure Attempt
Quieting the `make deploy` `data/assets` sync by uploading each asset to `ftp://.../assets/$$file` with curl.

### The Pattern / Symptom
ELF uploads succeed, then the asset sync fails with `curl: (3) URL using bad/illegal format or missing URL`. This happens for asset filenames with spaces, such as `langs/Traditional Chinese.ini` and `langs/Simplified Chinese.ini`, because curl parses the FTP target URL before upload and rejects literal spaces in the URL path.

### The Solution
Do not embed the asset basename in the FTP URL. Compute the remote directory from the relative path, pass that directory URL to curl, and let `curl -T "$$file" "ftp://.../assets/$$dir/"` use the local basename. This keeps success output quiet while still showing curl errors via `--silent --show-error --fail`.

---

## 6. Frontend Build Fails Because `npm` Is Not On PATH

### The Failure Attempt
Running `npm run build` directly from `frontend/` in the dev container.

### The Pattern / Symptom
The shell fails immediately with `npm: command not found`, even though the repository includes frontend dependencies and build targets.

### The Solution
Use the vendored Node install before running frontend commands:
```bash
export PATH="/workspace/node-v22.14.0-linux-x64/bin:$PATH" && npm run build
```
This matches the `Makefile` frontend target and allows Vite to build successfully.

---

## 7. React Hooks Lint Rejects Synchronous State Reset In Effects

### The Failure Attempt
Resetting component state synchronously inside `useEffect` before starting an async browser fetch, such as `setIconUrl(cachedIcon)` followed by a `fetch(...).then(...)` update.

### The Pattern / Symptom
`eslint-plugin-react-hooks` reports `react-hooks/set-state-in-effect` and rejects the component even though the production Vite build succeeds. A full `npm run lint` can also surface unrelated existing lint debt elsewhere in the frontend.

### The Solution
Initialize state from synchronous cache reads in the `useState` initializer and key the rendered item by path/site so it remounts cleanly when the file changes. Only call `setState` from async callbacks or event handlers. When full-project lint is blocked by unrelated existing issues, verify touched files directly, for example:
```bash
export PATH="/workspace/node-v22.14.0-linux-x64/bin:$PATH" && npx eslint src/components/FileManager/FileList.jsx
```

---

## 8. Dirty Worktree Makes Full `git diff --check` Fail

### The Failure Attempt
Running `git diff --check` after fixing the files touched by the current task.

### The Pattern / Symptom
The command can still fail on trailing whitespace that belongs to unrelated pre-existing worktree changes. This makes the full dirty-tree check noisy even when the current task files are clean.

### The Solution
Do not clean up unrelated user changes just to satisfy the full-tree check. Run a scoped check for the files touched by the current task, for example:
```bash
git diff --check -- path/to/file1 path/to/file2
```
Report any remaining full-tree failures as pre-existing or unrelated if they are outside the task scope.

---

## 9. Frontend Lint Debt Can Prevent Build Verification

### The Failure Attempt
Running `npm run lint && npm run build` as a single frontend verification command.

### The Pattern / Symptom
The command stops at `npm run lint` because the current frontend has repo-wide lint debt, including unrelated `no-unused-vars`, React hooks, and config globals issues. As a result, `npm run build` never runs even when the changed files may still compile.

### The Solution
Run lint and build as separate checks. If lint fails on unrelated baseline issues, record the lint failure and still run the production build directly with the vendored Node path:
```bash
export PATH="/workspace/node-v22.14.0-linux-x64/bin:$PATH" && npm run build
```

---

## 10. Full Build Can Fail In A Dirty Server Submodule

### The Failure Attempt
Running `make build` to verify a client-only change while `ps5-ezremote-server/` has unrelated local edits.

### The Pattern / Symptom
The main `ezremote_client.elf` may compile/link successfully, then the build fails later in `ps5-ezremote-server`, for example with `dbglogger_printf` undeclared or syntax/brace errors in `ps5-ezremote-server/source/clients/ftpclient.cpp`.

### The Solution
Do not modify or revert unrelated submodule changes just to verify the client edit. Record the full-build failure, then force a scoped rebuild of the touched client object and client target, for example:
```bash
ninja -C build -t clean CMakeFiles/ezremote_client.elf.dir/source/server/http_server.cpp.o && cmake --build build --target ezremote_client.elf
```

---

## 11. Packaged Frontend Fixes When Node Is Missing

### The Failure Attempt
Running frontend verification or rebuild commands after changing `frontend/src/...` when neither system `npm`/`node` nor `/workspace/node-v22.14.0-linux-x64` exists.

### The Pattern / Symptom
`npm --version` and `node --version` fail with `command not found`, and the expected vendored Node path from the Makefile is absent. Source changes do not affect the PS5 web UI until `data/assets/index.html` is rebuilt or otherwise updated.

### The Solution
When a normal `make frontend` rebuild is impossible, patch the already-built generated assets only with tightly scoped, counted replacements, and verify that the old minified snippets are gone and the new snippets appear in both `frontend/dist/index.html` and `data/assets/index.html`. Avoid broad generated-asset edits, and prefer restoring the vendored Node runtime plus `make frontend` when available.

When using Perl replacements on minified React code, escape literal `$` characters in replacement strings. Unescaped template literals such as `` `ex-${e.timestamp}-${t}` `` can collapse to broken keys like `` `ex--` `` because Perl treats `${...}` as interpolation. Verify key snippets after generated-asset patches.

---

## 12. Background Job Elapsed Time Continues After Failure

### The Failure Attempt
Calculating `elapsed_seconds` in `/get_download_state`, `/get_extract_state`, or `/get_fileop_state` as `now - timestamp` for every job state.

### The Pattern / Symptom
The Web UI shows elapsed time continuing to increase after a job has already failed or succeeded, for example `Elapsed 16m 58s` keeps counting on a failed download card.

### The Solution
Persist a terminal `finished_timestamp` for background downloads, extracts, and file operations. Set it whenever a job transitions to failed/success/cancelled, clear it on retry, and compute `elapsed_seconds` using `finished_timestamp - timestamp` for terminal states. For old persisted terminal jobs without `finished_timestamp`, default it to `timestamp` when loading so elapsed stops instead of growing forever.

---

*(Add new failure patterns and solutions here as they are discovered)*
