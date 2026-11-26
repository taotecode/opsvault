import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const zh = {
  translation: {
    appName: 'OpsVault',
    appSub: '服务器资产管理平台',
    nav: {
      dashboard: '仪表盘',
      hosts: '服务器',
      credentials: '凭据保险库',
      keypairs: '密钥对',
      terminal: 'Web 终端',
      audit: '审计日志',
      users: '用户与角色',
      api: 'API 与 Agent',
      settings: '设置',
      overview: '总览',
      assets: '资产',
      operations: '操作',
      platform: '平台',
    },
    common: {
      searchPlaceholder: '搜索服务器、页面…',
      logout: '退出登录',
      save: '保存',
      cancel: '取消',
      delete: '删除',
      confirm: '确认',
      copy: '复制',
      copied: '已复制',
      loading: '加载中…',
      empty: '暂无数据',
      error: '操作失败',
      enabled: '已启用',
      disabled: '未启用',
    },
    theme: { light: '浅色', dark: '深色' },
  },
};

const en = {
  translation: {
    appName: 'OpsVault',
    appSub: 'Server Asset Platform',
    nav: {
      dashboard: 'Dashboard',
      hosts: 'Servers',
      credentials: 'Vault',
      keypairs: 'Keys',
      terminal: 'Terminal',
      audit: 'Audit',
      users: 'Users',
      api: 'API & Agents',
      settings: 'Settings',
      overview: 'Overview',
      assets: 'Assets',
      operations: 'Operations',
      platform: 'Platform',
    },
    common: {
      searchPlaceholder: 'Search hosts, pages…',
      logout: 'Sign out',
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      confirm: 'Confirm',
      copy: 'Copy',
      copied: 'Copied',
      loading: 'Loading…',
      empty: 'No data',
      error: 'Request failed',
      enabled: 'Enabled',
      disabled: 'Disabled',
    },
    theme: { light: 'Light', dark: 'Dark' },
  },
};

void i18n.use(initReactI18next).init({
  resources: { zh, en },
  lng: localStorage.getItem('opsvault-lang') || 'zh',
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
});

export default i18n;
