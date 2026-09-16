// 节点名称校验（spec §6）：NFC 规范化 + 三平台最严并集规则；失败抛 E_VFS_INVALID_NAME
import { AppError } from '../../shared/result';
import { E_VFS_INVALID_NAME } from '../../shared/errors';

/** Windows 保留设备名（大小写不敏感；带任意扩展名的形式同样保留，如 CON.txt） */
const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/** 非法字符：三平台并集（Windows 特殊符号）+ 控制字符（含 DEL） */
// no-control-regex：本正则的职责就是匹配控制字符（spec §6.2 规则 2），非误用，属有意为之
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/;

export function validateNodeName(raw: string): string {
  const fail = (): never => {
    throw new AppError(E_VFS_INVALID_NAME, '名称含非法字符、超长或为保留名');
  };
  if (typeof raw !== 'string') fail();
  // spec §6.1：统一 NFC（macOS APFS 为 NFD 分解形态，统一后同名判定唯一）
  const name = raw.normalize('NFC');
  // 长度按 Unicode 码点计（spec §6.2 规则①）：String.length 数的是 UTF-16 码元，
  // 增补平面字符（emoji 等）单个占 2 个码元会被双计误拒，须用展开迭代取码点数
  const codePointCount = [...name].length;
  if (codePointCount < 1 || codePointCount > 255) fail();
  if (FORBIDDEN_CHARS.test(name)) fail();
  if (name === '.' || name === '..') fail();
  if (name !== name.trimEnd() || name.endsWith('.')) fail(); // 尾随空格/点（Windows 剥离语义）
  const stem = name.includes('.') ? (name.split('.')[0] ?? '') : name;
  if (stem !== '' && RESERVED_NAMES.has(stem.toUpperCase())) fail();
  return name;
}
