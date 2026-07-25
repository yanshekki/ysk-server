type Listener = () => void;

function safeGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

let token: string | null = safeGet('ysk_token');
const listeners = new Set<Listener>();

export const authStore = {
  getToken(): string | null {
    return token;
  },
  setToken(value: string | null): void {
    token = value;
    safeSet('ysk_token', value);
    listeners.forEach((l) => l());
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
