/**
 * versionMonitor.ts
 *
 * Detecta quando o servidor passou a servir uma versão NOVA do app (bundle JS
 * com hash diferente do que o navegador está executando agora) e dispara um
 * callback para o app exibir um banner "Nova versão disponível — recarregue".
 *
 * Por que isso existe: mesmo com Cache-Control configurado corretamente no
 * Firebase Hosting, navegadores e CDNs podem manter o index.html antigo em
 * cache por algum tempo. Sem esse monitor, um colaborador que abriu o app de
 * manhã pode passar o dia inteiro vendo a versão de ontem.
 *
 * Como funciona:
 *  1. Ao carregar, lê o hash do bundle <script src="/assets/index-XXXXX.js">
 *     que o DOM atual está usando — esse é o hash em execução.
 *  2. A cada 5 min, faz fetch('/', cache: 'no-store') para pegar o index.html
 *     fresco do servidor e extrai o hash do script principal.
 *  3. Se mudou, chama onNewVersion(). O app decide o que fazer (ex: mostrar
 *     banner "Nova versão disponível — clique para recarregar").
 *
 * Importante: este monitor NÃO recarrega sozinho. A decisão é do usuário
 * (clicar no banner) para não interromper trabalho em andamento.
 */

const RUNNING_BUNDLE_RE = /\/assets\/index-([A-Za-z0-9_-]+)\.js/;
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30 * 1000;

function getRunningBundleHash(): string | null {
  try {
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    for (const s of scripts) {
      const src = (s as HTMLScriptElement).src || '';
      const m = src.match(RUNNING_BUNDLE_RE);
      if (m) return m[1];
    }
  } catch { /* ignore */ }
  return null;
}

async function getServerBundleHash(): Promise<string | null> {
  try {
    const res = await fetch('/?_v=' + Date.now(), {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(RUNNING_BUNDLE_RE);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

let monitorStarted = false;
let runningHash: string | null = null;

export function startVersionMonitor(onNewVersion: () => void): void {
  if (monitorStarted) return;
  monitorStarted = true;

  runningHash = getRunningBundleHash();
  if (!runningHash) return;

  let alreadyNotified = false;
  const check = async () => {
    if (alreadyNotified) return;
    const serverHash = await getServerBundleHash();
    if (!serverHash || !runningHash) return;
    if (serverHash !== runningHash) {
      alreadyNotified = true;
      try { onNewVersion(); } catch { /* ignore */ }
    }
  };

  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, POLL_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

export function hardReload(): void {
  const sep = window.location.href.includes('?') ? '&' : '?';
  window.location.href = window.location.href + sep + '_r=' + Date.now();
}
