// youtube.js — 탭 정보에서 영상 하나를 뽑아내는 규칙.

const HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'music.youtube.com', 'youtu.be', 'www.youtu.be',
]);

const ID = /^[A-Za-z0-9_-]{11}$/;

/** 주소에서 영상 id를 뽑는다. 영상 페이지가 아니면 null. */
export function extractVideoId(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname)) return null;

  if (url.hostname.endsWith('youtu.be')) {
    const id = url.pathname.slice(1).split('/')[0];
    return ID.test(id) ? id : null;
  }

  const v = url.searchParams.get('v');
  if (v && ID.test(v)) return v;

  // /shorts/ID, /live/ID, /embed/ID
  const m = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/**
 * 탭 제목을 사람이 읽는 제목으로 되돌린다.
 * 앞의 알림 숫자 `(3) `와 뒤의 ` - YouTube`를 떼어낸다.
 */
export function cleanTitle(rawTitle) {
  let title = String(rawTitle || '').trim();
  title = title.replace(/^\(\s*\d+\+?\s*\)\s*/, '');
  title = title.replace(/\s*[-–—]\s*YouTube(\s+Music)?\s*$/i, '');
  return title.trim();
}

export function thumbnailUrl(id) {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

export function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** 탭 하나를 영상 메타로. 영상 페이지가 아니면 null. */
export function videoFromTab(tab) {
  if (!tab?.url) return null;
  const id = extractVideoId(tab.url);
  if (!id) return null;
  return {
    id,
    url: watchUrl(id),
    title: cleanTitle(tab.title) || watchUrl(id),
    channel: '',
    thumbnail: thumbnailUrl(id),
  };
}
