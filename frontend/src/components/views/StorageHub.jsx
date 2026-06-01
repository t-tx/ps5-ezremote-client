import React, { useState, useEffect, useMemo } from 'react'
import { CloudDownload, Upload, Package, Database, RefreshCw, Trash2, Loader2, AlertTriangle, HardDrive, Usb } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { cn, isPS5, isSystemPayload } from '../../utils/helpers'
import PayloadName from '../ui/PayloadName'

const StorageHub = ({ payloads, onInstall, onDelete, onUpload, onImportFromUsb, config, ip, scrollTarget, onClearScrollTarget }) => {
  const [remotePayloads, setRemotePayloads] = useState([])
  const [repoUrl, setRepoUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(0)

  const fetchRemote = async (force = false) => {
    setLoading(true)
    setError(false)
    try {
      const endpoint = force ? '/repository_refresh' : '/repository_payloads'
      const res = await fetch(endpoint)
      if (!res.ok) throw new Error()
      const data = await res.json()

      if (!Array.isArray(data?.payloads)) throw new Error()
      setRemotePayloads(data.payloads)
      setRepoUrl(data.repo_url || '')
      const lastUpd = Number(data.last_update || 0)
      setLastUpdate(lastUpd)

      // Auto-update if older than 24h
      if (!force) {
        const now = Math.floor(Date.now() / 1000)
        if (now - lastUpd > 24 * 60 * 60) {
          await fetchRemote(true)
          return
        }
      }
    } catch (e) {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRemote()
  }, [])

  useEffect(() => {
    if (scrollTarget) {
      const timer = setTimeout(() => {
        const element = document.getElementById(scrollTarget);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        }
        if (onClearScrollTarget) onClearScrollTarget();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [scrollTarget]);

  const localFilenames = useMemo(() => payloads.map(p => p.split('/').pop()), [payloads])
  const internalPayloads = payloads.filter(p => !p.includes('/mnt/usb'))

  const getBaseName = (filename) => {
    if (!filename) return '';
    let clean = filename.replace(/\.(elf|bin|lua)$/i, '');
    const versionMatch = clean.match(/[_-]v?(\d+[\d.a-z-]+)/i);
    if (versionMatch) clean = clean.replace(versionMatch[0], '');
    return clean.replace(/[_-]ps[45]$/i, '');
  }

  const remoteStatus = useMemo(() => {
    if (!Array.isArray(remotePayloads)) return []
    return remotePayloads.map(p => {
      const isInstalled = p.filename ? localFilenames.includes(p.filename) : false
      const baseName = getBaseName(p.filename)
      const installedVersion = localFilenames.find(f => getBaseName(f) === baseName)
      const isUpdate = !isInstalled && !!installedVersion

      return { ...p, isInstalled, isUpdate, installedFilename: installedVersion }
    }).sort((a, b) => {
      if (a.isUpdate && !b.isUpdate) return -1
      if (!a.isUpdate && b.isUpdate) return 1
      return 0
    })
  }, [remotePayloads, localFilenames])

  const cloudItems = remoteStatus.filter(p => !p.isInstalled || p.isUpdate);

  return (
    <div className="space-y-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
        <h2 className="text-4xl font-extrabold text-white tracking-tight">
          Payload <span className="text-ps-blue">Management</span>
        </h2>

        {!isPS5 && (
          <label className="inline-flex items-center space-x-4 px-10 py-5 bg-ps-blue hover:bg-ps-blue/80 text-white rounded-[1.25rem] font-bold tracking-tight text-xl cursor-pointer transition-all shrink-0 transform active:scale-95">
            <Upload className="w-7 h-7" />
            <span>Upload ELF Payload</span>
            <input type="file" className="hidden" onChange={onUpload} accept=".elf,.bin,.lua" />
          </label>
        )}
      </div>

      {/* Installed Payloads Section */}
      <section className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <h3 className="label-caps !text-white flex items-center space-x-4 text-lg">
            <Database className="w-6 h-6 text-ps-blue" />
            <span>Installed Payloads</span>
          </h3>
          <span className="bg-white/5 px-4 py-1 rounded-full text-zinc-500 font-bold text-xs">
            {internalPayloads.length} Files
          </span>
        </div>

        <div className={cn("grid gap-4", isPS5 ? "grid-cols-2" : "grid-cols-1 md:grid-cols-2")}>
          {internalPayloads.length === 0 ? (
            <div className="col-span-full py-20 border-2 border-dashed border-white/5 rounded-ps-3xl flex flex-col items-center justify-center space-y-4 bg-white/[0.01]">
              <Package className="w-16 h-16 text-white/5" />
              <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm italic">Library Empty</p>
            </div>
          ) : (
            internalPayloads.map((path, i) => {
              const fileName = path.split('/').pop()
              const remoteMatch = remoteStatus.find(rp => rp.filename === fileName || rp.installedFilename === fileName)
              return (
                <div key={path} className={cn(
                  "group flex justify-between p-4 md:p-6 glass-card rounded-ps-2xl border-white/10 hover:border-ps-blue/30 gap-4",
                  isPS5 ? "flex-row items-center" : "flex-col md:flex-row md:items-center"
                )}>
                  <div className="flex items-center space-x-4 md:space-x-6 min-w-0">
                    <div className="p-3 md:p-4 bg-white/5 rounded-2xl group-hover:bg-ps-blue/10 transition-colors shrink-0">
                      <Package className="w-6 h-6 md:w-8 md:h-8 text-zinc-400 group-hover:text-ps-blue transition-colors" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <PayloadName path={fileName} className="text-xl md:text-2xl text-white" stacked />
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 md:space-x-4 ml-auto md:ml-0">
                    {remoteMatch?.isUpdate && (
                      <button
                        onClick={() => onInstall(remoteMatch, repoUrl)}
                        className="flex items-center space-x-2 md:space-x-3 px-4 md:px-6 py-2 md:py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs md:text-sm transition-all"
                      >
                        <RefreshCw className="w-4 h-4 md:w-5 md:h-5" />
                        <span>Update</span>
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(fileName)}
                      className="p-3 md:p-4 rounded-xl bg-red-950/20 text-red-500 border border-red-500/10 hover:bg-red-500 hover:text-white transition-all"
                      title="Remove Payload"
                    >
                      <Trash2 className="w-5 h-5 md:w-6 md:h-6" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* Cloud Repository Section */}
      <section id="cloud-repository" className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <h3 className="label-caps !text-white flex items-center space-x-4 text-lg" >
            <CloudDownload className="w-6 h-6 text-ps-blue" />
            <span>Cloud Repository</span>
          </h3>
          <button onClick={() => fetchRemote(true)} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-zinc-500 hover:text-ps-blue">
            <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
          </button>
        </div>
        {lastUpdate > 0 && (
          <p className="px-2 text-xs uppercase tracking-widest text-zinc-500">
            Last Sync: {new Date(lastUpdate * 1000).toLocaleString()}
          </p>
        )}

        {loading && remotePayloads.length === 0 ? (
          <div className="py-24 glass-panel rounded-ps-3xl border-white/5 flex flex-col items-center justify-center space-y-6">
            <Loader2 className="w-16 h-16 text-ps-blue animate-spin" />
            <p className="label-caps">Syncing with Repository...</p>
          </div>
        ) : error ? (
          <div className="py-20 glass-card rounded-ps-3xl border-red-500/20 flex flex-col items-center justify-center space-y-6 bg-red-950/5">
            <AlertTriangle className="w-16 h-16 text-red-500 opacity-50" />
            <div className="text-center">
              <p className="text-xl font-bold text-white uppercase tracking-tight">Repository Unavailable</p>
              <p className="text-zinc-500 mt-1">Check your internet connection and try again.</p>
            </div>
            <button onClick={() => fetchRemote(true)} className="px-8 py-3 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-xl font-bold uppercase text-xs transition-all">Retry Connection</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {cloudItems.length === 0 ? (
              <div className="py-20 border-2 border-dashed border-white/5 rounded-ps-3xl flex flex-col items-center justify-center space-y-4 bg-white/[0.01]">
                <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm italic">Repository Up to Date</p>
              </div>
            ) : (
              cloudItems.map((p, i) => (
                <div key={p.filename} className={cn(
                  "glass-card p-6 md:p-8 rounded-ps-3xl flex flex-col md:flex-row justify-between gap-4 md:gap-8 border-white/10 hover:border-ps-blue/20 transition-all bg-white/[0.01]",
                  isPS5 ? "flex-row items-center" : "items-start md:items-center"
                )}>
                  <div className="space-y-2 md:space-y-3 min-w-0">
                    <div className="flex items-center space-x-4">
                      <PayloadName path={p.filename} className="text-xl md:text-2xl text-white" stacked />
                    </div>
                    <p className="text-sm md:text-lg text-zinc-400 font-medium max-w-3xl leading-relaxed">{p.description}</p>
                  </div>

                  <button
                    onClick={() => onInstall(p, repoUrl)}
                    className={cn(
                      "flex items-center justify-center space-x-3 md:space-x-4 px-6 md:px-8 py-3 md:py-5 rounded-2xl font-bold text-lg md:text-xl transition-all shrink-0 transform active:scale-95",
                      isPS5 ? "w-auto px-12" : "w-full md:w-auto",
                      p.isUpdate ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-ps-blue hover:bg-ps-blue/80 text-white"
                    )}
                  >
                    <CloudDownload className="w-5 h-5 md:w-7 md:h-7" />
                    <span>{p.isUpdate ? "Update" : "Install"}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* USB Storage Section */}
      <section className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <h3 className="label-caps !text-ps-blue flex items-center space-x-4 text-lg">
            <HardDrive className="w-6 h-6" />
            <span>USB Storage</span>
          </h3>
          <span className="bg-ps-blue/5 px-4 py-1 rounded-full text-ps-blue font-bold text-xs border border-ps-blue/20">
            {payloads.filter(p => p.includes('/mnt/usb')).length} Files
          </span>
        </div>

        <div className={cn("grid gap-4", isPS5 ? "grid-cols-2" : "grid-cols-1 md:grid-cols-2")}>
          {payloads.filter(p => p.includes('/mnt/usb')).length === 0 ? (
            <div className="col-span-full py-20 border-2 border-dashed border-white/5 rounded-ps-3xl flex flex-col items-center justify-center space-y-6 bg-white/[0.01]">
              <div className="relative">
                <HardDrive className="w-16 h-16 text-white/5" />
                {!config.SCAN_USB_PAYLOADS && (
                  <div className="absolute -top-1 -right-1 bg-amber-500/20 rounded-full p-1 border border-amber-500/50">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  </div>
                )}
              </div>
              <div className="text-center space-y-2">
                <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm italic">No USB Payloads Found</p>
                {!config.SCAN_USB_PAYLOADS && (
                  <p className="text-xs text-zinc-600 max-w-xs mx-auto leading-relaxed">
                    Extended USB scanning is currently disabled. <br /> 
                    Enable <strong>"Scan USB Payloads"</strong> in settings to search for payloads on connected drives.
                  </p>
                )}
              </div>
            </div>
          ) : (
            payloads.filter(p => p.includes('/mnt/usb')).map((path, i) => {
              const fileName = path.split('/').pop()
              return (
                <div key={path} className={cn(
                  "group flex justify-between p-4 md:p-6 glass-card rounded-ps-2xl border-white/10 hover:border-ps-blue/30 gap-4",
                  isPS5 ? "flex-row items-center" : "flex-col md:flex-row md:items-center"
                )}>
                  <div className="flex items-center space-x-4 md:space-x-6 min-w-0">
                    <div className="p-3 md:p-4 bg-white/5 rounded-2xl group-hover:bg-ps-blue/10 transition-colors shrink-0">
                      <Usb className="w-6 h-6 md:w-8 md:h-8 text-zinc-400 group-hover:text-ps-blue transition-colors" />
                    </div>
                    <div className="space-y-1 min-w-0 flex-1">
                      <PayloadName path={path} className="text-xl md:text-2xl text-white" stacked hideIcon={true} />
                      <p className="text-[10px] text-zinc-600 font-medium font-mono uppercase tracking-tighter opacity-60 truncate">{path}</p>
                    </div>
                  </div>
                  <div className="flex items-center ml-auto md:ml-0">
                    <button
                      onClick={() => onImportFromUsb(path)}
                      className="flex items-center space-x-2 md:space-x-3 px-4 md:px-6 py-3 md:py-4 bg-white/5 hover:bg-ps-blue text-white rounded-xl font-bold text-xs md:text-sm transition-all border border-white/10 hover:border-ps-blue group/btn"
                    >
                      <Database className="w-4 h-4 md:w-5 md:h-5 text-ps-blue group-hover/btn:text-white transition-colors" />
                      <span>Move to Internal</span>
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* Footer Info for PS5 */}
      {isPS5 && (
        <div className={cn(
          "glass-card p-6 md:p-10 rounded-ps-3xl flex items-center gap-8 md:gap-12 border-white/10 bg-black/40 mt-12 md:mt-16",
          isPS5 ? "flex-row" : "flex-col md:flex-row"
        )}>
          <div className="flex flex-col items-center space-y-4 md:space-y-6 shrink-0">
            <div className="bg-white p-4 md:p-6 rounded-3xl">
              <QRCodeSVG value={`http://${ip}:8084`} size={isPS5 ? 160 : 120} level="M" />
            </div>
            <code className="text-white font-mono text-base md:text-lg font-black opacity-90 italic tracking-tight uppercase">{ip}:8084</code>
          </div>
          <div className="flex-1 space-y-3 md:space-y-4 text-center md:text-left">
            <h4 className="label-caps !text-white !opacity-100 text-xl md:text-2xl tracking-widest flex items-center justify-center md:justify-start space-x-3 md:space-x-4">
              <div className="w-1.5 h-6 md:w-2 md:h-8 bg-ps-blue rounded-full" />
              <span>Remote Management</span>
            </h4>
            <p className="text-lg md:text-xl text-zinc-400 leading-relaxed italic font-medium max-w-3xl">
              Access this dashboard from your computer or phone to manage and upload payloads directly from your local network.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default StorageHub
