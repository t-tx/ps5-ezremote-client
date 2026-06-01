import React from 'react';
import { X, PlayCircle, HardDrive, Hash, Shield } from 'lucide-react';
import { cn } from '../../utils/helpers';
import { getMainUrl } from '../../config';

const PkgInfoModal = ({ isOpen, onClose, onInstall, pkgInfo, fileName, isRemote }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity">
      <div 
        className="bg-[#1e1e24] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative animate-in fade-in zoom-in duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Background Image Blur */}
        <div 
          className="absolute inset-0 opacity-20 pointer-events-none bg-cover bg-center"
          style={{ backgroundImage: pkgInfo?.ICON_URL ? `url(${getMainUrl(pkgInfo.ICON_URL)})` : 'none' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1e1e24]/50 to-[#1e1e24] pointer-events-none" />

        <div className="relative p-6">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/40 text-white rounded-full transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex flex-col items-center mt-4">
            <div className="relative w-32 h-32 mb-6 rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-black/50">
              {pkgInfo?.ICON_URL ? (
                <img 
                  src={getMainUrl(pkgInfo.ICON_URL)} 
                  alt="Game Icon" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/30">
                  <PlayCircle className="w-12 h-12" />
                </div>
              )}
            </div>

            <h2 className="text-2xl font-bold text-white text-center mb-1 drop-shadow-md">
              {pkgInfo?.TITLE || fileName}
            </h2>
            
            {pkgInfo?.TITLE_ID && (
              <div className="bg-ps-blue/20 text-ps-blue px-3 py-1 rounded-full text-xs font-bold tracking-wider mb-6">
                {pkgInfo.TITLE_ID}
              </div>
            )}

            <div className="w-full space-y-3 bg-black/30 p-4 rounded-xl border border-white/5">
              {pkgInfo?.APP_VER && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-zinc-400 flex items-center gap-2">
                    <Shield className="w-4 h-4" /> App Version
                  </span>
                  <span className="text-white font-medium">{pkgInfo.APP_VER}</span>
                </div>
              )}
              {pkgInfo?.VERSION && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-zinc-400 flex items-center gap-2">
                    <Hash className="w-4 h-4" /> System Version
                  </span>
                  <span className="text-white font-medium">{pkgInfo.VERSION}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm">
                <span className="text-zinc-400 flex items-center gap-2">
                  <HardDrive className="w-4 h-4" /> Source
                </span>
                <span className="text-white font-medium">
                  {isRemote ? "Remote Server" : "Local Storage"}
                </span>
              </div>
            </div>

            <div className="flex gap-3 w-full mt-6">
              <button 
                onClick={onClose}
                className="flex-1 py-3 px-4 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={onInstall}
                className="flex-1 py-3 px-4 bg-ps-blue hover:bg-blue-500 text-white rounded-xl font-bold transition-all shadow-[0_0_20px_rgba(0,149,255,0.3)] hover:shadow-[0_0_30px_rgba(0,149,255,0.5)]"
              >
                Install
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PkgInfoModal;
