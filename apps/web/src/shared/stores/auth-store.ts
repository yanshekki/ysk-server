type Listener = () => void;

let token: string | null = localStorage.getItem('ysk_token');
const listeners = new Set<Listener>();

export const authStore = {
  getToken(): string | null {
    return token;
  },
  setToken(value: string | null): void {
    token = value;
    if (value) localStorage.setItem('ysk_token', value);
    else localStorage.removeItem('ysk_token');
    listeners.forEach((l) => l());
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
