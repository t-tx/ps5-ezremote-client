import React, { useRef, useState } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { cn } from '../../utils/helpers';
import { uploadFile } from '../../utils/api';

const UploadArea = ({ currentPath, onUploadComplete }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      await processUpload(e.target.files[0]);
    }
  };

  const processUpload = async (file) => {
    try {
      setError(null);
      setUploadProgress(0);
      await uploadFile(currentPath, file, (progress) => {
        setUploadProgress(progress);
      });
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (onUploadComplete) onUploadComplete();
    } catch (err) {
      setUploadProgress(null);
      setError(err.message || 'Upload failed');
    }
  };

  return (
    <div className="mt-4">
      <div 
        onDragEnter={handleDragEnter}
        onDragOver={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer bg-ps-card",
          isDragging 
            ? "border-ps-blue bg-ps-blue/5 shadow-[0_0_30px_rgba(0,149,255,0.15)]" 
            : "border-ps-border hover:border-ps-blue/50 hover:bg-white/5",
          uploadProgress !== null ? "pointer-events-none opacity-80" : ""
        )}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileSelect} 
          className="hidden" 
        />
        
        {uploadProgress !== null ? (
          <div className="w-full max-w-md flex flex-col items-center">
            <UploadCloud className="w-10 h-10 text-ps-blue mb-4 animate-bounce" />
            <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden">
              <div 
                className="h-full bg-ps-blue transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="mt-3 text-ps-blue font-bold text-sm">{uploadProgress}% Uploading...</p>
          </div>
        ) : (
          <>
            <UploadCloud className={cn(
              "w-10 h-10 mb-4 transition-colors duration-300",
              isDragging ? "text-ps-blue" : "text-zinc-500"
            )} />
            <p className="text-zinc-300 font-medium text-center">
              Drag & drop a file here or <span className="text-ps-blue cursor-pointer">browse</span>
            </p>
            <p className="text-zinc-500 text-xs mt-2 text-center">
              Uploading to: {currentPath}
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-center justify-between bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-xl text-sm">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="p-1 hover:bg-red-500/20 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default UploadArea;
