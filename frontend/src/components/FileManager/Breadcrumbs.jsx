import React from 'react';
import { Home, ChevronRight, CornerLeftUp } from 'lucide-react';
import { cn } from '../../utils/helpers';

const Breadcrumbs = ({ currentPath, onNavigate }) => {
  const parts = currentPath.split('/').filter(Boolean);
  
  const handlePartClick = (index) => {
    if (index === -1) {
      onNavigate('/');
      return;
    }
    const newPath = '/' + parts.slice(0, index + 1).join('/');
    onNavigate(newPath);
  };

  const handleUp = () => {
    if (parts.length <= 1) {
      onNavigate('/');
    } else {
      handlePartClick(parts.length - 2);
    }
  };

  return (
    <div className="flex items-center space-x-2 bg-ps-card p-3 px-5 rounded-2xl border border-ps-border overflow-x-auto whitespace-nowrap">
      <button 
        onClick={handleUp}
        disabled={currentPath === '/'}
        className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-zinc-400 mr-2"
        title="Go up one folder"
      >
        <CornerLeftUp className="w-4 h-4" />
      </button>

      <button 
        onClick={() => handlePartClick(-1)}
        className={cn(
          "flex items-center hover:text-white transition-colors",
          parts.length === 0 ? "text-ps-blue font-semibold" : "text-zinc-400"
        )}
      >
        <Home className="w-4 h-4" />
      </button>
      
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
          <button 
            onClick={() => handlePartClick(index)}
            className={cn(
              "hover:text-white transition-colors text-sm",
              index === parts.length - 1 ? "text-ps-blue font-semibold" : "text-zinc-400"
            )}
          >
            {part}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

export default Breadcrumbs;
