import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  'zh-TW': {
    translation: {
      product: 'YSK Server',
      tagline: '以 AI 為核心、安全優先的 Linux 伺服器管理平台',
      nav: {
        dashboard: '儀表板',
        projects: '專案',
        security: '安全',
        email: '郵件',
        updates: '更新',
        agents: 'AI Agent',
        login: '登入',
      },
      login: {
        title: '登入 YSK Server',
        username: '使用者名稱',
        password: '密碼',
        submit: '登入',
        failed: '登入失敗',
      },
      dashboard: {
        title: '控制台',
        health: '健康狀態',
        protection: '保護模式',
        welcome: '歡迎使用 YSK Server',
      },
      security: {
        title: '安全與審批',
        allowlist: '工具 Allowlist（預設唯讀，高風險需人工核准）',
        llmUntrusted: 'LLM 輸出一律視為不可信，不可直接執行',
      },
      email: {
        title: '專業郵件伺服器',
        externalTodos: 'Server 以外必須自行處理的事項',
        ptr: '反向 DNS（PTR）需由 VPS/雲端供應商設定',
        port25: '出站 Port 25 可能被雲端封鎖，需申請解除或使用 Relay',
      },
    },
  },
  en: {
    translation: {
      product: 'YSK Server',
      tagline: 'AI-centric, security-first Linux server management platform',
      nav: {
        dashboard: 'Dashboard',
        projects: 'Projects',
        security: 'Security',
        email: 'Email',
        updates: 'Updates',
        agents: 'AI Agents',
        login: 'Login',
      },
      login: {
        title: 'Sign in to YSK Server',
        username: 'Username',
        password: 'Password',
        submit: 'Sign in',
        failed: 'Login failed',
      },
      dashboard: {
        title: 'Dashboard',
        health: 'Health',
        protection: 'Protection mode',
        welcome: 'Welcome to YSK Server',
      },
      security: {
        title: 'Security & Approvals',
        allowlist: 'Tool Allowlist (read-only default; high-risk needs human approval)',
        llmUntrusted: 'LLM output is always untrusted and must never execute directly',
      },
      email: {
        title: 'Professional Email Server',
        externalTodos: 'Tasks you must handle outside the server',
        ptr: 'Reverse DNS (PTR) must be set by your VPS/cloud provider',
        port25: 'Outbound Port 25 may be blocked; request unblock or use a relay',
      },
    },
  },
  'zh-CN': {
    translation: {
      product: 'YSK Server',
      tagline: '以 AI 为核心、安全优先的 Linux 服务器管理平台',
      nav: {
        dashboard: '仪表盘',
        projects: '项目',
        security: '安全',
        email: '邮件',
        updates: '更新',
        agents: 'AI Agent',
        login: '登录',
      },
      login: {
        title: '登录 YSK Server',
        username: '用户名',
        password: '密码',
        submit: '登录',
        failed: '登录失败',
      },
      dashboard: {
        title: '控制台',
        health: '健康状态',
        protection: '保护模式',
        welcome: '欢迎使用 YSK Server',
      },
      security: {
        title: '安全与审批',
        allowlist: '工具 Allowlist（默认只读，高风险需人工批准）',
        llmUntrusted: 'LLM 输出一律视为不可信，不可直接执行',
      },
      email: {
        title: '专业邮件服务器',
        externalTodos: '必须在服务器之外自行处理的事项',
        ptr: '反向 DNS（PTR）需由 VPS/云厂商设置',
        port25: '出站 Port 25 可能被云厂商封锁，需申请解除或使用中继',
      },
    },
  },
};

void i18n.use(initReactI18next).init({
  resources,
  lng: 'zh-TW',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
