/**
 * Platform services. The UI never touches browser- or Tauri-specific APIs directly, so the
 * same React code can run in the desktop shell, a browser, or a future mobile wrapper
 * (Tauri mobile or Capacitor) by swapping these implementations.
 */

export interface StorageAdapter {
  load<T>(key: string): T | undefined;
  save<T>(key: string, value: T): void;
}

export const localStorageAdapter: StorageAdapter = {
  load<T>(key: string): T | undefined {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  },
  save<T>(key: string, value: T) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or unavailable: the app keeps working in memory */
    }
  },
};

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Save text to a file chosen by the user. Returns false if cancelled. */
export async function saveTextFile(defaultName: string, content: string, filterName: string, ext: string): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
    if (!path) return false;
    await writeTextFile(path, content);
    return true;
  }
  const blob = new Blob([content], { type: ext === 'svg' ? 'image/svg+xml' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Let the user pick a text file and return its contents, or undefined if cancelled. */
export async function openTextFile(filterName: string, ext: string): Promise<string | undefined> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, filters: [{ name: filterName, extensions: [ext] }] });
    if (!path || Array.isArray(path)) return undefined;
    return readTextFile(path);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.${ext}`;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? await f.text() : undefined);
    };
    input.click();
  });
}
