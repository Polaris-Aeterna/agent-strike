// 中英双语 / Chinese–English.
// 所有给人看的文字都写成 L('中文', 'English')，按当前语言返回其中一个。
// Every user-visible string is written as L('中文', 'English') and resolved at the moment it is shown.

const KEY = 'as.lang';

function initial() {
  if (globalThis.AS_LANG === 'zh' || globalThis.AS_LANG === 'en') return globalThis.AS_LANG; // 测试工具用 / used by tools/
  if (!globalThis.window) return 'zh'; // 不在浏览器里（测试工具）/ outside a browser
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('lang');
    if (q === 'zh' || q === 'en') return q;
  } catch {
    /* 没有网址就算了 */
  }
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    if (v === 'zh' || v === 'en') return v;
  } catch {
    /* 隐私模式下读不了也没关系 */
  }
  return /^zh/i.test(globalThis.navigator?.language || '') ? 'zh' : 'en';
}

export let lang = initial();

export const L = (zh, en) => (lang === 'en' ? en : zh);

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'zh';
  if (!globalThis.window) return;
  try {
    globalThis.localStorage?.setItem(KEY, lang);
  } catch {
    /* 存不了也没关系 */
  }
  if (globalThis.document) document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
}
