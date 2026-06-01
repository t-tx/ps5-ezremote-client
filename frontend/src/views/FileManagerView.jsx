import React, { useState, useEffect } from 'react';
import Breadcrumbs from '../components/FileManager/Breadcrumbs';
import FileList from '../components/FileManager/FileList';
import UploadArea from '../components/FileManager/UploadArea';
import { listFiles, listRemoteFiles, getSites, createFolder, createRemoteFolder, removeItems, removeRemoteItems, renameItem, renameRemoteItem, installPackages, installRemotePackages, getPkgInfo } from '../utils/api';
import { getMainUrl } from '../config';
import { RefreshCw, FolderPlus, Globe } from 'lucide-react';
import PkgInfoModal from '../components/FileManager/PkgInfoModal';
import FileActionModal from '../components/FileManager/FileActionModal';

const FileManagerView = ({ isRemote = false }) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [sites, setSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState(isRemote ? -1 : null); // null = Local PS5

  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [pkgInfoData, setPkgInfoData] = useState(null);
  const [installFile, setInstallFile] = useState(null);
  const [selectedFileForAction, setSelectedFileForAction] = useState(null);

  const loadSites = async () => {
    try {
      const s = await getSites();
      setSites(s);
      if (isRemote && s.length > 0) {
        setSelectedSite(s[0].index);
        fetchFiles('/', s[0].index);
      }
    } catch (e) {
      console.error("Failed to load sites", e);
    }
  };

  const fetchFiles = async (path, siteIdx = selectedSite) => {
    setLoading(true);
    setError(null);
    try {
      let data;
      if (siteIdx === null) {
        data = await listFiles(path);
      } else {
        data = await listRemoteFiles(siteIdx, path);
      }
      setFiles(data.result || []);
      setCurrentPath(path);
    } catch (err) {
      setError(err.message || 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isRemote) {
      loadSites();
    } else {
      fetchFiles('/');
    }
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
      alert(`Failed to create folder: ${err.message}`);
    }
  };

  const handleDownload = (file) => {
    const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    if (selectedSite !== null && selectedSite !== -1) {
      window.open(getMainUrl(`/api/sitedownload?site_idx=${selectedSite}&path=${encodeURIComponent(fullPath)}`), '_blank');
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
      alert(`Delete failed: ${err.message}`);
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
      alert(`Rename failed: ${err.message}`);
    }
  };

  const handleInstall = async (file) => {
    const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    
    setLoading(true);
    try {
      const data = await getPkgInfo(fullPath, selectedSite === -1 ? null : selectedSite);
      setPkgInfoData(data);
    } catch (err) {
      console.error("Failed to load PKG info:", err);
      // Fallback to empty if it fails
      setPkgInfoData(null);
    } finally {
      setLoading(false);
    }

    setInstallFile(file);
    setInstallModalOpen(true);
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
      alert(`${installFile.name} installation started!`);
    } catch (err) {
      alert(`Install failed: ${err.message}`);
    }
    setInstallFile(null);
  };

  return (
    <div className="max-w-6xl mx-auto w-full space-y-4">
      <PkgInfoModal 
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        onInstall={confirmInstall}
        pkgInfo={pkgInfoData}
        fileName={installFile?.name}
        isRemote={isRemote}
      />
      <FileActionModal 
        isOpen={!!selectedFileForAction}
        file={selectedFileForAction}
        isRemote={isRemote}
        onClose={() => setSelectedFileForAction(null)}
        onDownload={handleDownload}
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

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl">
          {error}
        </div>
      )}

      <FileList 
        files={files} 
        isLoading={loading}
        currentPath={currentPath}
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
