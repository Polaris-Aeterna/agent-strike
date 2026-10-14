// 找出没有包进 L('中文', 'English') 的中文（注释除外）。
// Lists Chinese text that is not wrapped in L('中文', 'English'), ignoring comments.
// node tools/i18n-check.mjs web/modes/moba.js [more files...]
import fs from 'fs';

const CJK = /[㐀-鿿！-～　-〿]/;
let total = 0;

function stripCalls(line) {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === 'L' && line[i + 1] === '(' && !/[\w$]/.test(line[i - 1] || '')) {
      let depth = 0;
      let j = i + 1;
      for (; j < line.length; j++) {
        if (line[j] === '(') depth++;
        else if (line[j] === ')' && --depth === 0) break;
      }
      i = j;
      continue;
    }
    out += line[i];
  }
  return out;
}
for (const file of process.argv.slice(2)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let inBlock = false;
  let inDict = false;
  lines.forEach((raw, i) => {
    // 「i18n-dict」区块里本身就是中英对照表
    if (raw.includes('i18n-dict-start')) inDict = true;
    if (raw.includes('i18n-dict-end')) inDict = false;
    if (inDict) return;
    let line = raw;
    if (inBlock) {
      if (!line.includes('*/')) return;
      line = line.slice(line.indexOf('*/') + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    if (line.includes('/*')) {
      inBlock = true;
      line = line.slice(0, line.indexOf('/*'));
    }
    // 去掉行尾注释（粗略：// 前面不是 : 的那种，避免误伤网址）
    line = line.replace(/(^|[^:])\/\/.*$/, '$1');
    if (!CJK.test(line)) return;
    if (raw.includes('i18n-ok')) return; // 明确标记过的（比如只在中文分支里用的星期表）
    // L('…', '…') 里的中文没问题：把所有 L( … ) 调用（括号配对）去掉再看
    const stripped = stripCalls(line);
    if (CJK.test(stripped)) {
      total++;
      console.log(`${file}:${i + 1}: ${raw.trim().slice(0, 140)}`);
    }
  });
}
console.log(total ? `\n❌ ${total} 行还有没翻译的中文 / ${total} lines with unwrapped Chinese` : '✅ 全部双语 / all strings bilingual');
process.exit(total ? 1 : 0);
