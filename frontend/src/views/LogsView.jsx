import React, { useState, useEffect, useRef } from 'react';
import { Terminal, RefreshCw, FileText } from 'lucide-react';
import { cn } from '../utils/helpers';

const LogsView = () => {
  const [activeTab, setActiveTab] = useState('server');
  const [logData, setLogData] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const logContainerRef = useRef(null);

  const fetchLogs = async (type) => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = type === 'server' ? '/debug/server.log' : '/debug/client.log';
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${type} log: ${response.statusText}`);
      }
      const text = await response.text();
      setLogData(text);
    } catch (err) {
      setError(err.message);
      setLogData('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(activeTab);
  }, [activeTab]);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logData]);

  return (
    <div className="max-w-6xl mx-auto w-full space-y-6 h-full flex flex-col pb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-ps-blue/20 border border-ps-blue/30 flex items-center justify-center">
            <Terminal className="w-6 h-6 text-ps-blue" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">System Logs</h1>
            <p className="text-zinc-400 text-sm mt-1">View backend diagnostic logs</p>
          </div>
        </div>
        
        <button 
          onClick={() => fetchLogs(activeTab)}
          disabled={loading}
          className="p-3 bg-ps-card border border-ps-border hover:bg-white/10 text-white rounded-xl transition-all disabled:opacity-50 focus:outline-none focus:ring-4 focus:ring-ps-blue"
          title="Refresh Logs"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex space-x-2 bg-ps-card p-1 rounded-2xl border border-ps-border w-fit">
        <button
          onClick={() => setActiveTab('server')}
          className={cn(
            "flex items-center space-x-2 px-6 py-2 rounded-xl text-sm font-semibold transition-all focus:outline-none focus:ring-4 focus:ring-ps-blue",
            activeTab === 'server' ? "bg-ps-blue text-white shadow-md" : "text-zinc-400 hover:text-white hover:bg-white/5"
          )}
        >
          <FileText className="w-4 h-4" />
          <span>Server Log</span>
        </button>
        <button
          onClick={() => setActiveTab('client')}
          className={cn(
            "flex items-center space-x-2 px-6 py-2 rounded-xl text-sm font-semibold transition-all focus:outline-none focus:ring-4 focus:ring-ps-blue",
            activeTab === 'client' ? "bg-ps-blue text-white shadow-md" : "text-zinc-400 hover:text-white hover:bg-white/5"
          )}
        >
          <FileText className="w-4 h-4" />
          <span>Client Log</span>
        </button>
      </div>

      <div className="flex-1 bg-[#0c0c0e] rounded-3xl border border-ps-border overflow-hidden flex flex-col min-h-[400px]">
        {error ? (
          <div className="flex items-center justify-center flex-1 text-red-400 bg-red-500/5">
            <p>{error}</p>
          </div>
        ) : (
          <pre 
            ref={logContainerRef}
            className="flex-1 p-6 overflow-y-auto text-sm font-mono text-zinc-300 whitespace-pre-wrap break-all custom-scrollbar focus:outline-none focus:ring-4 focus:ring-inset focus:ring-ps-blue"
            tabIndex="0"
          >
            {loading && !logData ? (
              <span className="animate-pulse text-zinc-500">Loading logs...</span>
            ) : logData || <span className="text-zinc-500 italic">No log data available.</span>}
          </pre>
        )}
      </div>
    </div>
  );
};

export default LogsView;
