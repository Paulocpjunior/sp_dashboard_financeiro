import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { startVersionMonitor, hardReload } from '../utils/versionMonitor';

const UpdateBanner: React.FC = () => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    startVersionMonitor(() => setShow(true));
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[9999] px-4 py-2.5 shadow-lg flex items-center justify-center gap-3 text-sm font-medium text-white"
      style={{ background: '#1400FF' }}
    >
      <RefreshCw className="w-4 h-4 flex-shrink-0" />
      <span>Nova versão do sistema disponível.</span>
      <button
        onClick={hardReload}
        className="ml-2 px-3 py-1 rounded bg-white hover:bg-blue-50 font-semibold text-xs transition-colors"
        style={{ color: '#08007A' }}
      >
        Recarregar agora
      </button>
      <button
        onClick={() => setShow(false)}
        aria-label="Dispensar"
        className="ml-1 px-2 py-1 rounded hover:bg-white/20 text-xs"
      >
        Depois
      </button>
    </div>
  );
};

export default UpdateBanner;
