// store.js — chrome.storage.local 위에 올린 얇은 데이터 계층.
// videos / tags 두 키만 쓴다. 자세한 스키마는 PRD 7장.

export const DEFAULT_TAG_NAMES = ['참고', '소재', '감상'];
export const POPUP_RECENT_TAGS = 5;   // 즐겨찾기 아래에 사용 많은 순으로 더 보여줄 개수
export const RECENT_WINDOW_DAYS = 30;
export const PAGE_SIZE = 50;

// 읽고-고치고-쓰는 사이에 다른 클릭이 끼어들지 못하게 페이지 안에서 직렬화한다.
let queue = Promise.resolve();

export function nowIso() {
  return new Date().toISOString();
}

export async function readState() {
  const { videos, tags } = await chrome.storage.local.get(['videos', 'tags']);
  return {
    videos: Array.isArray(videos) ? videos : [],
    tags: Array.isArray(tags) ? tags : [],
  };
}

/** 상태를 읽어 mutator에 넘기고, 바뀐 것만 저장한다. mutator의 반환값이 그대로 돌아온다. */
export function update(mutator) {
  const run = queue.then(async () => {
    const state = await readState();
    const result = await mutator(state);
    await chrome.storage.local.set({ videos: state.videos, tags: state.tags });
    return result;
  });
  // 하나가 실패해도 뒤따르는 작업은 계속 돌아야 한다.
  queue = run.catch(() => {});
  return run;
}

/** 설치 직후 또는 태그를 전부 지운 뒤 처음 열렸을 때 기본 태그를 채운다. */
export async function ensureSeeded() {
  const { tags } = await chrome.storage.local.get(['tags']);
  if (Array.isArray(tags)) return;
  await chrome.storage.local.set({
    tags: DEFAULT_TAG_NAMES.map((name, i) => ({
      id: `t${i + 1}`,
      name,
      pinned: false,
      useCount: 0,
      lastUsedAt: null,
    })),
  });
}

function nextTagId(tags) {
  const max = tags.reduce((acc, t) => {
    const n = Number(String(t.id).replace(/^t/, ''));
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `t${max + 1}`;
}

export function normalizeTagName(name) {
  return String(name).trim().replace(/\s+/g, ' ');
}

function sameName(a, b) {
  return normalizeTagName(a).toLocaleLowerCase() === normalizeTagName(b).toLocaleLowerCase();
}

export function findTagByName(tags, name) {
  return tags.find((t) => sameName(t.name, name)) || null;
}

// ── 태그 정렬 ────────────────────────────────────────────────────────
// 1) 즐겨찾기 고정  2) 최근 30일 사용량  3) 누적 사용량  4) 마지막 사용 시각  5) 이름
// 팝업은 이 순서에서 '즐겨찾기 전부 + 그다음 5개'를 펼쳐 보여준다 (popup.js).
export function recentUseCounts(videos, days = RECENT_WINDOW_DAYS) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const counts = new Map();
  for (const v of videos) {
    const at = Date.parse(v.savedAt);
    if (!Number.isFinite(at) || at < since) continue;
    for (const id of v.tagIds || []) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

export function sortTagsForPopup(tags, videos) {
  const recent = recentUseCounts(videos);
  return [...tags].sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    const ra = recent.get(a.id) || 0;
    const rb = recent.get(b.id) || 0;
    if (rb !== ra) return rb - ra;
    if ((b.useCount || 0) !== (a.useCount || 0)) return (b.useCount || 0) - (a.useCount || 0);
    const la = Date.parse(a.lastUsedAt) || 0;
    const lb = Date.parse(b.lastUsedAt) || 0;
    if (lb !== la) return lb - la;
    return a.name.localeCompare(b.name, 'ko');
  });
}

/**
 * 접힌 상태에서 보여줄 태그를 고른다.
 * 즐겨찾기는 전부, 그 아래로 많이 쓴 순 5개.
 * 이미 붙어 있는 태그는 체크가 보여야 하니 밖에 있어도 끼워 넣는다.
 */
export function visibleTagSet(order, attached, expanded = false) {
  if (expanded) return order;
  const pinned = order.filter((t) => t.pinned);
  const rest = order.filter((t) => !t.pinned);
  const top = rest.slice(0, POPUP_RECENT_TAGS);
  const shown = new Set([...pinned, ...top].map((t) => t.id));
  const attachedRest = rest.filter((t) => attached.has(t.id) && !shown.has(t.id));
  return [...pinned, ...top, ...attachedRest];
}

// ── 쓰기 동작 ────────────────────────────────────────────────────────

/**
 * 영상에 태그를 붙이거나 뗀다. 영상이 아직 없으면 이 순간 만들어진다.
 * @returns {{tagIds: string[], created: boolean, attached: boolean}}
 */
export function toggleVideoTag(meta, tagId) {
  return update((state) => {
    let video = state.videos.find((v) => v.id === meta.id);
    let created = false;
    if (!video) {
      video = {
        id: meta.id,
        url: meta.url,
        title: meta.title,
        channel: meta.channel || '',
        thumbnail: meta.thumbnail,
        tagIds: [],
        savedAt: nowIso(),
        source: '팝업',
      };
      state.videos.push(video);
      created = true;
    } else {
      // 같은 영상을 다시 담을 땐 최신 제목·채널로 갱신만 한다 (PRD: 중복 처리)
      if (meta.title) video.title = meta.title;
      if (meta.channel) video.channel = meta.channel;
      if (meta.url) video.url = meta.url;
    }

    const tag = state.tags.find((t) => t.id === tagId);
    const has = video.tagIds.includes(tagId);
    if (has) {
      video.tagIds = video.tagIds.filter((id) => id !== tagId);
      if (tag) tag.useCount = Math.max(0, (tag.useCount || 0) - 1);
    } else {
      video.tagIds.push(tagId);
      if (tag) {
        tag.useCount = (tag.useCount || 0) + 1;
        tag.lastUsedAt = nowIso();
      }
    }
    return { tagIds: [...video.tagIds], created, attached: !has };
  });
}

/** 이름으로 태그를 찾거나 만든다. 이미 있으면 그걸 그대로 쓴다 (PRD 4-C). */
export function createOrGetTag(name) {
  const clean = normalizeTagName(name);
  if (!clean) return Promise.resolve(null);
  return update((state) => {
    const existing = findTagByName(state.tags, clean);
    if (existing) return { tag: { ...existing }, isNew: false };
    const tag = { id: nextTagId(state.tags), name: clean, pinned: false, useCount: 0, lastUsedAt: null };
    state.tags.push(tag);
    return { tag: { ...tag }, isNew: true };
  });
}

export function renameTag(tagId, name) {
  const clean = normalizeTagName(name);
  if (!clean) return Promise.resolve({ ok: false, reason: 'empty' });
  return update((state) => {
    const tag = state.tags.find((t) => t.id === tagId);
    if (!tag) return { ok: false, reason: 'missing' };
    const clash = state.tags.find((t) => t.id !== tagId && sameName(t.name, clean));
    if (clash) return { ok: false, reason: 'duplicate' };
    tag.name = clean;
    return { ok: true };
  });
}

/** 태그를 지운다. 영상은 남고 그 태그만 떨어진다 (PRD 4-I). */
export function deleteTag(tagId) {
  return update((state) => {
    state.tags = state.tags.filter((t) => t.id !== tagId);
    for (const v of state.videos) {
      if (v.tagIds?.includes(tagId)) v.tagIds = v.tagIds.filter((id) => id !== tagId);
    }
    return { ok: true };
  });
}

export function toggleTagPinned(tagId) {
  return update((state) => {
    const tag = state.tags.find((t) => t.id === tagId);
    if (!tag) return { ok: false };
    tag.pinned = !tag.pinned;
    return { ok: true, pinned: tag.pinned };
  });
}

export function deleteVideo(videoId) {
  return update((state) => {
    state.videos = state.videos.filter((v) => v.id !== videoId);
    return { ok: true };
  });
}
