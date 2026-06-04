import React, { useState, useEffect } from 'react'
import {
  Settings,
  FolderOpen,
  Activity,
  Heart,
  Menu,
  Terminal,
  Power,
  X,
  Globe,
  Layers
} from 'lucide-react'

import './App.css'

// Utilities
import { cn, isPS5 } from './utils/helpers'
import { getMainUrl, getDirectDaemonUrl } from './config'
import { useGamepad } from './utils/useGamepad'

// UI Components
import { Toaster, toast } from 'react-hot-toast';
import NavButton from './components/ui/NavButton'
import LogoIcon from './components/ui/LogoIcon'

// Views
import FileManagerView from './views/FileManagerView'
import SpeedTestView from './views/SpeedTestView'
import LogsView from './views/LogsView'
import MetricsView from './views/MetricsView'
import BackgroundJobsView from './views/BackgroundJobsView'

const VIEW_STORAGE_KEY = 'ezremote.activeView'
const DEFAULT_VIEW = 'files'
const VALID_VIEWS = new Set(['files', 'remote', 'speed', 'logs', 'metrics', 'jobs', 'donate'])

const clearSavedView = () => {
  try {
    window.localStorage.removeItem(VIEW_STORAGE_KEY)
  } catch {
    // localStorage can be unavailable in embedded or private browser modes.
  }
}

const readSavedView = () => {
  try {
    const savedView = window.localStorage.getItem(VIEW_STORAGE_KEY)
    if (VALID_VIEWS.has(savedView)) return savedView
    if (savedView) clearSavedView()
  } catch {
    clearSavedView()
  }
  return DEFAULT_VIEW
}

const saveView = (nextView) => {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, nextView)
  } catch {
    // View persistence is optional; navigation should still work without it.
  }
}

function App() {
  const [view, setView] = useState(readSavedView)
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const [ip] = useState(window.location.hostname)
  const [version, setVersion] = useState('1.0.0')

  const setActiveView = (nextView) => {
    if (!VALID_VIEWS.has(nextView)) {
      clearSavedView()
      setView(DEFAULT_VIEW)
      return
    }
    saveView(nextView)
    setView(nextView)
  }


  useGamepad({
    onL1: () => {
      // Focus the currently active button in the sidebar nav
      const activeNavButton = document.querySelector('aside nav button.bg-ps-blue');
      if (activeNavButton) {
        activeNavButton.focus();
      } else {
        document.querySelector('aside button')?.focus();
      }
    },
    onR1: () => {
      // Focus the first focusable element in the main content panel
      const focusable = document.querySelector('main button, main input, main [tabindex="0"]');
      if (focusable) {
        focusable.focus();
      }
    }
  });

  useEffect(() => {
    const init = async () => {
      try {
        const verRes = await fetch(getDirectDaemonUrl('/version')).then(r => r.text())
        if (!verRes.toLowerCase().includes('<!doctype')) setVersion(verRes)
      } catch {
        // The daemon may be offline during early page load; keep the fallback version.
      }
    }
    init()
  }, [])

  return (
    <div className={cn(
      "min-h-screen min-h-[100dvh] ps5-bg text-zinc-100 font-ps5 flex",
      isPS5 ? "flex-row overflow-hidden" : "flex-col md:flex-row md:overflow-hidden"
    )}>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#18181b',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)'
          }
        }}
      />

      <aside className={cn(
        "flex-col bg-black/40 border-r border-white/5 transition-all duration-500 z-[100] h-screen",
        isPS5 ? "flex" : "hidden md:flex",
        sidebarExpanded ? "w-80" : "w-24"
      )}>
        <div className="p-6 flex flex-col h-full">
          <div className="flex items-center mb-12 h-10">
            <button
              onClick={() => setSidebarExpanded(!sidebarExpanded)}
              className="p-3 bg-white/5 hover:bg-ps-blue hover:text-white rounded-xl transition-all mr-4 shrink-0 focus:outline-none focus:ring-4 focus:ring-ps-blue"
              tabIndex="0"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className={cn("flex items-center space-x-3 transition-all duration-500", sidebarExpanded ? "opacity-100 scale-100" : "opacity-0 scale-90 absolute pointer-events-none")}>
              <div className="p-2 bg-ps-blue rounded-xl">
                <LogoIcon className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold tracking-tight text-white">ezRemote</span>
            </div>
          </div>

          <nav className="flex-1 space-y-2">
            <NavButton sidebar sidebarExpanded={sidebarExpanded} active={view === 'files'} onClick={() => setActiveView('files')} icon={FolderOpen} label="Local Files" />
            <NavButton sidebar sidebarExpanded={sidebarExpanded} active={view === 'remote'} onClick={() => setActiveView('remote')} icon={Globe} label="Remote Sites" />
            <NavButton sidebar sidebarExpanded={sidebarExpanded} active={view === 'speed'} onClick={() => setActiveView('speed')} icon={Activity} label="Speed Tests" />
            <NavButton sidebar sidebarExpanded={sidebarExpanded} active={view === 'jobs'} onClick={() => setActiveView('jobs')} icon={Layers} label="Background Jobs" />
            <NavButton sidebar sidebarExpanded={sidebarExpanded} active={view === 'logs'} onClick={() => setActiveView('logs')} icon={Terminal} label="Logs" />
            <NavButton sidebar sidebarExpanded={sidebarExpanded} active={view === 'metrics'} onClick={() => setActiveView('metrics')} icon={Activity} label="Telemetry" />
          </nav>

          <div className="pt-6 border-t border-white/5 space-y-2">
            {sidebarExpanded && (
              <div className="px-4 py-2 text-xs text-zinc-500 font-mono text-center">
                v{version} • {ip}
              </div>
            )}
            <NavButton
              sidebar
              sidebarExpanded={sidebarExpanded}
              active={view === 'donate'}
              onClick={() => setActiveView('donate')}
              icon={Heart}
              label="Donate"
              className={view === 'donate' ? "bg-red-600" : "text-red-500 hover:bg-red-600/10"}
            />
            <NavButton
              sidebar
              sidebarExpanded={sidebarExpanded}
              active={false}
              onClick={async () => {
                if (confirm('Are you sure you want to restart the background daemon? This will stop any ongoing background downloads or tasks.')) {
                  try {
                    const res = await fetch(getMainUrl('/__local__/restart_daemon'));
                    if (res.ok) toast.success('Daemon restart initiated.');
                    else toast.error('Failed to initiate restart.');
                  } catch {
                    toast.error('Network error while requesting restart.');
                  }
                }
              }}
              icon={Power}
              label="Restart"
              className="text-orange-500 hover:bg-orange-500/10"
            />
          </div>
        </div>
      </aside>

      {/* MOBILE BOTTOM NAV */}
      <nav className={cn(
        "fixed bottom-0 inset-x-0 z-[100] bg-black/80 border-t border-white/5 h-[calc(5rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] flex items-center",
        isPS5 ? "hidden" : "md:hidden"
      )}>
        <NavButton active={view === 'files'} onClick={() => setActiveView('files')} icon={FolderOpen} label="Local" mobileLabel="LOCAL" />
        <NavButton showSeparator active={view === 'remote'} onClick={() => setActiveView('remote')} icon={Globe} label="Remote" mobileLabel="REMOTE" />
        <NavButton showSeparator active={view === 'speed'} onClick={() => setActiveView('speed')} icon={Activity} label="Speed" mobileLabel="SPEED" />
        <NavButton showSeparator active={view === 'logs'} onClick={() => setActiveView('logs')} icon={Terminal} label="Logs" mobileLabel="LOGS" />
      </nav>

      {/* MAIN CONTENT AREA */}
      <div className={cn(
        "flex flex-col relative",
        isPS5 ? "h-screen flex-1 min-h-0" : "md:h-screen md:flex-1 md:min-h-0"
      )}>
        <main className={cn(
          "custom-scrollbar max-w-[1800px] mx-auto w-full flex flex-col",
          isPS5 ? "pt-16 px-16 pb-12 flex-1 overflow-y-auto" : "pt-6 px-6 pb-36 md:pt-16 md:px-16 md:pb-12 md:flex-1 md:overflow-y-auto"
        )}>
          {view === 'files' && <FileManagerView key="local" isRemote={false} />}
          {view === 'remote' && <FileManagerView key="remote" isRemote={true} />}
          {view === 'speed' && <SpeedTestView />}
          {view === 'jobs' && <BackgroundJobsView />}
          {view === 'logs' && <LogsView />}
          {view === 'metrics' && <MetricsView />}
          {view === 'donate' && (
            <div className="flex flex-col items-center justify-center p-12 text-center h-full">
              <Heart className="w-24 h-24 text-red-500 mb-6" />
              <h1 className="text-4xl font-bold text-white mb-4">Support ezRemote</h1>
              <p className="text-zinc-400 text-lg max-w-lg">If you find this PS5 utility useful, consider supporting the developers!</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
