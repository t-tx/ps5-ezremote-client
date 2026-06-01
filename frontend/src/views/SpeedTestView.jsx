import React, { useRef, useState } from 'react';
import { Activity, HardDrive, Cpu, AlertCircle, ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../utils/helpers';
import { getMainUrl, getDirectMainUrl } from '../config';

const SpeedTestView = () => {
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const fileInputRef = useRef(null);

  const testSpeedDownload = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const start = performance.now();
      const res = await fetch(getDirectMainUrl('/speedtest_download'));
      const blob = await res.blob();
      const end = performance.now();
      
      const duration_ms = end - start;
      const total_bytes = blob.size;
      const mbps = (total_bytes * 8.0 / 1000000.0) / (duration_ms / 1000.0);
      
      setTestResult(`Download speed: ${mbps.toFixed(2)} Mbps`);
    } catch (e) {
      setTestResult("Network error during test.");
    } finally {
      setTesting(false);
    }
  };

  const testSpeed = () => {
    setTesting(true);
    setTestResult(null);
    const d = new Uint8Array(200 * 1024 * 1024);
    const x = new XMLHttpRequest();
    x.open("POST", getDirectMainUrl("/speedtest"));
    x.onload = () => {
      setTesting(false);
      try {
        const r = JSON.parse(x.responseText);
        setTestResult(`Server measured upload speed: ${r.result.mbps.toFixed(2)} Mbps`);
      } catch (e) {
        setTestResult("Test completed, but failed to parse response.");
      }
    };
    x.onerror = () => {
      setTesting(false);
      setTestResult("Network error during test.");
    };
    x.send(d);
  };

  const testSpeedMultipart = () => {
    setTesting(true);
    setTestResult(null);
    const d = new Uint8Array(200 * 1024 * 1024);
    const formData = new FormData();
    formData.append("file", new Blob([d]), "test.bin");
    
    const x = new XMLHttpRequest();
    x.open("POST", getDirectMainUrl("/speedtest_multipart"));
    x.onload = () => {
      setTesting(false);
      try {
        const r = JSON.parse(x.responseText);
        setTestResult(`Server measured multipart RAM upload speed: ${r.result.mbps.toFixed(2)} Mbps`);
      } catch (e) {
        setTestResult("Test completed, but failed to parse response.");
      }
    };
    x.onerror = () => {
      setTesting(false);
      setTestResult("Network error during test.");
    };
    x.send(formData);
  };

  const testSpeedFile = (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    
    setTesting(true);
    setTestResult(null);
    
    const file = files[0];
    const formData = new FormData();
    formData.append("file", file);
    
    const x = new XMLHttpRequest();
    x.open("POST", getDirectMainUrl("/speedtest_multipart"));
    x.onload = () => {
      setTesting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      try {
        const r = JSON.parse(x.responseText);
        setTestResult(`Server measured real file upload speed: ${r.result.mbps.toFixed(2)} Mbps\n\nIf this is also ~180 Mbps, your PC's Disk Read Speed is the bottleneck!`);
      } catch (err) {
        setTestResult("Test completed, but failed to parse response.");
      }
    };
    x.onerror = () => {
      setTesting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setTestResult("Network error during test.");
    };
    x.send(formData);
  };

  return (
    <div className="max-w-4xl mx-auto w-full space-y-6">
      <div className="flex items-center space-x-4 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-ps-blue flex items-center justify-center shadow-[0_0_30px_rgba(0,149,255,0.3)]">
          <Activity className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Network Speed Tests</h1>
          <p className="text-zinc-400 text-sm mt-1">Benchmark your connection to the ezRemote Server</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* RAM to RAM Test */}
        <div className="bg-ps-card p-6 rounded-3xl border border-ps-border">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-ps-blue/10 flex items-center justify-center">
              <ArrowUp className="w-5 h-5 text-ps-blue" />
            </div>
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Raw Upload</h3>
          <p className="text-zinc-400 text-sm mb-6 h-10">Test raw network upload speed using a 200MB dummy buffer.</p>
          <button 
            onClick={testSpeed}
            disabled={testing}
            className="w-full py-3 bg-white/5 hover:bg-ps-blue text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Run Test
          </button>
        </div>

        {/* Download RAM Test */}
        <div className="bg-ps-card p-6 rounded-3xl border border-ps-border">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <ArrowDown className="w-5 h-5 text-emerald-400" />
            </div>
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Raw Download</h3>
          <p className="text-zinc-400 text-sm mb-6 h-10">Test raw network download speed streaming a 200MB dummy payload.</p>
          <button 
            onClick={testSpeedDownload}
            disabled={testing}
            className="w-full py-3 bg-white/5 hover:bg-emerald-500 text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Run Test
          </button>
        </div>

        {/* Multipart RAM Test */}
        <div className="bg-ps-card p-6 rounded-3xl border border-ps-border">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-purple-400" />
            </div>
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Multipart Upload</h3>
          <p className="text-zinc-400 text-sm mb-6 h-10">Test multipart network upload speed simulating a web upload.</p>
          <button 
            onClick={testSpeedMultipart}
            disabled={testing}
            className="w-full py-3 bg-white/5 hover:bg-purple-500 text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Run Test
          </button>
        </div>

        {/* Real File Test */}
        <div className="bg-ps-card p-6 rounded-3xl border border-ps-border md:col-span-3">
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-green-400" />
            </div>
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Real File Test (Disk)</h3>
          <p className="text-zinc-400 text-sm mb-6">Select a large file from your computer to test the real-world upload speed (Disk to RAM).</p>
          
          <input 
            type="file" 
            id="speedtestFile" 
            ref={fileInputRef}
            className="hidden" 
            onChange={testSpeedFile} 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={testing}
            className="w-full py-4 border-2 border-dashed border-ps-border hover:border-green-400 hover:bg-green-400/5 text-zinc-300 font-bold rounded-2xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            <HardDrive className="w-5 h-5" />
            <span>Select File to Test</span>
          </button>
        </div>
      </div>

      {/* Results Section */}
      <div className={cn(
        "bg-ps-card p-6 rounded-2xl border transition-all duration-300",
        testing ? "border-ps-blue shadow-[0_0_20px_rgba(0,149,255,0.1)]" : "border-ps-border",
        !testing && !testResult ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0"
      )}>
        {testing ? (
          <div className="flex items-center space-x-3 text-ps-blue">
            <div className="w-5 h-5 border-2 border-ps-blue border-t-transparent rounded-full animate-spin" />
            <span className="font-medium">Test in progress (transferring 200MB)...</span>
          </div>
        ) : (
          <div className="flex items-start space-x-3 text-white">
            <AlertCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div className="whitespace-pre-line font-medium leading-relaxed">
              {testResult}
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default SpeedTestView;
