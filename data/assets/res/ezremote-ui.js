(function (window, document, angular) {
  'use strict';

  if (!angular) {
    return;
  }

  function makeEvent(name, detail) {
    var event;
    if (typeof window.CustomEvent === 'function') {
      event = new window.CustomEvent(name, { detail: detail });
    } else {
      event = document.createEvent('CustomEvent');
      event.initCustomEvent(name, false, false, detail);
    }
    return event;
  }

  function parseJson(text) {
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (ignore) {
      return null;
    }
  }

  function endpointLabel(url) {
    var match = String(url || '').match(/\/__local__\/([^?]+)/);
    if (!match) {
      return 'Request';
    }
    return match[1]
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, function (value) { return value.toUpperCase(); });
  }

  function shouldIgnoreToast(url) {
    return /\/__local__\/(list|uploadResumeSize)(\?|$)/.test(String(url || ''));
  }

  if (window.XMLHttpRequest && !window.__ezremoteUxXhrPatched) {
    window.__ezremoteUxXhrPatched = true;
    (function () {
      var originalOpen = window.XMLHttpRequest.prototype.open;
      var originalSend = window.XMLHttpRequest.prototype.send;

      window.XMLHttpRequest.prototype.open = function (method, url) {
        this.__ezremoteUxRequest = { method: method, url: url };
        return originalOpen.apply(this, arguments);
      };

      window.XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        function onComplete() {
          var request = xhr.__ezremoteUxRequest || {};
          var url = request.url || '';
          var payload;
          var result;
          if (String(url).indexOf('/__local__/') === -1) {
            return;
          }
          try {
            payload = parseJson(xhr.responseText);
          } catch (ignore) {
            payload = null;
          }
          result = payload && payload.result;
          if (!result || typeof result.success === 'undefined') {
            return;
          }
          window.dispatchEvent(makeEvent('ezremote:api', {
            url: url,
            label: endpointLabel(url),
            success: !!result.success,
            error: result.error || null,
            ignoreToast: shouldIgnoreToast(url)
          }));
        }

        if (xhr.addEventListener) {
          xhr.addEventListener('loadend', onComplete, false);
        } else {
          var originalReadyStateChange = xhr.onreadystatechange;
          xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
              onComplete();
            }
            if (originalReadyStateChange) {
              return originalReadyStateChange.apply(xhr, arguments);
            }
          };
        }

        return originalSend.apply(xhr, arguments);
      };
    }());
  }

  angular.module('FileManagerApp')
    .filter('formatDate', [function () {
      return function (value) {
        if (value instanceof Date) {
          return isFinite(value.getTime()) ? value.toISOString().substring(0, 19).replace('T', ' ') : '';
        }
        if (value === null || typeof value === 'undefined') {
          return '';
        }
        return typeof value.toLocaleString === 'function' ? value.toLocaleString() : String(value);
      };
    }])
    .factory('ezremoteUx', ['$timeout', '$http', '$q', 'item', function ($timeout, $http, $q, fileItem) {
      var nextToastId = 1;
      var service = {
        toasts: []
      };

      function itemName(item) {
        return item && item.model && item.model.name;
      }

      function isDirectory(item) {
        return item && item.model && item.model.type === 'dir';
      }

      function isRootPath(currentPath) {
        return !currentPath || currentPath.length === 0;
      }

      function isMountRootPath(currentPath) {
        return currentPath && currentPath.length === 1 && currentPath[0] === 'mnt';
      }

      function mountChildPath(item) {
        return '/mnt/' + itemName(item);
      }

      function isAllowedMountDirectory(item) {
        var name = itemName(item) || '';
        return isDirectory(item) && /^(usb|ex)/i.test(name);
      }

      function isRawDirectory(entry) {
        return entry && entry.type === 'dir';
      }

      function rawDirectory(name) {
        return {
          name: name,
          rights: 'drwxrwxrwx',
          date: '',
          size: '',
          type: 'dir'
        };
      }

      function hasName(items, name) {
        return items.some(function (entry) {
          return (itemName(entry) || entry.name) === name;
        });
      }

      function ensureRootEntries(entries) {
        var rootEntries = entries.filter(function (entry) {
          return (isRawDirectory(entry) || isDirectory(entry)) && (entry.name === 'data' || entry.name === 'mnt' || itemName(entry) === 'data' || itemName(entry) === 'mnt');
        });
        ['data', 'mnt'].forEach(function (name) {
          if (!hasName(rootEntries, name)) {
            rootEntries.push(rawDirectory(name));
          }
        });
        return rootEntries;
      }

      function ensureRootItems(items) {
        return ensureRootEntries(items).map(function (entry) {
          return entry.model ? entry : new fileItem(entry, []);
        });
      }

      function listPath(path) {
        return $http.post('/__local__/list', { path: path }).then(function (response) {
          var data = response.data;
          if (typeof data === 'string') {
            data = parseJson(data);
          }
          return data && angular.isArray(data.result) ? data.result : [];
        }, function () {
          return [];
        });
      }

      function isNonEmptyDirectory(path) {
        return listPath(path).then(function (items) {
          return items.length > 0;
        });
      }

      function pathText(path) {
        return '/' + (path || []).filter(Boolean).join('/');
      }

      function pathParts(path) {
        return String(path || '/').split('/').filter(Boolean);
      }

      function childPath(path, name) {
        return pathText(pathParts(path).concat(name));
      }

      service.formatPath = function (basePath, currentPath) {
        var parts = [];
        var i;
        if (angular.isArray(basePath)) {
          for (i = 0; i < basePath.length; i += 1) {
            if (basePath[i]) {
              parts.push(basePath[i]);
            }
          }
        } else if (basePath && basePath !== '/') {
          parts.push(basePath);
        }
        if (angular.isArray(currentPath)) {
          for (i = 0; i < currentPath.length; i += 1) {
            if (currentPath[i]) {
              parts.push(currentPath[i]);
            }
          }
        }
        return '/' + parts.join('/').replace(/^\/+/, '');
      };

      service.installDropPath = function (currentPath) {
        var path = angular.isArray(currentPath) ? currentPath.slice(0) : [];
        if (path[0] === 'data') {
          return path;
        }
        if (path[0] === 'mnt' && path.length > 1 && /^(usb|ex)/i.test(path[1])) {
          return path;
        }
        return ['data'];
      };

      service.installDropTarget = function (currentPath) {
        return pathText(service.installDropPath(currentPath));
      };

      service.pathText = pathText;

      service.pathParts = pathParts;

      service.listPath = listPath;

      service.notify = function (type, title, message) {
        var toast = {
          id: nextToastId,
          type: type || 'info',
          title: title || 'Update',
          message: message || ''
        };
        nextToastId += 1;
        service.toasts.push(toast);
        while (service.toasts.length > 4) {
          service.toasts.shift();
        }
        $timeout(function () {
          var index = service.toasts.indexOf(toast);
          if (index !== -1) {
            service.toasts.splice(index, 1);
          }
        }, type === 'error' ? 6500 : 3600);
      };

      service.filterNavigatorList = function (fileNavigator) {
        var currentPath = fileNavigator.currentPath || [];
        var items = fileNavigator.fileList || [];
        var mountDirs;

        if (isRootPath(currentPath)) {
          return $q.when(ensureRootItems(items));
        }

        if (isMountRootPath(currentPath)) {
          mountDirs = items.filter(isAllowedMountDirectory);
          return $q.all(mountDirs.map(function (item) {
            return isNonEmptyDirectory(mountChildPath(item));
          })).then(function (results) {
            return mountDirs.filter(function (item, index) {
              return results[index];
            });
          });
        }

        return $q.when(items);
      };

      service.visiblePathDirectories = function (currentPath) {
        var path = angular.isArray(currentPath) ? currentPath : [];
        var parentPath = pathText(path);

        return listPath(parentPath).then(function (items) {
          var directories = items.filter(isRawDirectory);
          var mountDirs;

          if (isRootPath(path)) {
            return ensureRootEntries(directories);
          }

          if (isMountRootPath(path)) {
            mountDirs = directories.filter(function (entry) {
              return /^(usb|ex)/i.test(entry.name || '');
            });
            return $q.all(mountDirs.map(function (entry) {
              return isNonEmptyDirectory('/mnt/' + entry.name);
            })).then(function (results) {
              return mountDirs.filter(function (entry, index) {
                return results[index];
              });
            });
          }

          return directories;
        });
      };

      service.visiblePathEntries = function (currentPath) {
        var path = angular.isArray(currentPath) ? currentPath : [];
        var parentPath = pathText(path);

        return listPath(parentPath).then(function (items) {
          var mountDirs;

          if (isRootPath(path)) {
            return ensureRootEntries(items);
          }

          if (isMountRootPath(path)) {
            mountDirs = items.filter(function (entry) {
              return entry.type === 'dir' && /^(usb|ex)/i.test(entry.name || '');
            });
            return $q.all(mountDirs.map(function (entry) {
              return isNonEmptyDirectory(childPath(parentPath, entry.name));
            })).then(function (results) {
              return mountDirs.filter(function (entry, index) {
                return results[index];
              });
            });
          }

          return items;
        });
      };

      return service;
    }])
    .config(['$provide', function ($provide) {
      $provide.decorator('apiMiddleware', ['$delegate', '$q', '$rootScope', 'fileManagerConfig', function ($delegate, $q, $rootScope, fileManagerConfig) {
        var apiMiddlewareProto = $delegate && $delegate.prototype;
        var originalUpload = apiMiddlewareProto && apiMiddlewareProto.upload;

        if (!apiMiddlewareProto || !originalUpload) {
          return $delegate;
        }

        // apiMiddleware is injected as a constructor; controllers call `new apiMiddleware()`.
        apiMiddlewareProto.upload = function (fileList, path) {
          if (!window.FormData || !window.XMLHttpRequest) {
            return originalUpload.apply(this, arguments);
          }

          var apiHandler = this.apiHandler || {};
          var files = (angular.isArray(fileList) ? fileList : [fileList]).filter(Boolean);
          if (!files || !files.length) {
            return $q.reject({ result: { success: false, error: 'No files to upload' } });
          }

          var targetPath = (angular.isArray(path) ? path : String(path || '').split('/')).filter(Boolean);
          var destination = '/' + targetPath.join('/');
          var configuredChunkSize = parseInt(fileManagerConfig.CHUNK_SIZE, 10);
          var CHUNK_SIZE = configuredChunkSize > 0 ? configuredChunkSize : 128 * 1024 * 1024;
          var activeXhrs = [];
          var rejected = false;
          var totalSize = files.reduce(function (total, file) {
            return total + (file.size || 0);
          }, 0);

          function asErrorResponse(error) {
            if (error && error.result) {
              return error;
            }
            return { result: { success: false, error: String(error || 'Upload failed') } };
          }

          function errorMessage(error) {
            return error && error.result && error.result.error || String(error || 'Upload failed');
          }

          function updateProgress() {
            var totalLoaded = 0;
            (apiHandler.status || []).forEach(function (status) {
              totalLoaded += status.loaded || 0;
            });
            apiHandler.total_loaded = totalLoaded;
            apiHandler.progress = totalSize > 0 ? Math.min(100, Math.round((totalLoaded * 100) / totalSize)) : 100;
          }

          function untrackXhr(xhr) {
            var index = activeXhrs.indexOf(xhr);
            if (index !== -1) {
              activeXhrs.splice(index, 1);
            }
          }

          function abortActiveXhrs() {
            activeXhrs.slice().forEach(function (xhr) {
              if (xhr && xhr.readyState !== 4) {
                xhr.abort();
              }
            });
          }

          function rejectUpload(deferred, error) {
            var response = asErrorResponse(error);
            if (!rejected) {
              rejected = true;
              apiHandler.error = errorMessage(response);
              abortActiveXhrs();
            }
            deferred.reject(response);
            $rootScope.$applyAsync();
          }

          apiHandler.inprocess = true;
          apiHandler.progress = 0;
          apiHandler.error = '';
          apiHandler.total_size = totalSize;
          apiHandler.total_loaded = 0;
          apiHandler.status = [];

          var promises = files.map(function(file) {
            var deferred = $q.defer();
            var fileSize = file.size || 0;
            var fileStatus = { size: fileSize, loaded: 0 };
            var totalChunks = Math.ceil(fileSize / CHUNK_SIZE) || 1;
            var currentChunk = 0;
            var finalResponse = null;

            file.loaded = 0;
            file.total = fileSize;
            file.progress = 0;
            apiHandler.status[file.name] = fileStatus;
            apiHandler.status.push(fileStatus);

            function setFileLoaded(loaded) {
              fileStatus.loaded = Math.min(fileSize, loaded || 0);
              file.loaded = fileStatus.loaded;
              file.total = fileSize;
              file.progress = fileSize > 0 ? Math.round((file.loaded * 100) / fileSize) : 100;
              updateProgress();
            }
            
            function uploadNextChunk() {
              if (rejected) {
                return;
              }

              if (currentChunk >= totalChunks) {
                deferred.resolve(finalResponse);
                return;
              }

              var start = currentChunk * CHUNK_SIZE;
              var end = Math.min(start + CHUNK_SIZE, fileSize);
              var chunk = file.slice(start, end);

              var formData = new window.FormData();
              formData.append('destination', destination);
              formData.append('_chunkNumber', currentChunk);
              formData.append('_chunkSize', CHUNK_SIZE);
              formData.append('_currentChunkSize', chunk.size);
              formData.append('_totalSize', fileSize);
              formData.append('file', chunk, file.name || 'blob');

              var xhr = new window.XMLHttpRequest();
              activeXhrs.push(xhr);
              xhr.open('POST', '/__local__/upload');

              var lastUpdate = 0;
              xhr.upload.onprogress = function(e) {
                var now = Date.now();
                if (now - lastUpdate > 250 || e.loaded === e.total) {
                  lastUpdate = now;
                  setFileLoaded(start + e.loaded);
                  $rootScope.$applyAsync();
                }
              };

              xhr.onload = function() {
                untrackXhr(xhr);
                if (rejected) {
                  return;
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                  try {
                    var response = JSON.parse(xhr.responseText);
                    if (response && response.result && (response.result.error || response.result.success === false)) {
                      rejectUpload(deferred, response);
                    } else {
                      setFileLoaded(end);
                      finalResponse = response;
                      currentChunk++;
                      uploadNextChunk();
                    }
                  } catch(err) {
                    setFileLoaded(end);
                    finalResponse = xhr.responseText;
                    currentChunk++;
                    uploadNextChunk();
                  }
                } else {
                  rejectUpload(deferred, 'HTTP Error ' + xhr.status);
                }
                $rootScope.$applyAsync();
              };

              xhr.onerror = function() {
                untrackXhr(xhr);
                rejectUpload(deferred, 'Network Error');
              };

              xhr.onabort = function() {
                untrackXhr(xhr);
                rejectUpload(deferred, 'Upload Aborted');
              };

              file.xhr = xhr;
              xhr.send(formData);
            }
            
            uploadNextChunk();
            
            return deferred.promise;
          });
          
          return $q.all(promises).then(function (responses) {
            apiHandler.progress = 100;
            return responses;
          }, function (error) {
            apiHandler.error = errorMessage(error);
            return $q.reject(error);
          }).finally(function () {
            apiHandler.inprocess = false;
            apiHandler.progress = 0;
            apiHandler.status = [];
            $rootScope.$applyAsync();
          });
        };
        
        return $delegate;
      }]);
    }])
    .directive('ezInstallDrop', ['ezremoteUx', 'item', '$document', '$timeout', '$window', '$q', function (ezremoteUx, item, $document, $timeout, $window, $q) {
      return {
        restrict: 'A',
        link: function (scope) {
          var filterTimer;
          var scanId = 0;
          var lastMouseNavAt = 0;
          var lastMouseNavButton = null;
          var recentStorageKey = 'ezremote.recentPaths';
          var filterDepthStorageKey = 'ezremote.filterDepth';
          var uploadChunkSizeStorageKey = 'ezremote.uploadChunkSizeMb';

          scope.pathMenu = {
            openIndex: null,
            loading: false,
            items: []
          };

          scope.recentMenuOpen = false;
          scope.quickFilters = ['.pkg', '.zip', '.rar', '.7z'];
          scope.ezFilter = {
            active: false,
            scanning: false,
            depth: readNumber(filterDepthStorageKey, 2),
            quick: '',
            results: []
          };
          scope.recentPaths = loadRecentPaths();
          scope.navHistory = {
            back: [],
            forward: [],
            current: '',
            ignoreNext: false
          };
          scope.uploadChunkSizeMb = readNumber(uploadChunkSizeStorageKey, bytesToMb(scope.config && scope.config.CHUNK_SIZE));
          applyUploadChunkSize(scope.uploadChunkSizeMb);

          function readNumber(key, fallback) {
            var value;
            try {
              value = parseInt($window.localStorage.getItem(key), 10);
            } catch (ignore) {
              value = fallback;
            }
            return isNaN(value) ? fallback : value;
          }

          function saveNumber(key, value) {
            try {
              $window.localStorage.setItem(key, String(value));
            } catch (ignore) {}
          }

          function bytesToMb(bytes) {
            bytes = parseInt(bytes, 10);
            return bytes > 0 ? Math.round(bytes / (1024 * 1024)) : 128;
          }

          function normalizeChunkSizeMb(value) {
            value = parseInt(value, 10);
            return value > 0 ? value : 128;
          }

          function applyUploadChunkSize(value) {
            var chunkSizeMb = normalizeChunkSizeMb(value);
            scope.uploadChunkSizeMb = chunkSizeMb;
            if (scope.config) {
              scope.config.CHUNK_SIZE = chunkSizeMb * 1024 * 1024;
            }
            saveNumber(uploadChunkSizeStorageKey, chunkSizeMb);
          }

          function loadRecentPaths() {
            var paths;
            try {
              paths = JSON.parse($window.localStorage.getItem(recentStorageKey) || '[]');
            } catch (ignore) {
              paths = [];
            }
            return angular.isArray(paths) ? paths.slice(0, 8) : [];
          }

          function saveRecentPaths() {
            try {
              $window.localStorage.setItem(recentStorageKey, JSON.stringify(scope.recentPaths));
            } catch (ignore) {}
          }

          function rememberPath(path) {
            if (!path) {
              return;
            }
            scope.recentPaths = [path].concat(scope.recentPaths.filter(function (existing) {
              return existing !== path;
            })).slice(0, 8);
            saveRecentPaths();
          }

          function closeRecentMenu() {
            scope.recentMenuOpen = false;
          }

          function clampDepth(depth) {
            depth = parseInt(depth, 10);
            if (isNaN(depth)) {
              depth = 2;
            }
            return Math.max(0, Math.min(depth, 6));
          }

          function filterText() {
            return (scope.query || '').trim().toLowerCase();
          }

          function entryMatches(entry, text) {
            return !text || String(entry.name || '').toLowerCase().indexOf(text) !== -1;
          }

          function scanPath(pathParts, depth, text, results) {
            return ezremoteUx.visiblePathEntries(pathParts).then(function (entries) {
              var branches = [];
              entries.forEach(function (entry) {
                if (entryMatches(entry, text)) {
                  results.push(new item(entry, pathParts));
                }
                if (entry.type === 'dir' && depth > 0) {
                  branches.push(scanPath(pathParts.concat(entry.name), depth - 1, text, results));
                }
              });
              return $q.all(branches);
            });
          }

          function runFilterScan() {
            var text = filterText();
            var currentScan;
            var depth;
            var results = [];

            scope.ezFilter.depth = clampDepth(scope.ezFilter.depth);
            saveNumber(filterDepthStorageKey, scope.ezFilter.depth);

            if (!text) {
              scope.ezFilter.active = false;
              scope.ezFilter.scanning = false;
              scope.ezFilter.results = [];
              scope.fileList = scope.fileNavigator.fileList;
              return;
            }

            currentScan = scanId + 1;
            scanId = currentScan;
            depth = scope.ezFilter.depth;
            scope.ezFilter.active = true;
            scope.ezFilter.scanning = true;
            scope.ezFilter.results = [];

            scanPath(currentPath(), depth, text, results).then(function () {
              if (scanId !== currentScan) {
                return;
              }
              scope.ezFilter.results = results;
              scope.fileList = results;
            }).finally(function () {
              if (scanId === currentScan) {
                scope.ezFilter.scanning = false;
              }
            });
          }

          function scheduleFilterScan() {
            if (filterTimer) {
              $timeout.cancel(filterTimer);
            }
            filterTimer = $timeout(runFilterScan, 250);
          }

          function currentPath() {
            return scope.fileNavigator && scope.fileNavigator.currentPath || [];
          }

          function currentPathText() {
            return ezremoteUx.pathText(currentPath());
          }

          function navigateToParts(parts) {
            closePathMenu();
            closeRecentMenu();
            scope.fileNavigator.currentPath = parts || [];
            scope.fileNavigator.refresh();
          }

          function navigateToPath(path) {
            navigateToParts(ezremoteUx.pathParts(path));
          }

          function parentPathForIndex(index) {
            var path = currentPath();
            return index < 0 ? [] : path.slice(0, index);
          }

          function closePathMenu() {
            scope.pathMenu.openIndex = null;
            scope.pathMenu.loading = false;
            scope.pathMenu.items = [];
          }

          function documentClick() {
            scope.$applyAsync(function () {
              closePathMenu();
              closeRecentMenu();
            });
          }

          function isInsideModal(target) {
            while (target && target !== document) {
              if (target.classList && target.classList.contains('modal')) {
                return true;
              }
              target = target.parentNode;
            }
            return false;
          }

          function handleMouseNavigation(event) {
            var button = event.button;
            var now;
            var inModal;

            if (button !== 3 && button !== 4) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();

            now = Date.now();
            if (button === lastMouseNavButton && now - lastMouseNavAt < 120) {
              return;
            }
            lastMouseNavAt = now;
            lastMouseNavButton = button;
            inModal = isInsideModal(event.target);

            if (inModal) {
              return;
            }

            scope.$applyAsync(function () {
              if (button === 3) {
                scope.goPathBack();
              } else {
                scope.goPathForward();
              }
            });
          }

          $document.on('click', documentClick);
          $window.addEventListener('mousedown', handleMouseNavigation, true);
          $window.addEventListener('mouseup', handleMouseNavigation, true);
          $window.addEventListener('auxclick', handleMouseNavigation, true);
          scope.$on('$destroy', function () {
            $document.off('click', documentClick);
            $window.removeEventListener('mousedown', handleMouseNavigation, true);
            $window.removeEventListener('mouseup', handleMouseNavigation, true);
            $window.removeEventListener('auxclick', handleMouseNavigation, true);
            if (filterTimer) {
              $timeout.cancel(filterTimer);
            }
          });

          scope.$watch(function () {
            return currentPathText();
          }, function (path) {
            if (!scope.navHistory.current) {
              scope.navHistory.current = path;
            } else if (path !== scope.navHistory.current) {
              if (scope.navHistory.ignoreNext) {
                scope.navHistory.ignoreNext = false;
              } else {
                scope.navHistory.back.push(scope.navHistory.current);
                scope.navHistory.forward = [];
                if (scope.navHistory.back.length > 24) {
                  scope.navHistory.back.shift();
                }
              }
              scope.navHistory.current = path;
            }
            rememberPath(path);
            scheduleFilterScan();
          });

          scope.$watchGroup([
            function () { return scope.query; },
            function () { return scope.ezFilter.depth; }
          ], scheduleFilterScan);

          scope.toggleRecentPaths = function (event) {
            if (event) {
              event.preventDefault();
              event.stopPropagation();
            }
            closePathMenu();
            scope.recentMenuOpen = !scope.recentMenuOpen;
          };

          scope.goToRecentPath = function (path, event) {
            if (event) {
              event.preventDefault();
              event.stopPropagation();
            }
            navigateToPath(path);
          };

          scope.goPathBack = function () {
            var target;
            var current = currentPathText();
            if (!scope.navHistory.back.length) {
              return;
            }
            target = scope.navHistory.back.pop();
            if (current && current !== target) {
              scope.navHistory.forward.push(current);
            }
            scope.navHistory.ignoreNext = true;
            navigateToPath(target);
          };

          scope.goPathForward = function () {
            var target;
            var current = currentPathText();
            if (!scope.navHistory.forward.length) {
              return;
            }
            target = scope.navHistory.forward.pop();
            if (current && current !== target) {
              scope.navHistory.back.push(current);
            }
            scope.navHistory.ignoreNext = true;
            navigateToPath(target);
          };

          scope.goPathUp = function () {
            var path = currentPath();
            if (!path.length) {
              return;
            }
            navigateToParts(path.slice(0, -1));
          };

          scope.goMountPath = function () {
            navigateToPath('/mnt');
          };

          scope.clearRecentPaths = function (event) {
            if (event) {
              event.preventDefault();
              event.stopPropagation();
            }
            scope.recentPaths = [];
            saveRecentPaths();
          };

          scope.setQuickFilter = function (filter, event) {
            if (event) {
              event.preventDefault();
            }
            if (scope.ezFilter.quick === filter) {
              scope.ezFilter.quick = '';
              scope.query = '';
              return;
            }
            scope.ezFilter.quick = filter;
            scope.query = filter;
          };

          scope.clearFilter = function () {
            scope.ezFilter.quick = '';
            scope.query = '';
          };

          scope.setUploadChunkSize = function (value) {
            value = parseInt(value, 10);
            if (value > 0) {
              applyUploadChunkSize(value);
            }
          };

          scope.normalizeUploadChunkSize = function () {
            applyUploadChunkSize(scope.uploadChunkSizeMb);
          };

          scope.togglePathSiblings = function (index, event) {
            if (event) {
              event.preventDefault();
              event.stopPropagation();
            }
            if (scope.pathMenu.openIndex === index) {
              closePathMenu();
              return;
            }
            scope.pathMenu.openIndex = index;
            scope.pathMenu.loading = true;
            scope.pathMenu.items = [];
            ezremoteUx.visiblePathDirectories(parentPathForIndex(index)).then(function (items) {
              scope.pathMenu.items = items;
            }).finally(function () {
              scope.pathMenu.loading = false;
            });
          };

          scope.goToPathSibling = function (index, sibling, event) {
            var nextPath;
            if (event) {
              event.preventDefault();
              event.stopPropagation();
            }
            if (!sibling || !sibling.name) {
              return;
            }
            nextPath = parentPathForIndex(index).concat(sibling.name);
            navigateToParts(nextPath);
          };

          function droppedFiles(files) {
            return Array.prototype.slice.call(files || []);
          }

          function isInstallableFile(file) {
            var pattern = scope.config && scope.config.isInstallableFilePattern || /\.(pkg)$/i;
            pattern.lastIndex = 0;
            return file && file.name && pattern.test(file.name);
          }

          function apiError(response, fallback) {
            return response && response.result && response.result.error || fallback;
          }

          scope.dropInstallFiles = function (files) {
            var allFiles = droppedFiles(files);
            var installFiles = allFiles.filter(isInstallableFile);
            var targetPath;
            var installItems;

            if (!installFiles.length) {
              ezremoteUx.notify('error', 'No installable package', 'Drop one or more .pkg files to upload and install.');
              return;
            }

            targetPath = ezremoteUx.installDropPath(scope.fileNavigator.currentPath);
            installItems = installFiles.map(function (file) {
              return new item({
                name: file.name,
                type: 'file',
                size: file.size || 0,
                rights: 'rw-rw-rw-'
              }, targetPath);
            });

            if (allFiles.length !== installFiles.length) {
              ezremoteUx.notify('info', 'Ignored unsupported files', 'Only .pkg files can be dropped for install.');
            }

            ezremoteUx.notify('info', 'Package install queued', 'Uploading to ' + ezremoteUx.installDropTarget(scope.fileNavigator.currentPath) + '.');

            return scope.apiMiddleware.upload(installFiles, targetPath).then(function () {
              return scope.apiMiddleware.install(installItems);
            }).then(function () {
              scope.temps = installItems;
              return scope.fileNavigator.refresh();
            }, function (response) {
              ezremoteUx.notify('error', 'Package install failed', apiError(response, 'The dropped package could not be installed.'));
            });
          };
        }
      };
    }])
    .directive('ezPkgDropZone', [function () {
      return {
        restrict: 'A',
        link: function (scope, element) {
          function filesFromEvent(event) {
            var rawEvent = event.originalEvent || event;
            return rawEvent.dataTransfer && rawEvent.dataTransfer.files;
          }

          function stopBrowserDrop(event) {
            event.preventDefault();
            event.stopPropagation();
          }

          element.on('dragenter dragover', function (event) {
            stopBrowserDrop(event);
            element.addClass('ez-install-drop-over');
          });

          element.on('dragleave dragend', function (event) {
            stopBrowserDrop(event);
            element.removeClass('ez-install-drop-over');
          });

          element.on('drop', function (event) {
            var files;
            stopBrowserDrop(event);
            element.removeClass('ez-install-drop-over');
            files = filesFromEvent(event);
            if (files && files.length) {
              scope.$applyAsync(function () {
                scope.dropInstallFiles(files);
              });
            }
          });

          scope.$on('$destroy', function () {
            element.off('dragenter dragover dragleave dragend drop');
          });
        }
      };
    }])
    .run(['$rootScope', '$templateCache', '$window', 'ezremoteUx', 'fileNavigator', function ($rootScope, $templateCache, $window, ezremoteUx, fileNavigator) {
      $rootScope.ezremoteUx = ezremoteUx;
      try {
        $window.localStorage.setItem('viewTemplate', 'main-table.html');
      } catch (ignore) {}

      if (fileNavigator && fileNavigator.prototype && !fileNavigator.prototype.__ezremoteUxFiltered) {
        (function () {
          var originalRefresh = fileNavigator.prototype.refresh;
          fileNavigator.prototype.__ezremoteUxFiltered = true;
          fileNavigator.prototype.refresh = function () {
            var navigator = this;
            return originalRefresh.apply(navigator, arguments).then(function () {
              var treePath = (navigator.currentPath || []).join('/');
              navigator.requesting = true;
              return ezremoteUx.filterNavigatorList(navigator).then(function (items) {
                navigator.fileList = items;
                navigator.buildTree(treePath);
              }).finally(function () {
                navigator.requesting = false;
              });
            });
          };
        }());
      }

      $window.addEventListener('ezremote:api', function (event) {
        var detail = event.detail || {};
        if (detail.ignoreToast) {
          return;
        }
        $rootScope.$evalAsync(function () {
          if (detail.success) {
            ezremoteUx.notify('success', detail.label + ' complete', 'The file manager has been updated.');
          } else {
            ezremoteUx.notify('error', detail.label + ' failed', detail.error || 'The request could not be completed.');
          }
        });
      }, false);

      $templateCache.put('src/templates/current-folder-breadcrumb.html', [
        '<ol class="breadcrumb ez-breadcrumb ez-path-picker">',
        '  <li class="ez-path-node" ng-class="{open:pathMenu.openIndex === -1}">',
        '    <button type="button" class="ez-path-button" ng-click="togglePathSiblings(-1, $event)" title="Browse visible roots">/</button>',
        '    <ul class="ez-path-menu" ng-show="pathMenu.openIndex === -1" ng-click="$event.stopPropagation()">',
        '      <li class="ez-path-menu-status" ng-show="pathMenu.loading">Loading...</li>',
        '      <li class="ez-path-menu-status" ng-show="!pathMenu.loading && !pathMenu.items.length">No folders</li>',
        '      <li ng-repeat="sibling in pathMenu.items track by sibling.name" ng-class="{active:sibling.name === fileNavigator.currentPath[0]}"><a href="" ng-click="goToPathSibling(-1, sibling, $event)">{{sibling.name}}</a></li>',
        '    </ul>',
        '  </li>',
        '  <li ng-repeat="(key, dir) in fileNavigator.currentPath track by key" ng-class="{\'active\':$last, open:pathMenu.openIndex === key}" class="animated fast fadeIn ez-path-node">',
        '    <button type="button" class="ez-path-button" ng-click="togglePathSiblings(key, $event)" title="Show sibling folders">{{dir}}</button>',
        '    <ul class="ez-path-menu" ng-show="pathMenu.openIndex === key" ng-click="$event.stopPropagation()">',
        '      <li class="ez-path-menu-status" ng-show="pathMenu.loading">Loading...</li>',
        '      <li class="ez-path-menu-status" ng-show="!pathMenu.loading && !pathMenu.items.length">No siblings</li>',
        '      <li ng-repeat="sibling in pathMenu.items track by sibling.name" ng-class="{active:sibling.name === dir}"><a href="" ng-click="goToPathSibling(key, sibling, $event)">{{sibling.name}}</a></li>',
        '    </ul>',
        '  </li>',
        '</ol>'
      ].join('\n'));

      $templateCache.put('src/templates/main.html', [
        '<div class="ez-shell" ng-controller="FileManagerCtrl" ez-install-drop ng-class="{\'is-loading\': fileNavigator.requesting, \'has-selection\': temps.length}">',
        '  <header class="ez-topbar">',
        '    <div class="ez-brand">',
        '      <div class="ez-brand-title">ezRemote</div>',
        '      <div class="ez-brand-subtitle">Web File Manager</div>',
        '    </div>',
        '    <div class="ez-path-panel">',
        '      <span class="ez-path-label">Current path</span>',
        '      <div class="ez-path-row">',
        '        <div class="ez-path-readout" title="{{ezremoteUx.formatPath(fileNavigator.getBasePath(), fileNavigator.currentPath)}}">{{ezremoteUx.formatPath(fileNavigator.getBasePath(), fileNavigator.currentPath)}}</div>',
        '        <div class="ez-recent" ng-class="{open:recentMenuOpen}">',
        '          <button type="button" class="ez-recent-button" ng-click="toggleRecentPaths($event)" title="Recent paths"><i class="glyphicon glyphicon-time"></i> Recent</button>',
        '          <ul class="ez-recent-menu" ng-show="recentMenuOpen" ng-click="$event.stopPropagation()">',
        '            <li class="ez-path-menu-status" ng-show="!recentPaths.length">No recent paths</li>',
        '            <li ng-repeat="recentPath in recentPaths track by recentPath" ng-class="{active:recentPath === ezremoteUx.formatPath(fileNavigator.getBasePath(), fileNavigator.currentPath)}"><a href="" ng-click="goToRecentPath(recentPath, $event)">{{recentPath}}</a></li>',
        '            <li class="ez-recent-clear" ng-show="recentPaths.length"><a href="" ng-click="clearRecentPaths($event)">Clear recent paths</a></li>',
        '          </ul>',
        '        </div>',
        '      </div>',
        '      <div class="ez-breadcrumb-wrap" ng-include="config.tplPath + \'/current-folder-breadcrumb.html\'"></div>',
        '    </div>',
        '    <div class="ez-toolbar">',
        '      <label class="ez-search">',
        '        <span class="ez-filter-label">Filter</span>',
        '        <span class="ez-search-row">',
        '          <input type="text" class="form-control" ng-show="config.searchForm" placeholder="Search recursively" ng-model="query">',
        '          <label class="ez-depth-control" title="Recursive scan depth"><span>Depth</span><input type="number" min="0" max="6" ng-model="ezFilter.depth"></label>',
        '          <button type="button" class="btn ez-icon-button" ng-click="clearFilter()" ng-disabled="!query" title="Clear filter"><i class="glyphicon glyphicon-remove-circle"></i></button>',
        '        </span>',
        '        <span class="ez-filter-chips">',
        '          <button type="button" class="ez-filter-chip" ng-repeat="quickFilter in quickFilters" ng-class="{active:ezFilter.quick === quickFilter}" ng-click="setQuickFilter(quickFilter, $event)">{{quickFilter}}</button>',
        '        </span>',
        '      </label>',
        '      <label class="ez-chunk-control" title="Upload chunk size in MB"><span>Chunk MB</span><input type="number" min="1" ng-model="uploadChunkSizeMb" ng-change="setUploadChunkSize(uploadChunkSizeMb)" ng-blur="normalizeUploadChunkSize()"></label>',
        '      <div class="ez-view-controls" aria-label="Navigation controls">',
        '        <button type="button" class="btn ez-icon-button ez-mount-button" ng-click="goMountPath()" title="Open mounts"><i class="glyphicon glyphicon-hdd"></i><span class="ez-nav-label">/mnt</span></button>',
        '        <button type="button" class="btn ez-icon-button" ng-click="fileNavigator.refresh()" title="Refresh"><i class="glyphicon glyphicon-refresh"></i></button>',
        '      </div>',
        '    </div>',
        '  </header>',
        '',
        '  <section class="ez-actionbar" aria-label="File actions">',
        '    <div class="ez-action-strip">',
        '      <span class="ez-selection-pill" title="Selected items"><i class="glyphicon glyphicon-ok-circle"></i> {{temps.length || 0}} selected</span>',
        '      <button type="button" class="btn btn-primary ez-action-btn" ng-show="config.allowedActions.createFolder" ng-click="modal(\'newfolder\') && prepareNewFolder()" title="Create folder"><i class="glyphicon glyphicon-plus"></i><span class="ez-action-text">{{"new_folder" | translate}}</span></button>',
        '      <button type="button" class="btn btn-primary ez-action-btn" ng-show="config.allowedActions.upload" ng-click="modal(\'uploadfile\')" title="Upload files"><i class="glyphicon glyphicon-cloud-upload"></i><span class="ez-action-text">{{"upload_files" | translate}}</span></button>',
        '      <button type="button" class="ez-install-drop" ez-pkg-drop-zone ng-show="config.allowedActions.upload && config.allowedActions.install" ngf-select="dropInstallFiles($files)" ngf-multiple="true" title="Drop or choose PKG files to upload and install">',
        '        <i class="glyphicon glyphicon-hdd"></i>',
        '        <strong>Drop PKG</strong>',
        '        <span>Install from {{ezremoteUx.installDropTarget(fileNavigator.currentPath)}}</span>',
        '      </button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-click="temps=[]" ng-disabled="!temps.length" title="Clear selection"><i class="glyphicon glyphicon-remove-circle"></i><span class="ez-action-text">Clear</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-click="smartClick(singleSelection())" ng-disabled="!singleSelection() || !singleSelection().isFolder()" title="Open selected folder"><i class="glyphicon glyphicon-folder-open"></i><span class="ez-action-text">{{"open" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.preview" ng-click="openImagePreview()" ng-disabled="!singleSelection() || !singleSelection().isImage()" title="Preview image"><i class="glyphicon glyphicon-picture"></i><span class="ez-action-text">{{"view_item" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.edit" ng-click="openEditItem()" ng-disabled="!singleSelection() || !singleSelection().isEditable()" title="Edit file"><i class="glyphicon glyphicon-pencil"></i><span class="ez-action-text">{{"edit" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.download" ng-click="download()" ng-disabled="!singleSelection() || selectionHas(\'dir\')" title="Download selected file"><i class="glyphicon glyphicon-download-alt"></i><span class="ez-action-text">{{"download" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.downloadMultiple" ng-click="download()" ng-disabled="singleSelection() || !temps.length" title="Download selection as ZIP"><i class="glyphicon glyphicon-compressed"></i><span class="ez-action-text">Zip</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.rename" ng-click="modal(\'rename\')" ng-disabled="!singleSelection()" title="Rename selected item"><i class="glyphicon glyphicon-edit"></i><span class="ez-action-text">{{"rename" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.move" ng-click="modalWithPathSelector(\'move\')" ng-disabled="!temps.length" title="Move selection"><i class="glyphicon glyphicon-arrow-right"></i><span class="ez-action-text">{{"move" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.copy" ng-click="modalWithPathSelector(\'copy\')" ng-disabled="!temps.length" title="Copy selection"><i class="glyphicon glyphicon-log-out"></i><span class="ez-action-text">{{"copy" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.compress" ng-click="modal(\'compress\')" ng-disabled="!temps.length" title="Compress selection"><i class="glyphicon glyphicon-compressed"></i><span class="ez-action-text">{{"compress" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.extract" ng-click="modal(\'extract\')" ng-disabled="!singleSelection() || !singleSelection().isExtractable()" title="Extract archive"><i class="glyphicon glyphicon-export"></i><span class="ez-action-text">{{"extract" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.install" ng-click="install()" ng-disabled="!temps.length || !isInstallable()" title="Install selected PKG"><i class="glyphicon glyphicon-hdd"></i><span class="ez-action-text">{{"install" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.install_url" ng-click="modal(\'install_url\') && prepareInstallUrl()" title="Install from URL"><i class="glyphicon glyphicon-link"></i><span class="ez-action-text">{{"install_url" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.download_url" ng-click="modal(\'download_url\') && prepareDownloadUrl()" title="Download from URL"><i class="glyphicon glyphicon-cloud-download"></i><span class="ez-action-text">{{"download_url" | translate}}</span></button>',
        '      <button type="button" class="btn btn-default ez-action-btn" ng-show="config.allowedActions.changePermissions" ng-click="modal(\'changepermissions\')" ng-disabled="!temps.length" title="Change permissions"><i class="glyphicon glyphicon-lock"></i><span class="ez-action-text">{{"permissions" | translate}}</span></button>',
        '      <button type="button" class="btn btn-danger ez-action-btn" ng-show="config.allowedActions.remove" ng-click="modal(\'remove\')" ng-disabled="!temps.length" title="Remove selection"><i class="glyphicon glyphicon-trash"></i><span class="ez-action-text">{{"remove" | translate}}</span></button>',
        '    </div>',
        '  </section>',
        '',
        '  <section class="ez-statebar" aria-live="polite">',
        '    <div class="ez-state ez-loading" ng-show="fileNavigator.requesting"><i class="glyphicon glyphicon-refresh"></i><div><strong>Loading folder</strong><span>Keeping the current path visible while files load.</span></div></div>',
        '    <div class="ez-state ez-loading" ng-show="ezFilter.scanning"><i class="glyphicon glyphicon-search"></i><div><strong>Scanning recursively</strong><span>Searching {{ezFilter.depth}} layer(s) under the current path.</span></div></div>',
        '    <div class="ez-state ez-empty" ng-show="!fileNavigator.requesting && !fileNavigator.error && !query && fileNavigator.fileList.length < 1"><i class="glyphicon glyphicon-folder-open"></i><div><strong>Empty folder</strong><span>Create a folder or upload files to get started.</span></div></div>',
        '    <div class="ez-state ez-empty" ng-show="!fileNavigator.requesting && !fileNavigator.error && !ezFilter.scanning && query && ezFilter.active && ezFilter.results.length < 1"><i class="glyphicon glyphicon-search"></i><div><strong>No matches</strong><span>No items match the recursive filter.</span></div><button type="button" class="btn btn-default ez-state-action" ng-click="clearFilter()">Clear filter</button></div>',
        '    <div class="ez-state ez-error" ng-show="!fileNavigator.requesting && fileNavigator.error"><i class="glyphicon glyphicon-warning-sign"></i><div><strong>Could not load this folder</strong><span>{{fileNavigator.error}}</span></div><button type="button" class="btn btn-default ez-state-action" ng-click="fileNavigator.refresh()">Retry</button></div>',
        '  </section>',
        '',
        '  <div class="container-fluid ez-content">',
        '    <div class="ez-main main" ngf-model-options="{updateOn: \'drop\', allowInvalid: false, debounce: 0}" ngf-drop="addForUpload($files)" ngf-drag-over-class="\'upload-dragover\'" ngf-multiple="true">',
        '      <div class="ez-main-panel">',
        '        <div class="ez-main-heading">',
        '          <div class="ez-panel-nav" aria-label="Directory navigation">',
        '            <button type="button" class="btn btn-default ez-panel-nav-btn" ng-click="goPathBack()" ng-disabled="!navHistory.back.length" title="Back"><i class="glyphicon glyphicon-chevron-left"></i><span>Back</span></button>',
        '            <button type="button" class="btn btn-default ez-panel-nav-btn" ng-click="goPathForward()" ng-disabled="!navHistory.forward.length" title="Forward"><i class="glyphicon glyphicon-chevron-right"></i><span>Forward</span></button>',
        '            <button type="button" class="btn btn-default ez-panel-nav-btn" ng-click="goPathUp()" ng-disabled="!fileNavigator.currentPath.length" title="Up one folder"><i class="glyphicon glyphicon-chevron-up"></i><span>Up</span></button>',
        '          </div>',
        '          <div class="ez-sort-controls">',
        '            <span class="ez-sort-label">Sort by</span>',
        '            <button type="button" class="btn btn-default btn-sm ez-sort-button" ng-click="order(\'model.name\')" ng-class="{active:predicate[1] === \'model.name\'}">{{"name" | translate}}</button>',
        '            <button type="button" class="btn btn-default btn-sm ez-sort-button" ng-click="order(\'model.size\')" ng-class="{active:predicate[1] === \'model.size\'}" ng-hide="config.hideSize">{{"size" | translate}}</button>',
        '            <button type="button" class="btn btn-default btn-sm ez-sort-button" ng-click="order(\'model.date\')" ng-class="{active:predicate[1] === \'model.date\'}" ng-hide="config.hideDate">{{"date" | translate}}</button>',
        '          </div>',
        '          <div class="ez-view-name">List view</div>',
        '        </div>',
        '        <div ng-include="config.tplPath + \'/main-table.html\'" class="main-navigation clearfix"></div>',
        '      </div>',
        '    </div>',
        '  </div>',
        '',
        '  <div class="ez-toast-stack" aria-live="polite" aria-atomic="true">',
        '    <div class="ez-toast ez-toast-{{toast.type}}" ng-repeat="toast in ezremoteUx.toasts track by toast.id">',
        '      <div class="ez-toast-title">{{toast.title}}</div>',
        '      <div class="ez-toast-message" ng-show="toast.message">{{toast.message}}</div>',
        '    </div>',
        '  </div>',
        '',
        '  <div ng-include="config.tplPath + \'/modals.html\'"></div>',
        '  <div ng-include="config.tplPath + \'/item-context-menu.html\'"></div>',
        '</div>'
      ].join('\n'));

      $templateCache.put('src/templates/main-table.html', [
        '<table class="table mb0 table-files noselect ez-table-files">',
        '  <thead>',
        '    <tr>',
        '      <th><a href="" ng-click="order(\'model.name\')">{{"name" | translate}} <span class="sortorder" ng-show="predicate[1] === \'model.name\'" ng-class="{reverse:reverse}"></span></a></th>',
        '      <th class="hidden-xs" ng-hide="config.hideSize"><a href="" ng-click="order(\'model.size\')">{{"size" | translate}} <span class="sortorder" ng-show="predicate[1] === \'model.size\'" ng-class="{reverse:reverse}"></span></a></th>',
        '      <th class="hidden-sm hidden-xs" ng-hide="config.hideDate"><a href="" ng-click="order(\'model.date\')">{{"date" | translate}} <span class="sortorder" ng-show="predicate[1] === \'model.date\'" ng-class="{reverse:reverse}"></span></a></th>',
        '      <th class="hidden-sm hidden-xs" ng-hide="config.hidePermissions"><a href="" ng-click="order(\'model.permissions\')">{{"permissions" | translate}} <span class="sortorder" ng-show="predicate[1] === \'model.permissions\'" ng-class="{reverse:reverse}"></span></a></th>',
        '    </tr>',
        '  </thead>',
        '  <tbody class="file-item">',
        '    <tr ng-show="fileNavigator.requesting"><td colspan="5"><div ng-include="config.tplPath + \'/spinner.html\'"></div></td></tr>',
        '    <tr class="item-list" ng-repeat="item in $parent.fileList = ((ezFilter.active ? ezFilter.results : fileNavigator.fileList) | orderBy:predicate:reverse)" ng-show="!fileNavigator.requesting && !fileNavigator.error" ng-click="selectOrUnselect(item, $event)" ng-dblclick="smartClick(item)" ng-right-click="selectOrUnselect(item, $event)" ng-class="{selected: isSelected(item)}">',
        '      <td class="ez-name-cell">',
        '        <a href="" title="{{item.model.name}} ({{item.model.size | humanReadableFileSize}})">',
        '          <i class="glyphicon glyphicon-folder-close" ng-show="item.model.type === \'dir\'"></i>',
        '          <i class="glyphicon glyphicon-file" ng-show="item.model.type === \'file\'"></i>',
        '          <span><span>{{item.model.name}}</span><small class="ez-file-path" ng-show="ezFilter.active">{{item.model.fullPath()}}</small></span>',
        '        </a>',
        '      </td>',
        '      <td class="hidden-xs" ng-hide="config.hideSize"><span ng-show="item.model.type !== \'dir\' || config.showSizeForDirectories">{{item.model.size | humanReadableFileSize}}</span></td>',
        '      <td class="hidden-sm hidden-xs" ng-hide="config.hideDate">{{item.model.date | formatDate }}</td>',
        '      <td class="hidden-sm hidden-xs" ng-hide="config.hidePermissions">{{item.model.perms.toCode(item.model.type === \'dir\'?\'d\':\'-\')}}</td>',
        '    </tr>',
        '  </tbody>',
        '</table>'
      ].join('\n'));
    }]);
}(window, document, window.angular));
