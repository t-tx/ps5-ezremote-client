import React from 'react';
import { X, Download, Trash2, Edit, Package, File, FileArchive, Folder, Scissors, Copy } from 'lucide-react';
import { cn } from '../../utils/helpers';

const FileActionModal = ({ isOpen, file, isRemote, onClose, onDownload, onExtract, onInstall, onRename, onDelete, onCut, onCopy }) => {
  if (!isOpen || !file) return null;

  const fileName = file.name || '';
  const isPkg = /\.pkg$/i.test(fileName) && file.type !== 'dir';
  const isExtractable = /\.(zip|rar|7z|tar\.gz|tar\.xz|tar\.bz2)$/i.test(fileName) && file.type !== 'dir';
  const isDir = file.type === 'dir';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose}>
      <div 
        className="bg-[#1e1e24] border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden relative animate-in fade-in zoom-in duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-white/5 hover:bg-white/10 text-white rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col items-center mb-6 mt-2">
            <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-4">
              {isDir ? (
                <Folder className="w-8 h-8 text-ps-blue" />
              ) : isPkg ? (
                <Package className="w-8 h-8 text-purple-400" />
              ) : isExtractable ? (
                <FileArchive className="w-8 h-8 text-yellow-400" />
              ) : (
                <File className="w-8 h-8 text-ps-blue" />
              )}
            </div>
            <h2 className="text-xl font-bold text-white text-center break-all">
              {fileName}
            </h2>
            {isExtractable && (
              <p className="mt-2 text-center text-sm text-zinc-400">
                Choose whether to save the archive as-is or extract it to a folder.
              </p>
            )}
            {isDir && (
              <p className="mt-2 text-center text-sm text-zinc-400">
                Folder actions
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {isPkg && (
              <button
                autoFocus
                onClick={() => { onClose(); onInstall(file); }}
                className="col-span-2 flex items-center justify-center gap-2 p-4 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-xl font-bold transition-all border border-purple-500/30 hover:border-purple-500/50"
              >
                <Package className="w-5 h-5" /> Install PKG
              </button>
            )}

            <button 
              onClick={() => { onClose(); onDownload(file); }}
              className={cn(
                "flex items-center justify-center gap-2 p-4 bg-ps-blue/20 hover:bg-ps-blue/30 text-ps-blue rounded-xl font-bold transition-all border border-ps-blue/30 hover:border-ps-blue/50",
                !isExtractable && "col-span-2"
              )}
            >
              <Download className="w-5 h-5" /> Download
            </button>

            {isExtractable && (
              <button
                onClick={() => { onClose(); onExtract(file); }}
                className="flex items-center justify-center gap-2 p-4 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-xl font-bold transition-all border border-yellow-500/30 hover:border-yellow-500/50"
              >
                <FileArchive className="w-5 h-5" /> Extract
              </button>
            )}

            {!isRemote && (
              <>
                <button
                  onClick={() => { onClose(); onCut(file); }}
                  className="flex items-center justify-center gap-2 p-3 bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 rounded-xl font-medium transition-all"
                >
                  <Scissors className="w-4 h-4" /> Cut
                </button>
                <button
                  onClick={() => { onClose(); onCopy(file); }}
                  className="flex items-center justify-center gap-2 p-3 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 rounded-xl font-medium transition-all"
                >
                  <Copy className="w-4 h-4" /> Copy
                </button>
              </>
            )}

            {!isRemote && !isExtractable && (
              <>
                <button 
                  onClick={() => { onClose(); onRename(file); }}
                  className="flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-all"
                >
                  <Edit className="w-4 h-4" /> Rename
                </button>
                <button 
                  onClick={() => { onClose(); onDelete(file); }}
                  className="flex items-center justify-center gap-2 p-3 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl font-medium transition-all"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileActionModal;
