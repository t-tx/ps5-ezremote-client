import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder, File, FileArchive, Package } from 'lucide-react';
import { cn } from '../../utils/helpers';
import { getMainUrl } from '../../config';
import { getPkgInfo, listFiles, listRemoteFiles } from '../../utils/api';

const PREVIEW_WIDTH = 288;
const PREVIEW_FILE_HEIGHT = 468;
const PREVIEW_FOLDER_HEIGHT = 260;
const PREVIEW_GAP = 16;
const PREVIEW_MARGIN = 16;
const gameIconCache = new Map();
const pkgIconCache = new Map();
const directoryPreviewCache = new Map();

const extractGameCode = (name) => {
  const match = String(name || '').match(/(^|[^A-Z0-9])([A-Z]{4}\d{5})(?=$|[^A-Z0-9])/i);
  return match ? match[2].toUpperCase() : null;
};

const isPkgFile = (file) => file?.type !== 'dir' && /\.pkg$/i.test(file?.name || '');

const itemPath = (currentPath, file) => {
  const basePath = currentPath && currentPath !== '/' ? currentPath.replace(/\/+$/, '') : '';
  return `${basePath}/${file.name}`;
};

const getCachedIcon = (file, currentPath, siteIdx) => {
  const gameCode = extractGameCode(file?.name);
  if (gameCode && gameIconCache.has(gameCode)) return gameIconCache.get(gameCode);
  if (isPkgFile(file)) {
    const key = `${siteIdx ?? 'local'}:${itemPath(currentPath, file)}`;
    if (pkgIconCache.has(key)) return pkgIconCache.get(key);
  }
  return null;
};

const directoryPreviewKey = (file, currentPath, siteIdx) => `${siteIdx ?? 'local'}:${itemPath(currentPath, file)}`;

const normalizePreviewEntries = (entries) => {
  return entries.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  }).slice(0, 5).map((entry) => ({
    name: entry.name || '',
    type: entry.type || 'file'
  }));
};

const resolveDirectoryPreview = async (file, currentPath, siteIdx) => {
  if (file?.type !== 'dir') return null;

  const key = directoryPreviewKey(file, currentPath, siteIdx);
  if (directoryPreviewCache.has(key)) return directoryPreviewCache.get(key);

  try {
    const path = itemPath(currentPath, file);
    const data = siteIdx === null ? await listFiles(path) : await listRemoteFiles(siteIdx, path);
    const entries = data.result || [];
    const preview = {
      status: 'ready',
      path,
      items: normalizePreviewEntries(entries),
      total: entries.length,
      hasPkg: entries.some(isPkgFile)
    };
    directoryPreviewCache.set(key, preview);
    return preview;
  } catch {
    const preview = { status: 'error', path: itemPath(currentPath, file), items: [], total: 0, hasPkg: false };
    directoryPreviewCache.set(key, preview);
    return preview;
  }
};

const resolveGameIcon = async (file, currentPath, siteIdx, options = {}) => {
  const gameCode = extractGameCode(file?.name);
  const forceGameCodeFetch = options.forceGameCodeFetch === true;

  if (gameCode) {
    if (gameIconCache.has(gameCode)) {
      const cachedIcon = gameIconCache.get(gameCode);
      if (cachedIcon || (!forceGameCodeFetch && !isPkgFile(file))) return cachedIcon;
    }

    if (forceGameCodeFetch || !gameIconCache.has(gameCode)) {
      const iconUrl = getMainUrl(`/game-icons/${encodeURIComponent(gameCode)}.png`);
      try {
        const response = await fetch(iconUrl, { method: 'GET', cache: forceGameCodeFetch ? 'no-cache' : 'force-cache' });
        if (response.ok) {
          gameIconCache.set(gameCode, iconUrl);
          return iconUrl;
        }
      } catch {
        gameIconCache.set(gameCode, null);
      }
      if (!gameIconCache.has(gameCode)) gameIconCache.set(gameCode, null);
    }
  }

  if (!isPkgFile(file)) return null;

  const path = itemPath(currentPath, file);
  const pkgCacheKey = `${siteIdx ?? 'local'}:${path}`;
  if (pkgIconCache.has(pkgCacheKey)) return pkgIconCache.get(pkgCacheKey);

  try {
    const pkgInfo = await getPkgInfo(path, siteIdx ?? null);
    const iconUrl = pkgInfo?.ICON_URL ? getMainUrl(pkgInfo.ICON_URL) : null;
    const titleId = pkgInfo?.TITLE_ID && String(pkgInfo.TITLE_ID).toUpperCase();

    pkgIconCache.set(pkgCacheKey, iconUrl);
    if (titleId && iconUrl) gameIconCache.set(titleId, iconUrl);
    return iconUrl;
  } catch {
    pkgIconCache.set(pkgCacheKey, null);
    return null;
  }
};

const FallbackIcon = ({ file }) => {
  if (file.type === 'dir') return <Folder className="w-8 h-8 text-ps-blue" />;
  if (isPkgFile(file)) return <Package className="w-8 h-8 text-purple-400" />;
  if (file.name.match(/\.(zip|rar|7z)$/i)) return <FileArchive className="w-8 h-8 text-yellow-400" />;
  return <File className="w-8 h-8 text-gray-400" />;
};

const MiniFallbackIcon = ({ file }) => {
  if (file.type === 'dir') return <Folder className="h-4 w-4 shrink-0 text-ps-blue" />;
  if (isPkgFile(file)) return <Package className="h-4 w-4 shrink-0 text-purple-300" />;
  if (file.name.match(/\.(zip|rar|7z)$/i)) return <FileArchive className="h-4 w-4 shrink-0 text-yellow-300" />;
  return <File className="h-4 w-4 shrink-0 text-zinc-500" />;
};

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

const previewPositionFor = (rect, previewHeight) => {
  const viewportWidth = window.innerWidth || PREVIEW_WIDTH + PREVIEW_MARGIN * 2;
  const viewportHeight = window.innerHeight || previewHeight + PREVIEW_MARGIN * 2;
  const width = Math.min(PREVIEW_WIDTH, viewportWidth - PREVIEW_MARGIN * 2);
  const height = Math.min(previewHeight, viewportHeight - PREVIEW_MARGIN * 2);
  const itemCenterX = rect.left + rect.width / 2;
  const itemCenterY = rect.top + rect.height / 2;
  const openLeft = itemCenterX >= viewportWidth / 2;
  const openUp = itemCenterY >= viewportHeight / 2;
  const left = openLeft ? rect.left - width - PREVIEW_GAP : rect.right + PREVIEW_GAP;
  const top = openUp ? rect.top - height - PREVIEW_GAP : rect.bottom + PREVIEW_GAP;

  return {
    left: clamp(left, PREVIEW_MARGIN, viewportWidth - width - PREVIEW_MARGIN),
    top: clamp(top, PREVIEW_MARGIN, viewportHeight - height - PREVIEW_MARGIN),
    width,
    transformOrigin: `${openLeft ? 'right' : 'left'} ${openUp ? 'bottom' : 'top'}`
  };
};

const useGameIcon = (file, currentPath, siteIdx) => {
  const [iconUrl, setIconUrl] = useState(() => getCachedIcon(file, currentPath, siteIdx));

  useEffect(() => {
    let isActive = true;

    resolveGameIcon(file, currentPath, siteIdx).then((resolvedIcon) => {
      if (isActive) setIconUrl(resolvedIcon);
    });

    return () => {
      isActive = false;
    };
  }, [file, currentPath, siteIdx]);

  return [iconUrl, setIconUrl];
};

const useFolderContainsPkg = (file, currentPath, siteIdx) => {
  const [containsPkg, setContainsPkg] = useState(() => {
    if (file?.type !== 'dir') return false;
    const cachedPreview = directoryPreviewCache.get(directoryPreviewKey(file, currentPath, siteIdx));
    return cachedPreview?.status === 'ready' && cachedPreview.hasPkg === true;
  });

  useEffect(() => {
    let isActive = true;

    if (file?.type !== 'dir') {
      return () => {
        isActive = false;
      };
    }

    resolveDirectoryPreview(file, currentPath, siteIdx).then((preview) => {
      if (isActive) setContainsPkg(preview?.status === 'ready' && preview.hasPkg === true);
    });

    return () => {
      isActive = false;
    };
  }, [file, currentPath, siteIdx]);

  return containsPkg;
};

const PreviewEntryIcon = ({ entry, parentPath, siteIdx, onIconResolved }) => {
  const [iconUrl, setIconUrl] = useGameIcon(entry, parentPath, siteIdx);

  useEffect(() => {
    if (iconUrl) onIconResolved?.();
  }, [iconUrl, onIconResolved]);

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="h-5 w-5 shrink-0 rounded-md border border-white/10 bg-black/40 object-cover shadow-sm"
        onError={() => setIconUrl(null)}
      />
    );
  }

  return <MiniFallbackIcon file={entry} />;
};

const DirectoryTreePreview = ({ preview, siteIdx, onChildIconResolved }) => {
  if (!preview) return null;

  if (preview.status === 'loading') {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-white/10" />
            <span className="h-3 flex-1 rounded-full bg-white/10" />
          </div>
        ))}
      </div>
    );
  }

  if (preview.status === 'error') {
    return <div className="rounded-xl border border-red-400/15 bg-red-500/10 px-3 py-2 text-xs text-red-200">Could not read this folder.</div>;
  }

  if (!preview.items.length) {
    return <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-400">Empty folder</div>;
  }

  return (
    <div className="space-y-1.5">
      {preview.items.map((entry, index) => (
        <div key={`${entry.type}:${entry.name}:${index}`} className="flex min-w-0 items-center gap-2 text-xs text-zinc-300">
          <span className="w-4 text-center font-mono text-zinc-600">{index === preview.items.length - 1 ? '`-' : '|-'}</span>
          <PreviewEntryIcon entry={entry} parentPath={preview.path} siteIdx={siteIdx} onIconResolved={onChildIconResolved} />
          <span className="truncate">{entry.name}</span>
        </div>
      ))}
      {preview.total > preview.items.length && (
        <div className="pl-5 text-[11px] font-medium text-zinc-500">+{preview.total - preview.items.length} more</div>
      )}
    </div>
  );
};

const GameIconPreview = ({ file, iconUrl, gameCode, position, directoryPreview, siteIdx, onChildIconResolved }) => {
  if ((!iconUrl && file.type !== 'dir') || !position || typeof document === 'undefined') return null;
  const hasIcon = !!iconUrl;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] overflow-hidden rounded-[28px] border border-white/15 bg-[#080b14]/95 text-white shadow-2xl shadow-black/70 ring-1 ring-ps-blue/25 backdrop-blur-xl"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        transformOrigin: position.transformOrigin
      }}
    >
      {file.type !== 'dir' && (
        <div className="relative aspect-square overflow-hidden bg-black">
          {hasIcon && (
            <>
              <img src={iconUrl} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-xl" />
              <img src={iconUrl} alt="" className="relative h-full w-full object-cover" />
            </>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-white/10" />
          <div className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/85 backdrop-blur-md">
            Preview
          </div>
        </div>
      )}
      <div className="space-y-2 p-4">
        <div className="line-clamp-2 text-sm font-semibold leading-snug text-white">{file.name}</div>
        <div className="flex items-center gap-2 text-xs">
          {gameCode && <span className="rounded-full bg-ps-blue/20 px-2.5 py-1 font-bold tracking-wide text-ps-blue">{gameCode}</span>}
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-zinc-300">{file.type === 'dir' ? 'Folder' : 'File'}</span>
        </div>
        {file.type === 'dir' && (
          <div className="mt-3 border-t border-white/10 pt-3">
            <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              <span>Contents</span>
              {directoryPreview?.status === 'ready' && <span>{Math.min(directoryPreview.total, 5)}/{directoryPreview.total}</span>}
            </div>
            <DirectoryTreePreview preview={directoryPreview || { status: 'loading', items: [], total: 0 }} siteIdx={siteIdx} onChildIconResolved={onChildIconResolved} />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

const FileCard = ({ file, currentPath, siteIdx, formatSize, onNavigate, onFileClick }) => {
  const cardRef = useRef(null);
  const [iconUrl, setIconUrl] = useGameIcon(file, currentPath, siteIdx);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(null);
  const [directoryPreview, setDirectoryPreview] = useState(null);
  const directoryPreviewRequestRef = useRef(0);
  const folderIconRetryRef = useRef(0);
  const folderContainsPkg = useFolderContainsPkg(file, currentPath, siteIdx);
  const gameCode = extractGameCode(file?.name);
  const packageHighlight = isPkgFile(file) || folderContainsPkg;

  useEffect(() => {
    return () => {
      directoryPreviewRequestRef.current += 1;
      folderIconRetryRef.current += 1;
    };
  }, []);

  const retryFolderIcon = () => {
    if (file.type !== 'dir' || iconUrl) return;

    const requestId = folderIconRetryRef.current + 1;
    folderIconRetryRef.current = requestId;

    resolveGameIcon(file, currentPath, siteIdx, { forceGameCodeFetch: true }).then((resolvedIcon) => {
      if (folderIconRetryRef.current === requestId && resolvedIcon) setIconUrl(resolvedIcon);
    });
  };

  const loadDirectoryPreview = () => {
    if (file.type !== 'dir') return;

    const key = directoryPreviewKey(file, currentPath, siteIdx);
    if (directoryPreviewCache.has(key)) {
      setDirectoryPreview(directoryPreviewCache.get(key));
      return;
    }

    const requestId = directoryPreviewRequestRef.current + 1;
    directoryPreviewRequestRef.current = requestId;
    setDirectoryPreview({ status: 'loading', items: [], total: 0 });

    resolveDirectoryPreview(file, currentPath, siteIdx).then((preview) => {
      if (directoryPreviewRequestRef.current === requestId) setDirectoryPreview(preview);
    });
  };

  const updatePreviewPosition = () => {
    if (!cardRef.current) return;
    setPreviewPosition(previewPositionFor(
      cardRef.current.getBoundingClientRect(),
      file.type === 'dir' ? PREVIEW_FOLDER_HEIGHT : PREVIEW_FILE_HEIGHT
    ));
  };

  const openPreview = () => {
    updatePreviewPosition();
    setPreviewOpen(true);
    loadDirectoryPreview();
    retryFolderIcon();
  };

  const closePreview = () => {
    setPreviewOpen(false);
  };

  useEffect(() => {
    if (!previewOpen || file.type !== 'dir' || iconUrl) return undefined;

    const requestId = folderIconRetryRef.current + 1;
    folderIconRetryRef.current = requestId;
    const retryTimer = window.setTimeout(() => {
      resolveGameIcon(file, currentPath, siteIdx, { forceGameCodeFetch: true }).then((resolvedIcon) => {
        if (folderIconRetryRef.current === requestId && resolvedIcon) setIconUrl(resolvedIcon);
      });
    }, 900);

    return () => window.clearTimeout(retryTimer);
  }, [previewOpen, file, currentPath, siteIdx, iconUrl, setIconUrl]);

  useEffect(() => {
    if (!previewOpen) return undefined;

    const handlePreviewViewportChange = () => {
      if (!cardRef.current) return;
      setPreviewPosition(previewPositionFor(
        cardRef.current.getBoundingClientRect(),
        file.type === 'dir' ? PREVIEW_FOLDER_HEIGHT : PREVIEW_FILE_HEIGHT
      ));
    };

    window.addEventListener('resize', handlePreviewViewportChange);
    window.addEventListener('scroll', handlePreviewViewportChange, true);

    return () => {
      window.removeEventListener('resize', handlePreviewViewportChange);
      window.removeEventListener('scroll', handlePreviewViewportChange, true);
    };
  }, [previewOpen, file.type]);

  const handleKeyDown = (e, action) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action(file);
    }
  };

  return (
    <div
      ref={cardRef}
      tabIndex="0"
      onMouseEnter={openPreview}
      onMouseLeave={closePreview}
      onFocus={openPreview}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closePreview();
      }}
      onKeyDown={(e) => handleKeyDown(e, () => file.type === 'dir' ? onNavigate(file.name) : onFileClick(file))}
      className={cn(
        "relative group flex items-center p-4 bg-ps-card rounded-2xl border border-ps-border transition-all duration-200 cursor-pointer",
        "hover:z-30 hover:bg-ps-blue/10 hover:border-ps-blue/50 focus:z-30 focus:outline-none focus:ring-4 focus:ring-ps-blue focus:bg-ps-blue/20 focus:scale-105",
        packageHighlight && "border-purple-400/60 bg-purple-500/[0.06] shadow-[0_0_28px_rgba(168,85,247,0.20)]"
      )}
      onClick={(e) => {
        if (!e.defaultPrevented) {
          if (file.type === 'dir') onNavigate(file.name);
          else onFileClick(file);
        }
      }}
    >
      {packageHighlight && (
        <>
          <span className="pointer-events-none absolute inset-0 rounded-2xl border border-purple-300/70 opacity-70 shadow-[0_0_22px_rgba(216,180,254,0.36)] animate-pulse" />
          <span className="pointer-events-none absolute left-5 top-0 h-px w-28 bg-gradient-to-r from-transparent via-purple-200 to-transparent opacity-90" />
        </>
      )}
      <div className="flex-shrink-0 mr-4">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            className="w-10 h-10 rounded-lg object-cover border border-white/10 bg-black/30 shadow-lg"
            onError={() => setIconUrl(null)}
          />
        ) : (
          <FallbackIcon file={file} />
        )}
      </div>
      <div className="flex-grow overflow-hidden">
        <h3 className={cn(
          "font-semibold text-lg truncate",
          file.type === 'dir' ? "text-ps-blue" : "text-zinc-200"
        )}>
          {file.name}
        </h3>
        <div className="flex items-center text-sm text-zinc-400 mt-1 space-x-3">
          {file.type !== 'dir' && <span>{formatSize(file.size)}</span>}
          {packageHighlight && <span className="rounded-full bg-purple-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-200">PKG</span>}
          <span className="truncate">{file.date}</span>
        </div>
      </div>
      {previewOpen && <GameIconPreview file={file} iconUrl={iconUrl} gameCode={gameCode} position={previewPosition} directoryPreview={directoryPreview} siteIdx={siteIdx} onChildIconResolved={retryFolderIcon} />}
    </div>
  );
};

const FileList = ({ files, isLoading, currentPath, siteIdx, onNavigate, onFileClick }) => {

  const formatSize = (size) => {
    if (!size || size === '') return '--';
    const s = parseInt(size, 10);
    if (isNaN(s)) return '--';
    if (s < 1024) return s + ' B';
    if (s < 1024 * 1024) return (s / 1024).toFixed(1) + ' KB';
    if (s < 1024 * 1024 * 1024) return (s / (1024 * 1024)).toFixed(1) + ' MB';
    return (s / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  if (isLoading) {
    return (
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((idx) => (
          <div key={idx} className="flex items-center p-4 bg-ps-card rounded-2xl border border-ps-border animate-pulse">
            <div className="w-8 h-8 rounded bg-white/10 mr-4 shrink-0"></div>
            <div className="flex-grow space-y-2">
              <div className="h-4 bg-white/10 rounded w-3/4"></div>
              <div className="h-3 bg-white/5 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-zinc-500 bg-ps-card rounded-3xl border border-ps-border mt-4 h-64 focus:outline-none focus:ring-4 focus:ring-ps-blue" tabIndex="0">
        <Folder className="w-16 h-16 mb-4 opacity-50" />
        <p className="text-xl">No files found in this directory.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {files.map((file) => (
        <FileCard
          key={`${siteIdx ?? 'local'}:${currentPath}:${file.type}:${file.name}`}
          file={file}
          currentPath={currentPath}
          siteIdx={siteIdx}
          formatSize={formatSize}
          onNavigate={onNavigate}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
};

export default FileList;
