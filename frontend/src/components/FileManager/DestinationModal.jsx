import React, { useState, useEffect, useRef } from 'react';
import { HardDrive, Loader2, X } from 'lucide-react';
import { getDirectDaemonUrl } from '../../config';

const DEFAULT_RECOMMENDED_DESTINATIONS = [
  '/data/etaHen/games',
  '/data/etaHEN/games',
  '/data/etahen/games',
  '/data/homebrew',
  '/data'
];

const normalizePath = (path) => {
  if (typeof path !== 'string' || !path.trim()) return '';
  const normalized = `/${path.trim()}`.replace(/\/+/g, '/').replace(/\/$/, '');
  return normalized || '/';
};

const uniquePaths = (paths) => [...new Set(paths.map(normalizePath).filter(Boolean))];

const DestinationModal = ({ isOpen, onClose, onConfirm, fileName, actionName, initialDestination = '', recommendedDestinations = DEFAULT_RECOMMENDED_DESTINATIONS }) => {
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // Now stores the object
  const [manualPath, setManualPath] = useState('');
  const modalRef = useRef(null);
  const quickDestinations = uniquePaths([
    ...recommendedDestinations,
    ...destinations.map(dest => dest.path)
  ]);
  const normalizedManualPath = normalizePath(manualPath);

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
    const preferredDestination = normalizePath(initialDestination);
    setDestinations([]);
    setSelected(null);
    setManualPath(preferredDestination || normalizePath(recommendedDestinations[0]) || '/data');
    setLoading(true);
    setError(null);
    const focusTimer = setTimeout(() => {
      if (modalRef.current) {
        const firstFocusable = modalRef.current.querySelector('input, button, [tabindex="0"]');
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
        const nextDestinations = Array.isArray(data) ? data : [];
        const preferred = nextDestinations.find(dest => normalizePath(dest.path) === preferredDestination);
        const nextSelected = preferred || nextDestinations[0] || null;
        setDestinations(nextDestinations);
        setSelected(nextSelected);
        if (!preferredDestination && nextSelected) setManualPath(nextSelected.path);
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
  }, [isOpen, initialDestination, recommendedDestinations]);

  const selectDestination = (dest) => {
    setSelected(dest);
    setManualPath(dest.path);
  };

  const selectPath = (path) => {
    const normalized = normalizePath(path);
    const matchingDestination = destinations.find(dest => normalizePath(dest.path) === normalized) || null;
    setSelected(matchingDestination);
    setManualPath(normalized);
  };

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

          <label className="block mb-2 text-xs font-black uppercase tracking-[0.18em] text-zinc-500">
            Destination path
          </label>
          <input
            type="text"
            value={manualPath}
            onChange={(event) => selectPath(event.target.value)}
            placeholder="/data/etaHen/games"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-white outline-none transition-all placeholder:text-zinc-600 focus:border-ps-blue focus:ring-4 focus:ring-ps-blue/20"
          />

          <div className="mt-4 mb-5">
            <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-zinc-500">Recommended</div>
            <div className="flex flex-wrap gap-2">
              {quickDestinations.map(path => (
                <button
                  key={path}
                  type="button"
                  onClick={() => selectPath(path)}
                  className={`rounded-full border px-3 py-1.5 font-mono text-xs transition-all ${
                    normalizedManualPath === path
                      ? 'border-ps-blue bg-ps-blue text-white'
                      : 'border-white/10 bg-white/5 text-zinc-300 hover:border-ps-blue/50 hover:bg-ps-blue/10 hover:text-white'
                  }`}
                >
                  {path}
                </button>
              ))}
            </div>
          </div>

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
              No storage devices were detected. You can still type a local destination path above.
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
                        onChange={() => selectDestination(dest)}
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
            onClick={() => normalizedManualPath && onConfirm(normalizedManualPath)}
            disabled={!normalizedManualPath}
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
