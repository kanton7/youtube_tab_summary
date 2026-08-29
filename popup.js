// popup.js — 담기 전용 화면. 아이콘 클릭 → 태그 클릭, 끝.

import {
  ensureSeeded, readState, sortTagsForPopup, toggleVideoTag, createOrGetTag,
  visibleTagSet,
} from './store.js';
import { videoFromTab } from './youtube.js';

const root = document.getElementById('root');

/** 팝업이 열려 있는 동안 태그 순서는 고정한다. 누르는 사이에 자리가 바뀌면 오누름이 난다. */
let order = [];
let attached = new Set();
let expanded = false;
let composing = false;
let statusTouched = false;
let meta = null;

function openList() {
  chrome.tabs.create({ url: chrome.runtime.getURL('list.html') });
  window.close();
}

function mount(templateId) {
  root.replaceChildren(document.getElementById(templateId).content.cloneNode(true));
}

async function main() {
  await ensureSeeded();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  meta = videoFromTab(tab);

  if (!meta) {
    mount('tpl-notice');
    root.querySelector('#open-list').addEventListener('click', openList);
    return;
  }

  const state = await readState();
  const saved = state.videos.find((v) => v.id === meta.id) || null;
  if (saved?.channel) meta.channel = saved.channel;

  attached = new Set(saved?.tagIds || []);
  order = sortTagsForPopup(state.tags, state.videos);

  mount('tpl-video');
  const thumb = root.querySelector('#thumb');
  thumb.src = meta.thumbnail;
  thumb.alt = '';
  root.querySelector('#title').textContent = meta.title;
  root.querySelector('#open-list').addEventListener('click', openList);

  paintChannel();
  paintFooter(state.videos.length);
  renderTags();

  // 채널명은 있으면 좋은 정보라 화면을 붙잡지 않는다. 늦게 오면 그때 채운다.
  fetchChannel(tab.id);
}

function paintChannel() {
  const el = root.querySelector('#channel');
  if (!el) return;
  el.textContent = meta.channel || '';
  el.hidden = !meta.channel;
}

function paintFooter(total) {
  const btn = root.querySelector('#open-list');
  if (btn) btn.textContent = `전체 보기 (${total}개)`;
}

function paintStatus() {
  const el = root.querySelector('#status');
  if (!el) return;
  if (!attached.size && !statusTouched) { el.textContent = ''; return; }
  el.textContent = attached.size ? `저장됨 · 태그 ${attached.size}개` : '저장됨 · 태그 없음';
}

// ── 태그 렌더 ────────────────────────────────────────────────

function visibleTags() {
  return visibleTagSet(order, attached, expanded);
}

function renderTags(newTagId = null) {
  const box = root.querySelector('#tags');
  if (!box) return;
  box.replaceChildren();

  for (const tag of visibleTags()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag';
    if (tag.id === newTagId) btn.classList.add('is-new');
    btn.textContent = tag.name;
    btn.setAttribute('aria-pressed', String(attached.has(tag.id)));
    btn.addEventListener('click', () => onToggle(tag.id));
    box.append(btn);
  }

  if (!expanded && order.length > visibleTags().length) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'tag tag--ghost';
    more.textContent = '···';
    more.setAttribute('aria-label', `태그 ${order.length - visibleTags().length}개 더 보기`);
    more.addEventListener('click', () => { expanded = true; renderTags(); });
    box.append(more);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tag tag--ghost';
  add.id = 'add-tag';
  add.textContent = '+';
  add.setAttribute('aria-label', '새 태그 만들기');
  add.addEventListener('click', openTagInput);
  box.append(add);

  const first = box.querySelector('.tag');
  if (first && !document.activeElement?.closest('#tags')) first.focus();
}

async function onToggle(tagId) {
  const res = await toggleVideoTag(meta, tagId);
  attached = new Set(res.tagIds);
  statusTouched = true;
  renderTags();
  paintStatus();
  if (res.created) {
    const { videos } = await readState();
    paintFooter(videos.length);
  }
}

// ── 새 태그 ─────────────────────────────────────────────────

function openTagInput() {
  const box = root.querySelector('#tags');
  const add = box.querySelector('#add-tag');
  if (!add) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-input';
  input.placeholder = '새 태그';
  input.maxLength = 24;
  input.setAttribute('aria-label', '새 태그 이름');
  add.replaceWith(input);
  input.focus();

  // 한글 입력 중의 엔터는 조합을 끝내는 엔터라 태그를 만들면 안 된다.
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { closeTagInput(input); return; }
    if (e.key !== 'Enter' || composing || e.isComposing) return;

    const name = input.value.trim();
    if (!name) { closeTagInput(input); return; }

    const { tag } = (await createOrGetTag(name)) || {};
    if (!tag) { closeTagInput(input); return; }

    if (!order.some((t) => t.id === tag.id)) order = [...order, tag];
    if (!attached.has(tag.id)) await onToggle(tag.id);

    // 흐름을 끊지 않는다 — 만들자마자 다음 태그를 바로 칠 수 있게 둔다.
    renderTags(tag.id);
    openTagInput();
  });

  input.addEventListener('blur', () => closeTagInput(input));
}

/**
 * 입력칸을 + 버튼으로 되돌린다. 이 노드 하나만 갈아끼우는 게 중요하다 —
 * blur는 다음 클릭보다 먼저 오기 때문에, 여기서 목록을 다시 그리면 그 클릭이 사라진다.
 */
function closeTagInput(input) {
  if (!input.isConnected) return;
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tag tag--ghost';
  add.id = 'add-tag';
  add.textContent = '+';
  add.setAttribute('aria-label', '새 태그 만들기');
  add.addEventListener('click', openTagInput);
  input.replaceWith(add);
}

// ── 채널명 (있으면 좋은 정보) ───────────────────────────────

async function fetchChannel(tabId) {
  if (meta.channel || tabId == null) return;
  try {
    const [hit] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const sel = [
          'ytd-video-owner-renderer ytd-channel-name a',
          '#upload-info #channel-name a',
          'ytd-reel-player-header-renderer #channel-name a',
          'link[itemprop="name"]',
          'meta[itemprop="author"]',
        ];
        for (const s of sel) {
          const el = document.querySelector(s);
          const v = el?.textContent?.trim() || el?.getAttribute('content') || '';
          if (v) return v;
        }
        return '';
      },
    });
    const name = (hit?.result || '').trim();
    if (!name) return;
    meta.channel = name;
    paintChannel();
  } catch {
    // 못 가져오면 비워두고 넘어간다 (PRD 9-2).
  }
}

main();
