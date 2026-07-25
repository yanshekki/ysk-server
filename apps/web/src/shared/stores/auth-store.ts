type Listener = () => void;

export interface AuthUser {
  id?: string;
  username: string;
  roles: string[];
  locale?: string;
}

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
let user: AuthUser | null = (() => {
  const raw = safeGet('ysk_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
})();

const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export const authStore = {
  getToken(): string | null {
    return token;
  },
  getUser(): AuthUser | null {
    return user;
  },
  isAuthenticated(): boolean {
    return Boolean(token);
  },
  setSession(nextToken: string, nextUser: AuthUser): void {
    token = nextToken;
    user = nextUser;
    safeSet('ysk_token', nextToken);
    safeSet('ysk_user', JSON.stringify(nextUser));
    emit();
  },
  setToken(value: string | null): void {
    token = value;
    safeSet('ysk_token', value);
    if (!value) {
      user = null;
      safeSet('ysk_user', null);
    }
    emit();
  },
  clear(): void {
    token = null;
    user = null;
    safeSet('ysk_token', null);
    safeSet('ysk_user', null);
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
