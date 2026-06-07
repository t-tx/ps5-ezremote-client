import React, { useState } from 'react';
import { X, Server, Save } from 'lucide-react';
import { cn } from '../../utils/helpers';
import { saveRemoteSite } from '../../utils/api';

const AddSiteModal = ({ isOpen, onClose, onSiteAdded }) => {
  const [formData, setFormData] = useState({
    site_idx: -1,
    server: '',
    username: '',
    password: '',
    http_server_type: 'Apache',
    default_directory: '/',
    enable_rpi: true,
    enable_disk_cache: false,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.server) {
      setError('Server URL is required');
      return;
    }
    
    setError(null);
    setIsSaving(true);
    
    try {
      const res = await saveRemoteSite(formData);
      onSiteAdded(res.result.site_idx);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save site');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose}>
      <div 
        className="bg-[#1e1e24] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative animate-in fade-in zoom-in duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-white/5 hover:bg-white/10 text-white rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-ps-blue/20 rounded-xl flex items-center justify-center">
              <Server className="w-6 h-6 text-ps-blue" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Add Remote Site</h2>
              <p className="text-sm text-zinc-400">Configure a new connection</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Server URL</label>
              <input 
                type="text" 
                name="server"
                value={formData.server}
                onChange={handleChange}
                placeholder="ftp://192.168.1.10:21"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-zinc-500 focus:outline-none focus:border-ps-blue/50 transition-colors"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Username</label>
                <input 
                  type="text" 
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-ps-blue/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Password</label>
                <input 
                  type="password" 
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-ps-blue/50 transition-colors"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">HTTP Server Type</label>
                <select 
                  name="http_server_type"
                  value={formData.http_server_type}
                  onChange={handleChange}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-ps-blue/50 transition-colors appearance-none"
                >
                  <option value="Apache">Apache</option>
                  <option value="Microsoft IIS">Microsoft IIS</option>
                  <option value="Nginx">Nginx</option>
                  <option value="Serve">Serve</option>
                  <option value="RClone">RClone</option>
                  <option value="Archive.org">Archive.org</option>
                  <option value="Myrient">Myrient</option>
                  <option value="Github">Github</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Default Dir</label>
                <input 
                  type="text" 
                  name="default_directory"
                  value={formData.default_directory}
                  onChange={handleChange}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-ps-blue/50 transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center gap-6 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  name="enable_rpi"
                  checked={formData.enable_rpi}
                  onChange={handleChange}
                  className="w-4 h-4 rounded border-white/10 bg-white/5 text-ps-blue focus:ring-ps-blue focus:ring-offset-0"
                />
                <span className="text-sm font-medium text-zinc-300">Enable RPI</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  name="enable_disk_cache"
                  checked={formData.enable_disk_cache}
                  onChange={handleChange}
                  className="w-4 h-4 rounded border-white/10 bg-white/5 text-ps-blue focus:ring-ps-blue focus:ring-offset-0"
                />
                <span className="text-sm font-medium text-zinc-300">Disk Cache</span>
              </label>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-ps-blue hover:bg-ps-blue-light text-white rounded-xl font-bold transition-all disabled:opacity-50"
              >
                {isSaving ? (
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Save Site
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddSiteModal;
