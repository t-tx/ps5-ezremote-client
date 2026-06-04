import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const OverwriteModal = ({ isOpen, onClose, onConfirm, targetPath, actionType }) => {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    let isActive = true;
    const focusTimer = setTimeout(() => {
      if (modalRef.current) {
        const firstFocusable = modalRef.current.querySelector('button, input, [tabindex="0"]');
        if (firstFocusable) firstFocusable.focus();
      }
    }, 50);

    return () => {
      isActive = false;
      clearTimeout(focusTimer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in px-4">
      <div
        ref={modalRef}
        className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Overwrite Confirmation
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
            tabIndex="0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto max-h-[60vh] custom-scrollbar">
          <p className="text-zinc-300 mb-4">
            The destination path already exists. If you proceed with this {actionType.toLowerCase()}, the existing item will be completely 
            <strong className="text-red-400"> deleted and overwritten</strong>.
          </p>
          <div className="bg-red-500/10 border border-red-500/20 text-red-300 p-4 rounded-xl break-all font-mono text-sm">
            {targetPath}
          </div>
          <p className="text-zinc-400 mt-4 text-sm">
            Are you sure you want to delete the existing item and continue?
          </p>
        </div>

        <div className="p-6 border-t border-white/10 flex justify-end gap-3 bg-black/20 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl font-bold text-white bg-white/5 hover:bg-white/10 transition-all focus:ring-4 focus:ring-white/20"
            tabIndex="0"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-500 transition-all focus:ring-4 focus:ring-red-500/50"
            tabIndex="0"
          >
            Delete & Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default OverwriteModal;
