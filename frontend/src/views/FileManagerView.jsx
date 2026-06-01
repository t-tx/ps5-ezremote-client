import React, { useState, useEffect } from 'react';
import Breadcrumbs from '../components/FileManager/Breadcrumbs';
import FileList from '../components/FileManager/FileList';
import UploadArea from '../components/FileManager/UploadArea';
import { listFiles, listRemoteFiles, getSites, createFolder, createRemoteFolder, removeItems, removeRemoteItems, renameItem, renameRemoteItem, installPackages, installRemotePackages, getPkgInfo, downloadRemoteItem, extractItem, extractRemoteItem, getExtractStatus } from '../utils/api';
import { getMainUrl } from '../config';
import { RefreshCw, FolderPlus, Globe, FileArchive } from 'lucide-react';
import PkgInfoModal from '../components/FileManager/PkgInfoModal';
import FileActionModal from '../components/FileManager/FileActionModal';
import { toast } from 'react-hot-toast';

const LOCATION_STORAGE_KEYS = {
  local: 'ezremote.fileManager.localLocation',
  remote: 'ezremote.fileManager.remoteLocation'
};

const storageKeyFor = (isRemote) => isRemote ? LOCATION_STORAGE_KEYS.remote : LOCATION_STORAGE_KEYS.local;

const normalizePath = (path) => {
  if (typeof path !== 'string' || !path.trim()) return '/';
  const normalized = `/${path.trim()}`.replace(/\/+/g, '/').replace(/\/$/, '');
  return normalized || '/';
};

const clearSavedLocation = (isRemote) => {
  try {
    window.localStorage.removeItem(storageKeyFor(isRemote));
  } catch {
    // localStorage can be disabled in private or embedded browser modes.
  }
};

const EXTRACT_STATE_COMPLETED = 2;
const EXTRACT_STATE_FAILED = 3;

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const progressPercent = (job) => {
  const total = Number(job?.bytes_to_download || 0);
  const done = Number(job?.bytes_transfered || 0);
  if (!total || done <= 0) return null;
  return Math.min(100, Math.round((done / total) * 100));
};

const readSavedLocation = (isRemote) => {
  try {
    const raw = window.localStorage.getItem(storageKeyFor(isRemote));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const path = normalizePath(saved?.path);
    const siteIdx = Number.parseInt(saved?.siteIdx, 10);

    if (isRemote) {
      if (!Number.isFinite(siteIdx)) throw new Error('Invalid saved site');
      return { path, siteIdx };
    }

    return { path };
  } catch {
    clearSavedLocation(isRemote);
    return null;
  }
};

const saveLocation = (isRemote, path, siteIdx) => {
  const state = { path: normalizePath(path) };
  if (isRemote) state.siteIdx = siteIdx;

  try {
    window.localStorage.setItem(storageKeyFor(isRemote), JSON.stringify(state));
  } catch {
    // Location persistence is a convenience; navigation should still work without it.
  }
};

const FileManagerView = ({ isRemote = false }) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pkgInfoLoading, setPkgInfoLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState(isRemote ? -1 : null); // null = Local PS5

  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [pkgInfoData, setPkgInfoData] = useState(null);
  const [installFile, setInstallFile] = useState(null);
  const [selectedFileForAction, setSelectedFileForAction] = useState(null);
  const [extractJobs, setExtractJobs] = useState([]);

  const fetchFiles = async (path, siteIdx = selectedSite, options = {}) => {
    const nextPath = normalizePath(path);
    const shouldSaveLocation = options.saveLocation !== false;
    setLoading(true);
    setError(null);
    try {
      let data;
      if (siteIdx === null) {
        data = await listFiles(nextPath);
      } else if (siteIdx === -1 || typeof siteIdx === 'undefined') {
        throw new Error('No remote site selected');
      } else {
        data = await listRemoteFiles(siteIdx, nextPath);
      }
      setFiles(data.result || []);
      setCurrentPath(nextPath);
      if (shouldSaveLocation) saveLocation(isRemote, nextPath, siteIdx);
      return true;
    } catch (err) {
      setError(err.message || 'Failed to load directory');
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isActive = true;

    const restoreLocation = async () => {
      if (!isActive) return;
      const savedLocation = readSavedLocation(isRemote);

      const loadRestoredFiles = async (path, siteIdx) => {
        const nextPath = normalizePath(path);
        setLoading(true);
        setError(null);
        try {
          const data = siteIdx === null ? await listFiles(nextPath) : await listRemoteFiles(siteIdx, nextPath);
          if (!isActive) return false;
          setFiles(data.result || []);
          setCurrentPath(nextPath);
          saveLocation(isRemote, nextPath, siteIdx);
          return true;
        } catch (err) {
          if (isActive) setError(err.message || 'Failed to load directory');
          return false;
        } finally {
          if (isActive) setLoading(false);
        }
      };

      if (isRemote) {
        try {
          const loadedSites = await getSites();
          if (!isActive) return;

          setSites(loadedSites);
          if (!loadedSites.length) {
            setSelectedSite(-1);
            clearSavedLocation(true);
            return;
          }

          const savedSite = savedLocation && loadedSites.find((site) => Number.parseInt(site.index, 10) === savedLocation.siteIdx);
          const siteIdx = savedSite ? savedSite.index : loadedSites[0].index;
          const path = savedSite ? savedLocation.path : '/';

          if (savedLocation && !savedSite) clearSavedLocation(true);
          setSelectedSite(siteIdx);

          const loaded = await loadRestoredFiles(path, siteIdx);
          if (!isActive) return;
          if (!loaded && path !== '/') {
            clearSavedLocation(true);
            await loadRestoredFiles('/', siteIdx);
          } else if (!loaded) {
            clearSavedLocation(true);
          }
        } catch (err) {
          if (isActive) setError(err.message || 'Failed to load sites');
        }
        return;
      }

      const path = savedLocation?.path || '/';
      const loaded = await loadRestoredFiles(path, null);
      if (!isActive) return;
      if (!loaded && path !== '/') {
        clearSavedLocation(false);
        await loadRestoredFiles('/', null);
      } else if (!loaded) {
        clearSavedLocation(false);
      }
    };

    const restoreTimer = window.setTimeout(restoreLocation, 0);
    return () => {
      isActive = false;
      window.clearTimeout(restoreTimer);
    };
  }, [isRemote]);

  useEffect(() => {
    let isActive = true;

    const loadExtractStatus = async () => {
      try {
        const status = await getExtractStatus();
        if (isActive) setExtractJobs(status.jobs || []);
      } catch {
        if (isActive) setExtractJobs([]);
      }
    };

    loadExtractStatus();
    const timer = window.setInterval(loadExtractStatus, 2000);
    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleNavigate = (folderName) => {
    if (folderName === '/') {
      fetchFiles('/');
      return;
    }
    const newPath = folderName.startsWith('/') ? folderName : (currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`);
    fetchFiles(newPath);
  };

  const handleCreateFolder = async () => {
    const name = prompt('Enter folder name:');
    if (!name) return;
    const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    try {
      if (selectedSite !== null && selectedSite !== -1) {
        await createRemoteFolder(selectedSite, newPath);
      } else {
        await createFolder(newPath);
      }
      fetchFiles(currentPath);
    } catch (err) {
      toast.error(`Failed to create folder: ${err.message}`);
    }
  };

  const handleDownload = async (file) => {
    const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    if (selectedSite !== null && selectedSite !== -1) {
      try {
        await downloadRemoteItem(selectedSite, fullPath);
        toast.success(`${file.name} download started in background!`);
      } catch (err) {
        toast.error(`Download failed: ${err.message}`);
      }
    } else {
      window.open(getMainUrl(`/__local__/downloadFile?path=${encodeURIComponent(fullPath)}`), '_blank');
    }
  };

  const handleDelete = async (file) => {
    if (!confirm(`Are you sure you want to delete ${file.name}?`)) return;
    const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    try {
      if (selectedSite !== null && selectedSite !== -1) {
        await removeRemoteItems(selectedSite, [fullPath]);
      } else {
        await removeItems([fullPath]);
      }
      fetchFiles(currentPath);
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  const handleRename = async (file) => {
    const newName = prompt(`Enter new name for ${file.name}:`, file.name);
    if (!newName || newName === file.name) return;

    const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    const newPath = currentPath === '/' ? `/${newName}` : `${currentPath}/${newName}`;

    try {
      if (selectedSite !== null && selectedSite !== -1) {
        await renameRemoteItem(selectedSite, fullPath, newPath);
      } else {
        await renameItem(fullPath, newPath);
      }
      fetchFiles(currentPath);
    } catch (err) {
      toast.error(`Rename failed: ${err.message}`);
    }
  };

  const handleExtract = async (file) => {
    const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    const folderName = file.name.replace(/\.[^/.]+$/, "");

    try {
      if (selectedSite !== null && selectedSite !== -1) {
        await extractRemoteItem(selectedSite, fullPath, folderName);
      } else {
        await extractItem(fullPath, '/data', folderName);
      }
      toast.success(`${file.name} extraction queued to /data/${folderName}`);
      const status = await getExtractStatus();
      setExtractJobs(status.jobs || []);
    } catch (err) {
      toast.error(`Extract failed: ${err.message}`);
    }
  };

  const handleInstall = async (file) => {
    const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    
    setInstallFile(file);
    setInstallModalOpen(true);
    setPkgInfoLoading(true);
    setPkgInfoData(null);

    try {
      const data = await getPkgInfo(fullPath, selectedSite === -1 ? null : selectedSite);
      setPkgInfoData(data);
    } catch (err) {
      console.error("Failed to load PKG info:", err);
      setPkgInfoData(null);
    } finally {
      setPkgInfoLoading(false);
    }
  };

  const confirmInstall = async () => {
    if (!installFile) return;
    const fullPath = currentPath === '/' ? `/${installFile.name}` : `${currentPath}/${installFile.name}`;
    setInstallModalOpen(false);
    try {
      if (selectedSite !== null && selectedSite !== -1) {
        await installRemotePackages(selectedSite, [fullPath]);
      } else {
        await installPackages([fullPath]);
      }
      toast.success(`${installFile.name} installation started!`);
    } catch (err) {
      toast.error(`Install failed: ${err.message}`);
    }
    setInstallFile(null);
  };

  const visibleExtractJobs = extractJobs.slice(-3).reverse();

  return (
    <div className="max-w-6xl mx-auto w-full space-y-4">
      <PkgInfoModal 
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        onInstall={confirmInstall}
        pkgInfo={pkgInfoData}
        fileName={installFile?.name}
        isRemote={isRemote}
        isLoading={pkgInfoLoading}
      />
      <FileActionModal 
        isOpen={!!selectedFileForAction}
        file={selectedFileForAction}
        isRemote={isRemote}
        onClose={() => setSelectedFileForAction(null)}
        onDownload={handleDownload}
        onExtract={handleExtract}
        onInstall={handleInstall}
        onRename={handleRename}
        onDelete={handleDelete}
      />
      <div className="flex items-center justify-between mb-2 flex-wrap gap-4">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold text-white tracking-tight">{isRemote ? "Remote Sites" : "Local Storage"}</h1>
          {isRemote && (
            <div className="relative">
              <select
                value={selectedSite === null || selectedSite === -1 ? "" : selectedSite}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setSelectedSite(val);
                  fetchFiles('/', val);
                }}
                className="appearance-none bg-ps-card border border-ps-border hover:border-ps-blue focus:border-ps-blue text-white text-sm rounded-xl px-4 py-2 pr-10 focus:outline-none focus:ring-4 focus:ring-ps-blue/30 transition-all font-medium"
              >
                {sites.map(site => (
                  <option key={site.index} value={site.index}>{site.name} ({site.server})</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
                <Globe className="w-4 h-4" />
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-3">
          {selectedSite === null && (
            <button 
              onClick={handleCreateFolder}
              tabIndex="0"
              className="flex items-center space-x-2 bg-ps-card border border-ps-border hover:bg-ps-blue/10 hover:border-ps-blue/50 focus:outline-none focus:ring-4 focus:ring-ps-blue text-white px-4 py-2 rounded-xl transition-all font-medium text-sm"
            >
              <FolderPlus className="w-4 h-4" />
              <span>New Folder</span>
            </button>
          )}
          <button 
            onClick={() => fetchFiles(currentPath)}
            disabled={loading}
            tabIndex="0"
            className="p-2.5 bg-ps-card border border-ps-border hover:bg-white/10 focus:outline-none focus:ring-4 focus:ring-white text-white rounded-xl transition-all disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <Breadcrumbs currentPath={currentPath} onNavigate={handleNavigate} />

      {visibleExtractJobs.length > 0 && (
        <div className="space-y-2">
          {visibleExtractJobs.map((job) => {
            const percent = progressPercent(job);
            const isFailed = job.state === EXTRACT_STATE_FAILED;
            const isDone = job.state === EXTRACT_STATE_COMPLETED;
            const title = isFailed ? 'Extraction failed' : isDone ? 'Extracted' : 'Extracting';
            const borderTone = isFailed ? 'border-red-500/30 bg-red-500/10' : isDone ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-yellow-500/30 bg-yellow-500/10';
            const barTone = isFailed ? 'bg-red-400' : isDone ? 'bg-emerald-400' : 'bg-yellow-400';

            return (
              <div key={job.id} className={`rounded-2xl border p-4 ${borderTone}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="rounded-xl bg-black/30 p-2 text-yellow-300">
                      <FileArchive className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-white">{title} {job.folder_name}</div>
                      <div className="truncate text-sm text-zinc-300">{job.error || job.message || job.final_path}</div>
                    </div>
                  </div>
                  <div className="text-right text-sm font-medium text-zinc-200">
                    <div className="capitalize">{String(job.state_text || '').replace('_', ' ')}</div>
                    {percent !== null && <div className="text-xs text-zinc-400">{formatBytes(job.bytes_transfered)} / {formatBytes(job.bytes_to_download)}</div>}
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/40">
                  <div className={`h-full rounded-full transition-all ${barTone}`} style={{ width: `${isDone ? 100 : percent || 8}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl">
          {error}
        </div>
      )}

      <FileList 
        files={files} 
        isLoading={loading}
        currentPath={currentPath}
        siteIdx={selectedSite === -1 ? null : selectedSite}
        onNavigate={handleNavigate}
        onFileClick={(file) => setSelectedFileForAction(file)}
      />

      {selectedSite === null && (
        <UploadArea 
          currentPath={currentPath} 
          onUploadComplete={() => fetchFiles(currentPath)} 
        />
      )}
    </div>
  );
};

export default FileManagerView;
