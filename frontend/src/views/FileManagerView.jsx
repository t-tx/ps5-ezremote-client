import React, { useState, useEffect } from 'react';
import Breadcrumbs from '../components/FileManager/Breadcrumbs';
import FileList, { directoryPreviewCache, directoryPreviewKey } from '../components/FileManager/FileList';
import UploadArea from '../components/FileManager/UploadArea';
import { listFiles, listRemoteFiles, getSites, createFolder, createRemoteFolder, removeItems, removeRemoteItems, renameItem, renameRemoteItem, installPackages, installRemotePackages, getPkgInfo, downloadRemoteItem, extractItem, extractRemoteItem, checkLocalExists } from '../utils/api';
import { getMainUrl } from '../config';
import { RefreshCw, FolderPlus, Globe } from 'lucide-react';
import PkgInfoModal from '../components/FileManager/PkgInfoModal';
import FileActionModal from '../components/FileManager/FileActionModal';
import DestinationModal from '../components/FileManager/DestinationModal';
import OverwriteModal from '../components/FileManager/OverwriteModal';
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

const joinPath = (basePath, name) => {
  const path = normalizePath(basePath);
  return path === '/' ? `/${name}` : `${path}/${name}`;
};

const isPkgName = (name) => /\.pkg$/i.test(String(name || ''));

const FileManagerView = ({ isRemote = false }) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pkgInfoLoading, setPkgInfoLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState(isRemote ? -1 : null); // null = Local PS5

  const [filterPS5, setFilterPS5] = useState(false);
  const [filterPKG, setFilterPKG] = useState(false);

  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [pkgInfoData, setPkgInfoData] = useState(null);
  const [installFile, setInstallFile] = useState(null);
  const [selectedFileForAction, setSelectedFileForAction] = useState(null);

  const [destModalOpen, setDestModalOpen] = useState(false);
  const [destModalAction, setDestModalAction] = useState(null); // 'Download' or 'Extract'
  const [destModalFile, setDestModalFile] = useState(null);
  
  const [overwriteModalData, setOverwriteModalData] = useState({ isOpen: false, destination: '', expectedDest: '', action: null, file: null, fullPath: '' });

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
    if (selectedSite !== null && selectedSite !== -1) {
      setDestModalFile(file);
      setDestModalAction('Download');
      setDestModalOpen(true);
    } else {
      const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
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
    setDestModalFile(file);
    setDestModalAction('Extract');
    setDestModalOpen(true);
  };

  const confirmDestinationAction = async (destination) => {
    setDestModalOpen(false);
    if (!destModalFile || !destModalAction) return;

    const file = destModalFile;
    const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    
    await executeDestAction(destModalAction, file, fullPath, destination);
  };

  const confirmOverwrite = async () => {
    const { action, file, fullPath, destination, expectedDest } = overwriteModalData;
    setOverwriteModalData({ isOpen: false, destination: '', expectedDest: '', action: null, file: null, fullPath: '' });

    try {
      // Delete the existing file/folder locally first
      await removeItems([expectedDest]);
      // Then proceed
      await executeDestAction(action, file, fullPath, destination);
    } catch (err) {
      toast.error(`Overwrite failed: ${err.message}`);
    }
    
    setDestModalFile(null);
    setDestModalAction(null);
  };

  const executeDestAction = async (action, file, fullPath, destination) => {
    try {
      if (action === 'Download') {
        await downloadRemoteItem(selectedSite, fullPath, destination, file.type === 'dir');
        toast.success(`${file.name} download started to ${destination}!`);
      } else if (action === 'Extract') {
        const folderName = file.name.replace(/\.[^/.]+$/, "");
        if (selectedSite !== null && selectedSite !== -1) {
          await extractRemoteItem(selectedSite, fullPath, destination, folderName);
        } else {
          await extractItem(fullPath, destination, folderName);
        }
        toast.success(`${file.name} extraction queued. Check Background Jobs for progress.`);
      }
    } catch (err) {
      if (err.message && err.message.startsWith('EXISTS:')) {
        const expectedDest = err.message.substring(7);
        setOverwriteModalData({
          isOpen: true,
          destination,
          expectedDest,
          action,
          file,
          fullPath
        });
      } else {
        toast.error(`${action} failed: ${err.message}`);
      }
    }

    setDestModalFile(null);
    setDestModalAction(null);
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

  // Removed blocking directory tag fetch loop.
  // We now rely on the lazy-loaded directoryPreviewCache from FileList.

  const [cacheUpdateTrigger, setCacheUpdateTrigger] = useState(0);

  useEffect(() => {
    const onCacheUpdate = () => setCacheUpdateTrigger(t => t + 1);
    window.addEventListener('directoryPreviewCacheUpdated', onCacheUpdate);
    return () => window.removeEventListener('directoryPreviewCacheUpdated', onCacheUpdate);
  }, []);

  const filteredFiles = files.filter(file => {
    if (!filterPS5 && !filterPKG) return true;

    if (file.type !== 'dir') {
       const isPKG = isPkgName(file.name);
       if (filterPS5 && filterPKG) return isPKG; 
       if (filterPS5) return false;
       if (filterPKG) return isPKG;
    }

    const siteIdx = selectedSite === -1 ? null : selectedSite;
    const key = directoryPreviewKey(file, currentPath, siteIdx);
    const cached = directoryPreviewCache.get(key);

    if (!cached || cached.status !== 'ready') return true; 
    
    const isPS5 = cached.hasPS5Game;
    const isPKG = cached.hasPkg;

    if (filterPS5 && filterPKG) return isPS5 || isPKG;
    if (filterPS5) return isPS5;
    if (filterPKG) return isPKG;

    return true;
  });

  const filterButtonClass = (active, activeClass) => [
    'rounded-xl border px-3.5 py-2 text-xs font-black uppercase tracking-[0.18em] transition-all focus:outline-none focus:ring-4',
    active
      ? activeClass
      : 'border-ps-border bg-ps-card text-zinc-400 hover:border-white/20 hover:bg-white/10 hover:text-white focus:ring-white/20'
  ].join(' ');

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
      {destModalOpen && (
        <DestinationModal
          isOpen={destModalOpen}
          onClose={() => setDestModalOpen(false)}
          onConfirm={confirmDestinationAction}
          fileName={destModalFile?.name}
          actionName={destModalAction || ''}
        />
      )}

      {overwriteModalData.isOpen && (
        <OverwriteModal
          isOpen={overwriteModalData.isOpen}
          onClose={() => setOverwriteModalData({ ...overwriteModalData, isOpen: false })}
          onConfirm={confirmOverwrite}
          targetPath={overwriteModalData.expectedDest}
          actionType={overwriteModalData.action}
        />
      )}

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
          <button
            type="button"
            aria-pressed={filterPS5}
            onClick={() => setFilterPS5((value) => !value)}
            className={filterButtonClass(filterPS5, 'border-ps-blue bg-ps-blue text-white shadow-[0_0_18px_rgba(0,149,255,0.35)] focus:ring-ps-blue/40')}
          >
            PS5
          </button>
          <button
            type="button"
            aria-pressed={filterPKG}
            onClick={() => setFilterPKG((value) => !value)}
            className={filterButtonClass(filterPKG, 'border-purple-400 bg-purple-500/90 text-white shadow-[0_0_18px_rgba(168,85,247,0.35)] focus:ring-purple-500/40')}
          >
            PKG
          </button>

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

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl">
          {error}
        </div>
      )}

      <FileList
        files={filteredFiles}
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
