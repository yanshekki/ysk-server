declare module '@novnc/novnc' {
  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: {
        credentials?: { password?: string; username?: string; target?: string };
        shared?: boolean;
        wsProtocols?: string[];
      },
    );
    scaleViewport: boolean;
    clipViewport: boolean;
    resizeSession: boolean;
    background: string;
    viewOnly: boolean;
    disconnect(): void;
    sendCredentials(credentials: {
      password?: string;
      username?: string;
      target?: string;
    }): void;
    sendCtrlAltDel(): void;
    /** Send local text to remote clipboard (ClientCutText / extended clipboard). */
    clipboardPasteFrom(text: string): void;
    focus(): void;
    blur(): void;
    addEventListener(type: string, listener: (ev: Event) => void): void;
    removeEventListener(type: string, listener: (ev: Event) => void): void;
  }
}
