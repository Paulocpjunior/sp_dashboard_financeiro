import React, { useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { APP_VERSION, APP_RELEASE_DATE, RELEASES } from '../constants';

export const VersionBadge: React.FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ver histórico de atualizações"
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-royal-300 dark:text-slate-500 hover:text-white hover:bg-royal-900/40 dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          <span className="font-mono">{APP_VERSION}</span>
        </span>
        <span className="opacity-70">{APP_RELEASE_DATE}</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4 print:hidden"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col border border-slate-200 dark:border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-royal-950 to-royal-900 text-white">
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-5 w-5" />
                <div>
                  <h3 className="font-bold text-sm">Versão e Histórico de Atualizações</h3>
                  <p className="text-[11px] text-royal-200">SP Dashboard Financeiro</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-white/70 hover:text-white p-1 transition-colors cursor-pointer"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {RELEASES.map((rel, idx) => (
                <div
                  key={rel.version}
                  className={`pb-4 ${idx < RELEASES.length - 1 ? 'border-b border-slate-200 dark:border-slate-800' : ''}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-sm text-royal-700 dark:text-blue-400">
                      {rel.version}
                      {idx === 0 && (
                        <span className="ml-2 px-1.5 py-0.5 text-[9px] font-bold uppercase bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded">
                          Atual
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{rel.date}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {rel.changes.map((c, i) => (
                      <li
                        key={i}
                        className="text-xs text-slate-700 dark:text-slate-300 flex gap-2 leading-relaxed"
                      >
                        <span className="text-royal-500 dark:text-blue-500 shrink-0">•</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-[11px] text-slate-500 dark:text-slate-400 text-center">
              SP Contábil • Painel Administrativo
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default VersionBadge;
