import React, { useState } from 'react';
import { Folder, File, Download, Trash2, Edit, FileArchive, Package, MoreHorizontal } from 'lucide-react';
import { cn } from '../../utils/helpers';

const FileList = ({ files, isLoading, currentPath, onNavigate, onFileClick }) => {

  const getFileIcon = (file) => {
    if (file.type === 'dir') return <Folder className="w-8 h-8 text-ps-blue" />;
    if (file.name.endsWith('.pkg')) return <Package className="w-8 h-8 text-purple-400" />;
    if (file.name.match(/\.(zip|rar|7z)$/i)) return <FileArchive className="w-8 h-8 text-yellow-400" />;
    return <File className="w-8 h-8 text-gray-400" />;
  };

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

  // Handle D-pad / Keyboard navigation
  const handleKeyDown = (e, file, action) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action(file);
    }
  };

  return (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {files.map((file, idx) => (
        <div 
          key={idx}
          tabIndex="0"
          onKeyDown={(e) => handleKeyDown(e, file, () => file.type === 'dir' ? onNavigate(file.name) : onFileClick(file))}
          className={cn(
            "relative group flex items-center p-4 bg-ps-card rounded-2xl border border-ps-border transition-all duration-200 cursor-pointer",
            "hover:bg-ps-blue/10 hover:border-ps-blue/50 focus:outline-none focus:ring-4 focus:ring-ps-blue focus:bg-ps-blue/20 focus:scale-105"
          )}
          onClick={(e) => {
            if (!e.defaultPrevented) {
              if (file.type === 'dir') onNavigate(file.name);
              else onFileClick(file);
            }
          }}
        >
          <div className="flex-shrink-0 mr-4">
            {getFileIcon(file)}
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
              <span className="truncate">{file.date}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default FileList;
