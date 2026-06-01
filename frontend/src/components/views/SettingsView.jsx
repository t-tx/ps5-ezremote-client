import React, { useState } from 'react'
import { Zap, Terminal, X, ChevronRight } from 'lucide-react'
import { cn } from '../../utils/helpers'

const SettingsView = ({ config, onSaveConfig, isPS5, logs, setLogs, showLogs, setShowLogs }) => {
  const autoOpen = config.AUTO_BROWSER_OPEN !== false
  const autoInstall = config.AUTO_INSTALL_APP !== false
  const autoloadDelay = config.AUTOLOAD_DELAY || 5

  const SettingRow = ({ title, description, children, icon: Icon }) => (
    <div className="flex items-center justify-between p-8 bg-white/[0.03] rounded-3xl border border-white/10 hover:border-ps-blue/30 transition-all group">
      <div className="flex items-center space-x-6">
        {Icon && (
          <div className="p-4 bg-white/5 rounded-2xl group-hover:bg-ps-blue/10 transition-colors">
            <Icon className="w-6 h-6 text-zinc-500 group-hover:text-ps-blue transition-colors" />
          </div>
        )}
        <div className="space-y-1">
          <p className="font-bold text-white uppercase text-lg tracking-tight">{title}</p>
          <p className="text-sm text-zinc-500 max-w-md">{description}</p>
        </div>
      </div>
      <div className="shrink-0 ml-8">
        {children}
      </div>
    </div>
  )

  return (
    <div className="max-w-5xl space-y-16 pb-20">
      <div className="space-y-4">
        <h2 className="text-4xl font-extrabold text-white tracking-tight">
          Settings
        </h2>
      </div>

      {/* Startup Settings */}
      <section className="space-y-8">
        <h3 className="label-caps !text-ps-blue !opacity-100 flex items-center space-x-4 text-xl tracking-[0.2em]">
          <Zap className="w-6 h-6" />
          <span>Startup & Automation</span>
        </h3>

        <div className="space-y-4">
          <SettingRow
            title="Auto-open Browser"
            description="Automatically launch the browser when Payload Manager payload is executed."
          >
            <button
              onClick={() => onSaveConfig({ AUTO_BROWSER_OPEN: !autoOpen })}
              className={cn(
                "w-20 h-10 rounded-full transition-all relative p-1.5",
                autoOpen ? "bg-ps-blue" : "bg-white/10"
              )}
            >
              <div className={cn(
                "w-7 h-7 bg-white rounded-full transition-all",
                autoOpen ? "translate-x-10" : "translate-x-0"
              )} />
            </button>
          </SettingRow>

          <SettingRow
            title="Auto-install App Launcher"
            description="Automatically install the Payload Manager app to the PS5 home screen."
          >
            <button
              onClick={() => onSaveConfig({ AUTO_INSTALL_APP: !autoInstall })}
              className={cn(
                "w-20 h-10 rounded-full transition-all relative p-1.5",
                autoInstall ? "bg-ps-blue" : "bg-white/10"
              )}
            >
              <div className={cn(
                "w-7 h-7 bg-white rounded-full transition-all",
                autoInstall ? "translate-x-10" : "translate-x-0"
              )} />
            </button>
          </SettingRow>

          <SettingRow
            title="Kill Disc Player"
            description="Automatically terminate the Disc Player application on startup (for BD-JB users)."
          >
            <button
              onClick={() => onSaveConfig({ KILL_DISC_PLAYER_ON_STARTUP: !config.KILL_DISC_PLAYER_ON_STARTUP })}
              className={cn(
                "w-20 h-10 rounded-full transition-all relative p-1.5",
                config.KILL_DISC_PLAYER_ON_STARTUP !== false ? "bg-ps-blue" : "bg-white/10"
              )}
            >
              <div className={cn(
                "w-7 h-7 bg-white rounded-full transition-all",
                config.KILL_DISC_PLAYER_ON_STARTUP !== false ? "translate-x-10" : "translate-x-0"
              )} />
            </button>
          </SettingRow>

          <SettingRow
            title="Scan USB Payloads"
            description="Enable scanning for .elf and .bin files in the root directory of USB drives (/mnt/usb0-7)."
          >
            <button
              onClick={() => onSaveConfig({ SCAN_USB_PAYLOADS: !config.SCAN_USB_PAYLOADS })}
              className={cn(
                "w-20 h-10 rounded-full transition-all relative p-1.5",
                config.SCAN_USB_PAYLOADS ? "bg-ps-blue" : "bg-white/10"
              )}
            >
              <div className={cn(
                "w-7 h-7 bg-white rounded-full transition-all",
                config.SCAN_USB_PAYLOADS ? "translate-x-10" : "translate-x-0"
              )} />
            </button>
          </SettingRow>

          <div className="p-8 bg-white/[0.03] rounded-3xl border border-white/10 space-y-8">
            <div className="flex justify-between items-center">
              <div className="space-y-1">
                <p className="font-bold text-white uppercase text-lg tracking-tight">Autoload Delay</p>
                <p className="text-sm text-zinc-500">Wait time before the autoload sequence begins.</p>
              </div>
              <span className="text-ps-blue font-black text-4xl italic tracking-tighter">{autoloadDelay}s</span>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {[3, 5, 10].map(s => (
                <button
                  key={s}
                  onClick={() => onSaveConfig({ AUTOLOAD_DELAY: s })}
                  className={cn(
                    "py-5 rounded-2xl font-black text-xl transition-all border uppercase italic",
                    autoloadDelay === s
                      ? "bg-ps-blue border-ps-blue text-white scale-[1.02]"
                      : "bg-white/5 border-white/10 text-zinc-500 hover:bg-white/10 hover:text-white"
                  )}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Diagnostics */}
      <section className="space-y-8">
        <h3 className="label-caps !text-ps-blue !opacity-100 flex items-center space-x-4 text-xl tracking-[0.2em]">
          <Terminal className="w-6 h-6" />
          <span>System Diagnostics</span>
        </h3>

        <button
          onClick={() => setShowLogs(true)}
          className="w-full group flex items-center justify-between p-8 bg-white/[0.03] rounded-3xl border border-white/10 hover:border-ps-blue/50 hover:bg-ps-blue/5 transition-all text-left"
        >
          <div className="flex items-center space-x-6">
            <div className="p-4 bg-white/5 rounded-2xl group-hover:bg-ps-blue/10 transition-colors">
              <Terminal className="w-6 h-6 text-zinc-500 group-hover:text-ps-blue transition-colors" />
            </div>
            <div className="space-y-1">
              <p className="font-bold text-white uppercase text-lg tracking-tight">Open Log Viewer</p>
              <p className="text-sm text-zinc-500 max-w-md">Access real-time debug output from the background daemon.</p>
            </div>
          </div>
          <ChevronRight className="w-8 h-8 text-zinc-700 group-hover:text-ps-blue group-hover:translate-x-2 transition-all" />
        </button>
      </section>

    </div>
  )
}

export default SettingsView
