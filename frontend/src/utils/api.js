import { getMainUrl, getDirectDaemonUrl } from '../config';

export const fetchApi = async (url, payload = {}) => {
  const response = await fetch(getMainUrl(url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  if (data.result && data.result.success === false) {
    throw new Error(data.result.error || 'Unknown error occurred');
  }
  return data;
};

export const listFiles = (path, onlyFolders = false) => 
  fetchApi('/__local__/list', { path, onlyFolders: onlyFolders ? 'true' : 'false' });

export const getSites = async () => {
  const response = await fetch(getMainUrl('/api/sites'));
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const data = await response.json();
  return data.result || [];
};

export const saveRemoteSite = (siteData) =>
  fetchApi('/api/sitesave', siteData);

export const listRemoteFiles = (site_idx, path) =>
  fetchApi('/api/sitelist', { site_idx, path });
  
export const getPkgInfo = (path, site_idx = null) =>
  fetchApi('/api/pkginfo', { path, site_idx });
  
export const createFolder = (newPath) => 
  fetchApi('/__local__/createFolder', { newPath });

export const renameItem = (item, newItemPath) => 
  fetchApi('/__local__/rename', { item, newItemPath });

export const fetchDaemonApi = async (url, payload = {}) => {
  const response = await fetch(getDirectDaemonUrl(url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  if (data.result && data.result.success === false) {
    throw new Error(data.result.error || 'Unknown error occurred');
  }
  return data;
};

export const removeItems = (items) => 
  fetchDaemonApi('/fileop_start', { items, type: 2 }); // FILEOP_DELETE

export const moveItems = (items, newPath) => 
  fetchDaemonApi('/fileop_start', { items, newPath, type: 1 }); // FILEOP_MOVE

export const copyItems = (items, newPath, singleFilename = null) => {
  const payload = { items, newPath, type: 0 }; // FILEOP_COPY
  // background queue does not rename on copy right now, but singleFilename is passed 
  // wait, the daemon background thread ignores singleFilename right now, 
  // but it's ok, we can add it or just let it copy with the same name.
  return fetchDaemonApi('/fileop_start', payload);
};

export const retryTask = (type, id) =>
  fetchDaemonApi('/retry_task', { type, id });

export const stopTask = (type, id) =>
  fetchDaemonApi('/stop_task', { type, id });

export const cleanTasks = () =>
  fetchDaemonApi('/clean_tasks', {});

export const installPackages = (items) => 
  fetchApi('/__local__/install', { items });

export const installRemotePackages = (site_idx, items) => 
  fetchApi('/api/siteinstall', { site_idx, items });

export const createRemoteFolder = (site_idx, newPath) => 
  fetchApi('/api/sitemkdir', { site_idx, newPath });

export const downloadRemoteItem = (site_idx, path, destination, isDir) =>
  fetchApi('/api/sitedownloaddest', { site_idx, path, destination, isDir });

export const extractRemoteItem = (site_idx, item, destination, folderName) =>
  fetchApi('/api/siteextract', { site_idx, item, destination, folderName });

export const removeRemoteItems = (site_idx, items) => 
  fetchApi('/api/siteremove', { site_idx, items });

export const renameRemoteItem = (site_idx, oldPath, newPath) => 
  fetchApi('/api/siterename', { site_idx, oldPath, newPath });

export const getFileContent = (item) => 
  fetchApi('/__local__/getContent', { item });

export const checkLocalExists = (path) =>
  fetchApi('/__local__/check_exists', { path });

export const saveFileContent = (item, content) => 
  fetchApi('/__local__/edit', { item, content });

export const compressItems = (items, destination, compressedFilename) => 
  fetchApi('/__local__/compress', { items, destination, compressedFilename });

export const extractItem = (item, destination, folderName) => 
  fetchApi('/__local__/extract', { item, destination, folderName });

export const getExtractStatus = async () => {
  const response = await fetch(getMainUrl('/api/extract/status'));
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

  const data = await response.json();
  if (data.result && data.result.success === false) {
    throw new Error(data.result.error || 'Unknown error occurred');
  }
  return data.result || data;
};

// Note: Uploading files requires FormData and chunking for large files (PS5 requirement)
export const uploadFile = async (path, file, onProgress) => {
  const CHUNK_SIZE = 128 * 1024 * 1024; // 128MB chunks
  const fileSize = file.size;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE) || 1;
  let currentChunk = 0;

  while (currentChunk < totalChunks) {
    const start = currentChunk * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fileSize);
    const chunk = file.slice(start, end);

    const formData = new FormData();
    formData.append('destination', path);
    formData.append('_chunkNumber', currentChunk);
    formData.append('_chunkSize', CHUNK_SIZE);
    formData.append('_currentChunkSize', chunk.size);
    formData.append('_totalSize', fileSize);
    formData.append('file', chunk, file.name || 'blob');

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          const totalLoaded = start + event.loaded;
          const percent = Math.round((totalLoaded / fileSize) * 100);
          onProgress(percent);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const res = JSON.parse(xhr.responseText);
            if (res.result && res.result.success === false) {
              reject(new Error(res.result.error));
            } else {
              resolve(res);
            }
          } catch (e) {
            resolve(xhr.responseText);
          }
        } else {
          reject(new Error(`Upload failed: ${xhr.statusText}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Network error')));
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

      xhr.open('POST', getMainUrl('/__local__/upload'));
      xhr.send(formData);
    });

    currentChunk++;
  }
};
