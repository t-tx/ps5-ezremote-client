import React, { useState, useEffect } from 'react';
import { Server, Cpu, Database, Activity, AlertTriangle } from 'lucide-react';
import { cn } from '../utils/helpers';
import { toast } from 'react-hot-toast';

import { getDirectDaemonUrl, getMainUrl } from '../config';

const MetricCard = ({ title, value, subtext, icon: Icon, colorClass, percent = null }) => (
  <div className="bg-ps-card border border-ps-border rounded-3xl p-6 flex flex-col relative overflow-hidden group hover:border-white/10 transition-colors">
    <div className="flex justify-between items-start mb-4 relative z-10">
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg", colorClass)}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      {percent !== null && (
        <span className="text-2xl font-black text-white">{percent.toFixed(1)}%</span>
      )}
    </div>
    
    <div className="relative z-10">
      <h3 className="text-zinc-400 font-medium mb-1">{title}</h3>
      <div className="text-3xl font-bold text-white tracking-tight">{value}</div>
      {subtext && <div className="text-sm text-zinc-500 mt-2 font-mono">{subtext}</div>}
    </div>

    {percent !== null && (
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/5">
        <div 
          className={cn("h-full transition-all duration-1000 ease-out", colorClass.replace('/20', '').replace('/30', ''))} 
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    )}
  </div>
);

const MetricsView = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    
    const fetchMetrics = async () => {
      try {
        const memUrl = getDirectDaemonUrl('/mem');
        const res = await fetch(memUrl);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const json = await res.json();
        if (mounted) {
          setData(json);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 2000); // Poll every 2 seconds
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-6">
        <div className="w-12 h-12 border-4 border-ps-blue border-t-transparent rounded-full animate-spin"></div>
        <p className="text-zinc-400 font-medium">Connecting to telemetry server...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-6">
        <AlertTriangle className="w-16 h-16 text-red-500 mb-2 opacity-50" />
        <h2 className="text-2xl font-bold text-white">Telemetry Disconnected</h2>
        <p className="text-zinc-400 max-w-md">Failed to connect to the metrics endpoint (port 6701). {error}</p>
      </div>
    );
  }

  const { mem, cpu } = data || {};

  return (
    <div className="max-w-6xl mx-auto w-full space-y-8 pb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-[0_0_30px_rgba(99,102,241,0.3)]">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">System Telemetry</h1>
            <p className="text-zinc-400 font-medium mt-1">Real-time performance monitoring</p>
          </div>
        </div>
        
        <button
          onClick={async () => {
            if (confirm('Are you sure you want to restart the background daemon? This will stop any ongoing background downloads or tasks.')) {
              try {
                const res = await fetch('/__local__/restart_daemon');
                if (res.ok) toast.success('Daemon restart initiated.');
                else toast.error('Failed to initiate restart.');
              } catch (e) {
                toast.error('Network error while requesting restart.');
              }
            }
          }}
          className="px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-bold rounded-xl border border-red-500/20 transition-all focus:outline-none focus:ring-4 focus:ring-red-500/50"
        >
          Restart Daemon
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU Card */}
        <MetricCard
          title="CPU Usage"
          value={cpu?.has_percent ? `${(cpu.percent).toFixed(2)}%` : '--'}
          subtext={`PID: ${cpu?.pid || 'N/A'}`}
          icon={Cpu}
          colorClass="bg-blue-500"
          percent={cpu?.has_percent ? cpu.percent : 0}
        />

        {/* Memory RSS Card */}
        <MetricCard
          title="Memory (RSS)"
          value={mem ? `${mem.rss_mib.toFixed(2)} MB` : '--'}
          subtext={`Peak: ${mem?.peak_rss_mib?.toFixed(2) || '--'} MB`}
          icon={Database}
          colorClass="bg-emerald-500"
          // Estimating percent based on a theoretical 1GB limit for the app, just for visualization
          percent={mem ? (mem.rss_mib / 1024) * 100 : 0}
        />

        {/* Memory Virtual Card */}
        <MetricCard
          title="Virtual Memory"
          value={mem ? `${mem.virtual_mib.toFixed(2)} MB` : '--'}
          subtext="Total allocated address space"
          icon={Server}
          colorClass="bg-purple-500"
        />

        {/* Memory Details Card */}
        <MetricCard
          title="Data / Stack"
          value={mem ? `${mem.data_mib.toFixed(2)} MB` : '--'}
          subtext={`Stack: ${mem?.stack_mib?.toFixed(2) || '--'} MB`}
          icon={Activity}
          colorClass="bg-amber-500"
        />
      </div>

      <div className="bg-ps-card border border-ps-border rounded-3xl p-6 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 pointer-events-none" />
        <h3 className="text-lg font-bold text-white mb-6 relative z-10">Advanced Diagnostics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 relative z-10">
          <div>
            <div className="text-sm text-zinc-500 mb-1">Source</div>
            <div className="text-white font-mono">{mem?.source || '--'}</div>
          </div>
          <div>
            <div className="text-sm text-zinc-500 mb-1">Page Size</div>
            <div className="text-white font-mono">{mem?.page_size ? `${mem.page_size / 1024} KB` : '--'}</div>
          </div>
          <div>
            <div className="text-sm text-zinc-500 mb-1">User / System CPU</div>
            <div className="text-white font-mono">
              {cpu?.user_seconds?.toFixed(2) || '0'}s / {cpu?.system_seconds?.toFixed(2) || '0'}s
            </div>
          </div>
          <div>
            <div className="text-sm text-zinc-500 mb-1">Current Errno</div>
            <div className="text-white font-mono">{mem?.current_errno || 0}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MetricsView;
