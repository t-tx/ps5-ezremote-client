import React, { useState, useEffect } from 'react';
import { Layers, Download, Archive, Loader2, CheckCircle, XCircle, RotateCw, StopCircle, Clock } from 'lucide-react';
import { getDirectDaemonUrl } from '../config';
import { retryTask, stopTask, cleanTasks } from '../utils/api';

const DL_PENDING = 0;
const DL_DOWNLOADING = 1;
const DL_RESUMED = 2;
const DL_FAILED = 3;
const DL_SUCCESS = 4;

const EXT_PENDING = 0;
const EXT_EXTRACTING = 1;
const EXT_FAILED = 2;
const EXT_SUCCESS = 3;

const FOP_PENDING = 0;
const FOP_PROCESSING = 1;
const FOP_FAILED = 2;
const FOP_SUCCESS = 3;

const timestampSeconds = (timestamp) => {
  const value = Number(timestamp || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value > 100000000000000) return Math.floor(value / 1000000);
  if (value > 10000000000) return Math.floor(value / 1000);
  return Math.floor(value);
};

const formatClockTime = (timestamp) => {
  const seconds = timestampSeconds(timestamp);
  if (!seconds) return null;
  return new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatDuration = (seconds) => {
  const value = Math.max(0, Math.floor(Number(seconds || 0)));
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const remainingSeconds = value % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainingMinutes}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

const elapsedSecondsFor = (job, nowSeconds) => {
  const serverElapsed = Number(job?.elapsed_seconds);
  if (Number.isFinite(serverElapsed) && serverElapsed >= 0) return Math.floor(serverElapsed);

  const started = timestampSeconds(job?.timestamp);
  return started ? Math.max(0, nowSeconds - started) : null;
};

const downloadEtaSeconds = (job, elapsedSeconds) => {
  if (!elapsedSeconds || job?.bytes_transfered <= 0 || job?.file_size <= job?.bytes_transfered) return null;
  const bytesPerSecond = job.bytes_transfered / elapsedSeconds;
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  return Math.ceil((job.file_size - job.bytes_transfered) / bytesPerSecond);
};

const JobTimeInfo = ({ job, nowSeconds, etaSeconds = null }) => {
  const startedAt = formatClockTime(job?.timestamp);
  const elapsedSeconds = elapsedSecondsFor(job, nowSeconds);
  if (!startedAt && elapsedSeconds === null && etaSeconds === null) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-400">
      <span className="inline-flex items-center rounded-lg border border-white/10 bg-black/25 px-2 py-1">
        <Clock className="mr-1.5 h-3 w-3 text-zinc-500" />
        Started {startedAt || 'unknown'}
      </span>
      {elapsedSeconds !== null && (
        <span className="inline-flex items-center rounded-lg border border-white/10 bg-black/25 px-2 py-1">
          Elapsed {formatDuration(elapsedSeconds)}
        </span>
      )}
      {etaSeconds !== null && (
        <span className="inline-flex items-center rounded-lg border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-blue-300">
          ETA {formatDuration(etaSeconds)}
        </span>
      )}
    </div>
  );
};

const fileNameFromPath = (path) => {
  const value = String(path || '');
  return value.split('/').filter(Boolean).pop() || value;
};

const ActiveDownloadFiles = ({ files }) => {
  const activeFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!activeFiles.length) return null;

  const visibleFiles = activeFiles.slice(0, 6);
  const hiddenCount = activeFiles.length - visibleFiles.length;

  return (
    <div className="mb-3 rounded-xl border border-blue-400/15 bg-blue-500/[0.06] p-3">
      <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-blue-300">
        Downloading Now
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {visibleFiles.map((file, index) => (
          <div key={`${file}-${index}`} className="truncate rounded-lg bg-black/25 px-2 py-1.5 text-xs font-medium text-zinc-200" title={file}>
            {fileNameFromPath(file)}
          </div>
        ))}
        {hiddenCount > 0 && (
          <div className="rounded-lg bg-black/25 px-2 py-1.5 text-xs font-medium text-zinc-400">
            +{hiddenCount} more
          </div>
        )}
      </div>
    </div>
  );
};

export default function BackgroundJobsView() {
  const [downloads, setDownloads] = useState([]);
  const [extracts, setExtracts] = useState([]);
  const [fileops, setFileops] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    try {
      const dlRes = await fetch(getDirectDaemonUrl('/get_download_state')).then(r => r.json());
      const exRes = await fetch(getDirectDaemonUrl('/get_extract_state')).then(r => r.json());
      const fileopRes = await fetch(getDirectDaemonUrl('/get_fileop_state')).then(r => r.json());

      setDownloads(dlRes);
      setExtracts(exRes);
      setFileops(fileopRes);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRetry = async (type, id) => {
    try {
      await retryTask(type, id);
      fetchJobs();
    } catch (err) {
      console.error('Failed to retry task:', err);
    }
  };

  const handleStop = async (type, id) => {
    try {
      await stopTask(type, id);
      fetchJobs();
    } catch (err) {
      console.error('Failed to stop task:', err);
    }
  };

  const handleCleanAll = async () => {
    try {
      await cleanTasks();
      fetchJobs();
    } catch (err) {
      console.error('Failed to clean tasks:', err);
    }
  };

  const totalActive = downloads.length + extracts.length + fileops.length;
  const nowSeconds = Math.floor(Date.now() / 1000);

  return (
    <div className="flex flex-col h-full animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white flex items-center">
          <Layers className="mr-3 text-ps-blue w-8 h-8" />
          Background Jobs
        </h1>
        <div className="flex items-center space-x-3">
          <button 
            onClick={handleCleanAll}
            className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors font-mono font-bold rounded-full border border-zinc-600 text-sm flex items-center"
          >
            Clean All
          </button>
          <div className="px-4 py-1.5 bg-ps-blue/20 text-ps-blue font-mono font-bold rounded-full border border-ps-blue/30 text-sm">
            {totalActive} Total {totalActive === 1 ? 'Job' : 'Jobs'}
          </div>
        </div>
      </div>

      <div className="bg-black/40 border border-white/5 rounded-2xl p-6 flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <Loader2 className="w-12 h-12 animate-spin mb-4 text-ps-blue" />
            <p>Loading background tasks...</p>
          </div>
        ) : totalActive === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <Layers className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg">No active background jobs.</p>
            <p className="text-sm mt-2 opacity-70">Downloads and extractions run in the background will appear here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {downloads.map((job, idx) => {
              const progress = job.file_size > 0 ? (job.bytes_transfered / job.file_size) * 100 : 0;
              const formattedDownloaded = (job.bytes_transfered / (1024 * 1024)).toFixed(2);
              const formattedTotal = (job.file_size / (1024 * 1024)).toFixed(2);
              const elapsedSeconds = elapsedSecondsFor(job, nowSeconds);
              const etaSeconds = (job.state === DL_DOWNLOADING || job.state === DL_RESUMED) ? downloadEtaSeconds(job, elapsedSeconds) : null;

              return (
                <div key={`dl-${job.timestamp}-${idx}`} className="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center space-x-3 truncate">
                      <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg shrink-0">
                        <Download className="w-5 h-5" />
                      </div>
                      <div className="truncate">
                        <h3 className="text-white font-medium truncate" title={job.path}>{job.path.split('/').pop()}</h3>
                        <p className="text-xs text-zinc-400 truncate">{job.path}</p>
                      </div>
                    </div>
                    <div className={`text-sm font-mono px-2 py-1 rounded flex items-center ${job.state === DL_FAILED ? 'text-red-400 bg-red-500/10' : (job.state === DL_SUCCESS ? 'text-green-400 bg-green-500/10' : 'text-blue-400 bg-blue-500/10')}`}>
                      {job.state === DL_FAILED ? 'Failed' : (job.state === DL_SUCCESS ? 'Success' : (job.state === DL_PENDING ? 'Pending' : (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                          Downloading
                        </>
                      )))}
                    </div>
                  </div>

                  <JobTimeInfo job={job} nowSeconds={nowSeconds} etaSeconds={etaSeconds} />
                  <ActiveDownloadFiles files={job.active_files} />

                  {(job.state === DL_DOWNLOADING || job.state === DL_RESUMED) && (
                    <div className="space-y-2">
                      <div className="h-2 w-full bg-black/50 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-zinc-400 font-mono">
                        <span>{progress.toFixed(1)}%</span>
                        <div className="space-x-2">
                          <span>{formattedDownloaded} MB</span>
                          <span>{formattedTotal} MB</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {job.state === DL_PENDING && (
                    <div className="text-xs text-yellow-400/80 flex items-center mt-2">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Waiting in queue...
                    </div>
                  )}
                  {job.state === DL_SUCCESS && (
                    <div className="mt-2 text-xs text-green-400 flex items-center justify-between bg-green-500/10 p-2 rounded">
                      <div className="flex items-center">
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Task completed successfully
                      </div>
                    </div>
                  )}
                  {job.state === DL_FAILED && (
                    <div className="mt-2 text-xs text-red-400 flex items-center justify-between bg-red-500/10 p-2 rounded">
                      <div className="flex items-center">
                        <XCircle className="w-4 h-4 mr-2" />
                        {job.fail_reason || 'Task failed'}
                      </div>
                      <button 
                        onClick={() => handleRetry('download', job.id)} 
                        className="bg-red-500/20 hover:bg-red-500/40 text-red-300 px-3 py-1.5 rounded transition-colors flex items-center font-medium"
                      >
                        <RotateCw className="w-3 h-3 mr-1.5" /> Retry
                      </button>
                    </div>
                  )}
                  {(job.state === DL_DOWNLOADING || job.state === DL_RESUMED || job.state === DL_PENDING) && (
                    <div className="mt-3 flex justify-end">
                      <button 
                        onClick={() => handleStop('download', job.id)} 
                        className="bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded transition-colors flex items-center font-medium text-xs"
                      >
                        <StopCircle className="w-3.5 h-3.5 mr-1.5 text-red-400" /> Stop
                      </button>
                    </div>
                  )}
                  {job.retry_count > 0 && (
                    <div className="mt-2 text-xs text-zinc-500">
                      Retries: {job.retry_count}
                    </div>
                  )}
                </div>
              );
            })}

            {extracts.map((job, idx) => (
              <div key={`ex-${job.timestamp}-${idx}`} className="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center space-x-3 truncate">
                    <div className="p-2 bg-purple-500/20 text-purple-400 rounded-lg shrink-0">
                      <Archive className="w-5 h-5" />
                    </div>
                    <div className="truncate">
                      <h3 className="text-white font-medium truncate" title={job.path}>{job.path.split('/').pop()}</h3>
                      <p className="text-xs text-zinc-400 truncate">Extracting to: {job.dest_path}</p>
                    </div>
                  </div>
                  <div className={`text-sm font-mono px-2 py-1 rounded flex items-center ${job.state === EXT_FAILED ? 'text-red-400 bg-red-500/10' : (job.state === EXT_SUCCESS ? 'text-green-400 bg-green-500/10' : 'text-purple-400 bg-purple-500/10')}`}>
                    {job.state === EXT_FAILED ? 'Failed' : (job.state === EXT_SUCCESS ? 'Success' : (job.state === EXT_PENDING ? 'Pending' : (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                        Extracting
                      </>
                    )))}
                  </div>
                </div>
                <JobTimeInfo job={job} nowSeconds={nowSeconds} />
                {job.state === EXT_PENDING && (
                  <div className="text-xs text-yellow-400/80 flex items-center mt-2">
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Waiting in queue...
                  </div>
                )}
                {job.state === EXT_EXTRACTING && (
                  <div className="h-1.5 w-full bg-black/50 rounded-full overflow-hidden mt-3">
                    <div className="h-full bg-purple-500 w-full animate-pulse opacity-70" />
                  </div>
                )}
                {job.state === EXT_SUCCESS && (
                  <div className="mt-2 text-xs text-green-400 flex items-center justify-between bg-green-500/10 p-2 rounded">
                    <div className="flex items-center">
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Task completed successfully
                    </div>
                  </div>
                )}
                {job.state === EXT_FAILED && (
                  <div className="mt-2 text-xs text-red-400 flex items-center justify-between bg-red-500/10 p-2 rounded">
                    <div className="flex items-center">
                      <XCircle className="w-4 h-4 mr-2" />
                      {job.fail_reason || 'Task failed'}
                    </div>
                    <button 
                      onClick={() => handleRetry('extract', job.id)} 
                      className="bg-red-500/20 hover:bg-red-500/40 text-red-300 px-3 py-1.5 rounded transition-colors flex items-center font-medium"
                    >
                      <RotateCw className="w-3 h-3 mr-1.5" /> Retry
                    </button>
                  </div>
                )}
                {(job.state === EXT_EXTRACTING || job.state === EXT_PENDING) && (
                  <div className="mt-3 flex justify-end">
                    <button 
                      onClick={() => handleStop('extract', job.id)} 
                      className="bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded transition-colors flex items-center font-medium text-xs"
                    >
                      <StopCircle className="w-3.5 h-3.5 mr-1.5 text-red-400" /> Stop
                    </button>
                  </div>
                )}
                {job.retry_count > 0 && (
                  <div className="mt-2 text-xs text-zinc-500">
                    Retries: {job.retry_count}
                  </div>
                )}
              </div>
            ))}

            {fileops.map((job, idx) => {
              const typeStr = job.type === 0 ? 'Copying' : (job.type === 1 ? 'Moving' : 'Deleting');
              const iconColorClass = job.type === 2 ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400';
              const progress = job.total_items > 0 ? (job.items_processed / job.total_items) * 100 : 0;
              const titleText = job.items.length === 1 ? job.items[0].split('/').pop() : `${job.items.length} items`;

              return (
                <div key={`op-${job.timestamp}-${idx}`} className="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center space-x-3 truncate">
                      <div className={`p-2 rounded-lg shrink-0 ${iconColorClass}`}>
                        <Layers className="w-5 h-5" />
                      </div>
                      <div className="truncate">
                        <h3 className="text-white font-medium truncate" title={titleText}>{titleText}</h3>
                        <p className="text-xs text-zinc-400 truncate">
                          {job.type === 2 ? 'Deleting files' : `${typeStr} to: ${job.dest_path}`}
                        </p>
                      </div>
                    </div>
                    <div className={`text-sm font-mono px-2 py-1 rounded flex items-center ${job.state === FOP_FAILED ? 'text-red-400 bg-red-500/10' : (job.state === FOP_SUCCESS ? 'text-green-400 bg-green-500/10' : 'text-emerald-400 bg-emerald-500/10')}`}>
                      {job.state === FOP_FAILED ? 'Failed' : (job.state === FOP_SUCCESS ? 'Success' : (job.state === FOP_PENDING ? 'Pending' : (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                          {job.type === 2 ? 'Deleting' : 'Transferring'}
                        </>
                      )))}
                    </div>
                  </div>
                  <JobTimeInfo job={job} nowSeconds={nowSeconds} />
                  {job.state === FOP_PENDING && (
                    <div className="text-xs text-yellow-400/80 flex items-center mt-2">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Waiting in queue...
                    </div>
                  )}
                  {job.state === FOP_PROCESSING && (
                    <div className="space-y-1">
                      <div className="h-2 w-full bg-black/50 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-300 ${job.type === 2 ? 'bg-red-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-zinc-400">
                        <span>{job.items_processed} / {job.total_items} items</span>
                      </div>
                    </div>
                  )}
                  {job.state === FOP_SUCCESS && (
                    <div className="mt-2 text-xs text-green-400 flex items-center justify-between bg-green-500/10 p-2 rounded">
                      <div className="flex items-center">
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Task completed successfully
                      </div>
                    </div>
                  )}
                  {job.state === FOP_FAILED && (
                    <div className="mt-2 text-xs text-red-400 flex items-center justify-between bg-red-500/10 p-2 rounded">
                      <div className="flex items-center">
                        <XCircle className="w-4 h-4 mr-2" />
                        {job.fail_reason || 'Task failed'}
                      </div>
                      <button 
                        onClick={() => handleRetry('fileop', job.id)} 
                        className="bg-red-500/20 hover:bg-red-500/40 text-red-300 px-3 py-1.5 rounded transition-colors flex items-center font-medium"
                      >
                        <RotateCw className="w-3 h-3 mr-1.5" /> Retry
                      </button>
                    </div>
                  )}
                  {(job.state === FOP_PROCESSING || job.state === FOP_PENDING) && (
                    <div className="mt-3 flex justify-end">
                      <button 
                        onClick={() => handleStop('fileop', job.id)} 
                        className="bg-zinc-800/50 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded transition-colors flex items-center font-medium text-xs"
                      >
                        <StopCircle className="w-3.5 h-3.5 mr-1.5 text-red-400" /> Stop
                      </button>
                    </div>
                  )}
                  {job.retry_count > 0 && (
                    <div className="mt-2 text-xs text-zinc-500">
                      Retries: {job.retry_count}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
