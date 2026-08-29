// background.js — 설치 시 기본 태그 심기 + 아이콘 우클릭 메뉴.

import { ensureSeeded } from './store.js';

const MENU_ID = 'open-library';

function openLibrary() {
  chrome.tabs.create({ url: chrome.runtime.getURL('list.html') });
}

function registerMenu() {
  // 서비스 워커가 다시 깨어날 때 중복 등록되지 않도록 지우고 다시 만든다.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '보관함 열기',
      contexts: ['action'],
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureSeeded();
  registerMenu();
});

chrome.runtime.onStartup.addListener(registerMenu);

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID) openLibrary();
});
