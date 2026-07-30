type Listener = () => void;

export interface AuthUser {
  id?: string;
  username: string;
  roles: string[];
  locale?: string;
  /** Effective capabilities from last /auth/me */
  capabilities?: string[];
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
let capabilities: string[] = user?.capabilities ?? [];

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
  getCapabilities(): string[] {
    return capabilities;
  },
  setCapabilities(next: string[]): void {
    capabilities = [...next];
    if (user) {
      user = { ...user, capabilities: [...next] };
      safeSet('ysk_user', JSON.stringify(user));
    }
    emit();
  },
  isAuthenticated(): boolean {
    return Boolean(token);
  },
  setSession(nextToken: string, nextUser: AuthUser): void {
    token = nextToken;
    user = nextUser;
    if (nextUser.capabilities) capabilities = [...nextUser.capabilities];
    safeSet('ysk_token', nextToken);
    safeSet('ysk_user', JSON.stringify(nextUser));
    emit();
  },
  setToken(value: string | null): void {
    token = value;
    safeSet('ysk_token', value);
    if (!value) {
      user = null;
      capabilities = [];
      safeSet('ysk_user', null);
    }
    emit();
  },
  clear(): void {
    token = null;
    user = null;
    capabilities = [];
    safeSet('ysk_token', null);
    safeSet('ysk_user', null);
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
