import React, { useState, useEffect, useRef } from 'react';
import { HardDrive, Loader2, X } from 'lucide-react';
import { getDirectDaemonUrl } from '../../config';

const DestinationModal = ({ isOpen, onClose, onConfirm, fileName, actionName }) => {
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // Now stores the object
  const modalRef = useRef(null);

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    let isActive = true;
    const focusTimer = setTimeout(() => {
      if (modalRef.current) {
        const firstFocusable = modalRef.current.querySelector('button, input, [tabindex="0"]');
        if (firstFocusable) firstFocusable.focus();
      }
    }, 50);

    fetch(getDirectDaemonUrl('/get_destinations'))
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch destinations');
        return r.json();
      })
      .then(data => {
        if (!isActive) return;
        setDestinations(data);
        if (data.length > 0) setSelected(data[0]);
        setLoading(false);
      })
      .catch(err => {
        if (!isActive) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      isActive = false;
      clearTimeout(focusTimer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in px-4">
      <div
        ref={modalRef}
        className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-ps-blue" />
            Select Destination
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
            Where would you like to {actionName.toLowerCase()} <strong className="text-white break-all">{fileName}</strong>?
          </p>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-8 text-zinc-500">
              <Loader2 className="w-8 h-8 animate-spin mb-4 text-ps-blue" />
              <p>Scanning storage devices...</p>
            </div>
          ) : error ? (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl">
              Failed to load destinations: {error}
            </div>
          ) : destinations.length === 0 ? (
            <div className="text-center text-zinc-500 py-8">
              No suitable destination folders found.
            </div>
          ) : (
            <div className="space-y-3">
              {destinations.map(dest => {
                const isSelected = selected && selected.path === dest.path;
                const hasStats = dest.total && dest.total > 0;
                const percentUsed = hasStats ? ((dest.total - dest.free) / dest.total) * 100 : 0;

                return (
                  <label
                    key={dest.path}
                    className={`block p-4 border rounded-xl cursor-pointer transition-all ${
                      isSelected
                        ? 'border-ps-blue bg-ps-blue/10'
                        : 'border-white/10 hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center">
                      <input
                        type="radio"
                        name="destination"
                        value={dest.path}
                        checked={isSelected}
                        onChange={() => setSelected(dest)}
                        className="w-4 h-4 text-ps-blue bg-black/50 border-white/20 focus:ring-ps-blue focus:ring-2"
                      />
                      <span className="ml-3 text-white font-medium break-all flex-1">{dest.path}</span>
                    </div>
                    {hasStats && (
                      <div className="mt-3 ml-7">
                        <div className="flex justify-between text-xs text-zinc-400 mb-1">
                          <span>{formatBytes(dest.free)} free</span>
                          <span>{formatBytes(dest.total)}</span>
                        </div>
                        <div className="h-1.5 w-full bg-black/50 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${percentUsed > 90 ? 'bg-red-500' : 'bg-ps-blue'}`}
                            style={{ width: `${percentUsed}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </label>
                );
              })}
            </div>
          )}
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
            onClick={() => selected && onConfirm(selected.path)}
            disabled={!selected || loading}
            className="px-5 py-2.5 rounded-xl font-bold text-white bg-ps-blue hover:bg-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:ring-4 focus:ring-ps-blue/50"
            tabIndex="0"
          >
            {actionName || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DestinationModal;
