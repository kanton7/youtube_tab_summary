// list.js — 찾기 전용 화면. 목록 · 필터 · 검색 · 태그 관리.

import {
  ensureSeeded, readState, deleteVideo, renameTag, deleteTag, toggleTagPinned,
  createOrGetTag, toggleVideoTag, visibleTagSet, sortTagsForPopup, PAGE_SIZE,
} from './store.js';
import { thumbnailUrl, watchUrl } from './youtube.js';

const el = {
  search: document.getElementById('search'),
  filters: document.getElementById('filters'),
  count: document.getElementById('count'),
  cards: document.getElementById('cards'),
  sentinel: document.getElementById('sentinel'),
  manage: document.getElementById('manage'),
  sheet: document.getElementById('sheet'),
  sheetBody: document.getElementById('sheet-body'),
  sheetMsg: document.getElementById('sheet-msg'),
  sheetClose: document.getElementById('sheet-close'),
};

let videos = [];
let tags = [];
let tagById = new Map();
let filter = 'all';        // 'all' | 'untagged' | 태그 id
let query = '';
let shown = PAGE_SIZE;
let editingId = null;    // 태그를 고치는 중인 카드
let selfWrite = false;      // 내가 쓴 변경은 onChanged에서 무시한다

// ── 데이터 ──────────────────────────────────────────────────

async function load() {
  const state = await readState();
  videos = [...state.videos].sort(
    (a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0)
  );
  tags = sortTagsForPopup(state.tags, state.videos);
  tagById = new Map(tags.map((t) => [t.id, t]));
  if (filter !== 'all' && filter !== 'untagged' && !tagById.has(filter)) filter = 'all';
}

function matches(v) {
  if (filter === 'untagged') {
    if (v.tagIds?.length) return false;
  } else if (filter !== 'all') {
    if (!v.tagIds?.includes(filter)) return false;
  }
  if (query && !v.title.toLocaleLowerCase().includes(query)) return false;
  return true;
}

function visible() {
  return videos.filter(matches);
}

// ── 렌더 ────────────────────────────────────────────────────

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const opts = d.getFullYear() === now.getFullYear()
    ? { month: 'long', day: 'numeric' }
    : { year: 'numeric', month: 'long', day: 'numeric' };
  return new Intl.DateTimeFormat('ko-KR', opts).format(d);
}

function renderFilters() {
  const counts = new Map();
  let untagged = 0;
  for (const v of videos) {
    if (!v.tagIds?.length) untagged += 1;
    for (const id of v.tagIds || []) counts.set(id, (counts.get(id) || 0) + 1);
  }

  const items = [
    { key: 'all', label: '전체' },
    ...tags.map((t) => ({ key: t.id, label: t.name })),
    { key: 'untagged', label: '태그 없음', hide: untagged === 0 },
  ];

  el.filters.replaceChildren();
  for (const item of items) {
    if (item.hide) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter';
    btn.textContent = item.label;
    btn.setAttribute('aria-pressed', String(filter === item.key));
    btn.addEventListener('click', () => {
      filter = item.key;
      shown = PAGE_SIZE;
      renderFilters();
      renderCards();
    });
    el.filters.append(btn);
  }
}

function renderCards() {
  const list = visible();
  el.count.textContent = videos.length ? `${list.length}개` : '';
  el.cards.replaceChildren();

  if (!list.length) {
    el.cards.append(emptyState());
    return;
  }

  const frag = document.createDocumentFragment();
  for (const v of list.slice(0, shown)) frag.append(card(v));
  el.cards.append(frag);
}

function emptyState() {
  const box = document.createElement('div');
  box.className = 'empty';
  const strong = document.createElement('strong');
  if (!videos.length) {
    strong.textContent = '아직 담은 영상이 없어요';
    box.append(strong, document.createTextNode('유튜브에서 확장 아이콘을 눌러보세요'));
  } else {
    strong.textContent = '조건에 맞는 영상이 없어요';
    box.append(strong, document.createTextNode('필터나 검색어를 바꿔보세요'));
  }
  return box;
}

function card(v) {
  const root = document.createElement('article');
  root.className = 'card';

  const img = document.createElement('img');
  img.className = 'card-thumb';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.width = 120;
  img.height = 68;
  img.alt = '';
  img.src = v.thumbnail || thumbnailUrl(v.id);

  const main = document.createElement('div');
  main.className = 'card-main';

  const link = document.createElement('a');
  link.className = 'card-link video-title';
  link.href = watchUrl(v.id);
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = v.title;

  const meta = document.createElement('p');
  meta.className = 'card-meta';
  meta.textContent = [v.channel, formatDate(v.savedAt)].filter(Boolean).join(' · ');

  main.append(link, meta);

  const editing = editingId === v.id;
  if (editing) {
    root.classList.add('is-editing');
    main.append(tagEditor(v, root));
  } else {
    const names = (v.tagIds || []).map((id) => tagById.get(id)?.name).filter(Boolean);
    if (names.length) {
      const row = document.createElement('div');
      row.className = 'card-tags';
      for (const name of names) {
        const chip = document.createElement('span');
        chip.className = 'card-tag';
        chip.textContent = name;
        row.append(chip);
      }
      main.append(row);
    }
  }

  const side = document.createElement('div');
  side.className = 'card-side';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'icon-btn icon-btn--text card-action';
  edit.textContent = editing ? '닫기' : '태그';
  edit.setAttribute('aria-expanded', String(editing));
  edit.setAttribute('aria-label', `${v.title} 태그 고치기`);
  edit.addEventListener('click', () => toggleEditor(v.id));

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'icon-btn icon-btn--text is-danger card-action delete';
  del.textContent = '삭제';
  del.setAttribute('aria-label', `${v.title} 삭제`);
  del.addEventListener('click', async () => {
    selfWrite = true;
    await deleteVideo(v.id);
    await refresh();
  });

  side.append(edit, del);
  root.append(img, main, side);
  return root;
}

// ── 카드에서 태그 고치기 ────────────────────────────────────

/** 편집기를 열고 닫는다. 닫을 때 목록을 다시 그려 필터·개수를 맞춘다. */
function toggleEditor(videoId) {
  const wasOpen = editingId === videoId;
  editingId = wasOpen ? null : videoId;
  if (wasOpen) refresh();
  else renderCards();
}

/**
 * 팝업과 같은 태그 고르개. 누르는 즉시 반영되고 저장 버튼은 없다.
 * 열려 있는 동안 태그 순서는 고정한다 — 누르는 사이에 자리가 바뀌면 오누름이 난다.
 */
function tagEditor(video, cardEl) {
  const box = document.createElement('div');
  box.className = 'card-editor';
  const list = document.createElement('div');
  list.className = 'tag-list';
  box.append(list);

  let order = [...tags];
  let expanded = false;

  const draw = (newTagId = null) => {
    list.replaceChildren();
    const attached = new Set(video.tagIds || []);
    const shownTags = visibleTagSet(order, attached, expanded);

    for (const tag of shownTags) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag';
      if (tag.id === newTagId) btn.classList.add('is-new');
      btn.textContent = tag.name;
      btn.setAttribute('aria-pressed', String(attached.has(tag.id)));
      btn.addEventListener('click', async () => {
        selfWrite = true;
        const res = await toggleVideoTag(video, tag.id);
        video.tagIds = res.tagIds;
        draw();
      });
      list.append(btn);
    }

    const hidden = order.length - shownTags.length;
    if (!expanded && hidden > 0) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'tag tag--ghost';
      more.textContent = '···';
      more.setAttribute('aria-label', `태그 ${hidden}개 더 보기`);
      more.addEventListener('click', () => { expanded = true; draw(); });
      list.append(more);
    }

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tag tag--ghost card-add-tag';
    add.textContent = '+';
    add.setAttribute('aria-label', '새 태그 만들기');
    add.addEventListener('click', openInput);
    list.append(add);
  };

  const closeInput = (input) => {
    if (!input.isConnected) return;
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tag tag--ghost card-add-tag';
    add.textContent = '+';
    add.setAttribute('aria-label', '새 태그 만들기');
    add.addEventListener('click', openInput);
    input.replaceWith(add);
  };

  function openInput() {
    const add = list.querySelector('.card-add-tag');
    if (!add) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tag-input';
    input.placeholder = '새 태그';
    input.maxLength = 24;
    input.setAttribute('aria-label', '새 태그 이름');
    add.replaceWith(input);
    input.focus();

    let composing = false;
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeInput(input); return; }
      if (e.key !== 'Enter' || composing || e.isComposing) return;
      const name = input.value.trim();
      if (!name) { closeInput(input); return; }

      selfWrite = true;
      const { tag } = (await createOrGetTag(name)) || {};
      if (!tag) { closeInput(input); return; }
      if (!order.some((t) => t.id === tag.id)) order = [...order, tag];
      if (!(video.tagIds || []).includes(tag.id)) {
        const res = await toggleVideoTag(video, tag.id);
        video.tagIds = res.tagIds;
      }
      draw(tag.id);
      openInput();
    });

    // 목록 전체가 아니라 입력칸만 되돌린다 — blur 가 다음 클릭보다 먼저 오기 때문이다.
    input.addEventListener('blur', () => closeInput(input));
  }

  cardEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleEditor(video.id);
  });

  draw();
  return box;
}

async function refresh() {
  await load();
  renderFilters();
  renderCards();
  if (el.sheet.open) renderSheet();
}

// ── 50개씩 이어 그리기 ──────────────────────────────────────

const io = new IntersectionObserver((entries) => {
  if (!entries.some((e) => e.isIntersecting)) return;
  if (shown >= visible().length) return;
  shown += PAGE_SIZE;
  renderCards();
}, { rootMargin: '400px' });
io.observe(el.sentinel);

// ── 태그 관리 ───────────────────────────────────────────────

function usageCount(tagId) {
  return videos.reduce((n, v) => n + (v.tagIds?.includes(tagId) ? 1 : 0), 0);
}

function renderSheet({ keepMsg = false, focusAdd = false } = {}) {
  el.sheetBody.replaceChildren();
  if (!keepMsg) el.sheetMsg.textContent = '';

  el.sheetBody.append(addRow());

  if (!tags.length) {
    const box = document.createElement('div');
    box.className = 'empty';
    box.textContent = '태그가 없어요';
    el.sheetBody.append(box);
  } else {
    for (const tag of tags) el.sheetBody.append(tagRow(tag));
  }

  if (focusAdd) el.sheetBody.querySelector('#tag-add-input')?.focus();
}

/** 태그 만들기 — 목록 맨 위에 늘 열려 있는 한 줄. */
function addRow() {
  const row = document.createElement('div');
  row.className = 'tag-row tag-row--add';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename';
  input.id = 'tag-add-input';
  input.placeholder = '새 태그 이름';
  input.maxLength = 24;
  input.setAttribute('aria-label', '새 태그 이름');

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn';
  add.textContent = '추가';

  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });

  const submit = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const res = await createOrGetTag(name);
    if (!res?.tag) return;
    selfWrite = true;
    input.value = '';
    await load();
    renderFilters();
    renderCards();
    renderSheet({ keepMsg: true, focusAdd: true });
    el.sheetMsg.textContent = res.isNew ? '' : `"${res.tag.name}" 태그가 이미 있어요`;
  };

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || composing || e.isComposing) return;
    submit();
  });
  add.addEventListener('click', submit);

  row.append(input, add);
  return row;
}

function tagRow(tag) {
  const row = document.createElement('div');
  row.className = 'tag-row';

  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'icon-btn pin';
  pin.textContent = tag.pinned ? '★' : '☆';
  pin.setAttribute('aria-pressed', String(!!tag.pinned));
  pin.setAttribute('aria-label', `${tag.name} 즐겨찾기`);
  pin.addEventListener('click', async () => {
    selfWrite = true;
    await toggleTagPinned(tag.id);
    await refresh();
  });

  const name = document.createElement('span');
  name.className = 'tag-row-name';
  name.textContent = tag.name;

  const count = document.createElement('span');
  count.className = 'tag-row-count num';
  count.textContent = `${usageCount(tag.id)}개`;

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'icon-btn icon-btn--text';
  edit.textContent = '이름';
  edit.setAttribute('aria-label', `${tag.name} 이름 바꾸기`);
  edit.addEventListener('click', () => startRename(row, tag));

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'icon-btn icon-btn--text is-danger';
  del.textContent = '삭제';
  del.setAttribute('aria-label', `${tag.name} 삭제`);
  // 태그 삭제는 영상 여러 개에 한꺼번에 영향을 준다. 한 번 더 눌러야 지워진다.
  let armed = false;
  del.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      del.textContent = '정말 삭제';
      el.sheetMsg.textContent = `"${tag.name}"을 지워도 영상은 남아요. 한 번 더 누르면 삭제됩니다.`;
      del.addEventListener('blur', () => {
        armed = false;
        del.textContent = '삭제';
        el.sheetMsg.textContent = '';
      }, { once: true });
      return;
    }
    selfWrite = true;
    await deleteTag(tag.id);
    await refresh();
  });

  row.append(pin, name, count, edit, del);
  return row;
}

function startRename(row, tag) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename';
  input.value = tag.name;
  input.maxLength = 24;
  input.setAttribute('aria-label', '태그 이름');
  row.replaceChildren(input);
  input.focus();
  input.select();

  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });

  // 이 행 하나만 되돌린다. 목록 전체를 다시 그리면 지금 누르려던 버튼이 사라진다.
  const cancel = () => { if (row.isConnected) row.replaceWith(tagRow(tag)); };

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { cancel(); return; }
    if (e.key !== 'Enter' || composing || e.isComposing) return;
    const res = await renameTag(tag.id, input.value);
    if (!res.ok) {
      el.sheetMsg.textContent = res.reason === 'duplicate'
        ? '같은 이름의 태그가 이미 있어요'
        : '이름을 입력해주세요';
      input.focus();
      return;
    }
    selfWrite = true;
    await refresh();
  });

  input.addEventListener('blur', () => { if (input.isConnected) cancel(); });
}

el.manage.addEventListener('click', () => {
  renderSheet();
  el.sheet.showModal();
});
el.sheetClose.addEventListener('click', () => el.sheet.close());
el.sheet.addEventListener('click', (e) => {
  if (e.target === el.sheet) el.sheet.close();   // 바깥 클릭으로 닫기
});

// ── 검색 ────────────────────────────────────────────────────

el.search.addEventListener('input', () => {
  query = el.search.value.trim().toLocaleLowerCase();
  shown = PAGE_SIZE;
  renderCards();
});

// 팝업에서 담은 것이 이 탭에도 바로 보이게 한다.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes.videos && !changes.tags) return;
  if (selfWrite) { selfWrite = false; return; }
  refresh();
});

(async () => {
  await ensureSeeded();
  await refresh();
})();
