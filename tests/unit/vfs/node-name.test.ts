// 名称校验规则表（spec §6.2）与 NFC 规范化（spec §6.1）
import { describe, expect, it } from 'vitest';
import { validateNodeName } from '../../../src/main/vfs/nodeName';
import { AppError } from '../../../src/shared/result';
import { E_VFS_INVALID_NAME } from '../../../src/shared/errors';

const invalid = (raw: string): void => {
  expect(() => validateNodeName(raw)).toThrow(AppError);
  try {
    validateNodeName(raw);
  } catch (e) {
    expect((e as AppError).code).toBe(E_VFS_INVALID_NAME);
  }
};

describe('validateNodeName', () => {
  it('合法名称原样通过（NFC 已是规范形）', () => {
    expect(validateNodeName('指数分布.html')).toBe('指数分布.html');
    expect(validateNodeName('a'.repeat(255))).toBe('a'.repeat(255));
  });

  it('NFD 分解形态规范化为 NFC 返回', () => {
    // '拼' 的 NFD 分解（U+62FC 无分解，改用含组合字符的 é：NFD = e + U+0301）
    const nfd = 'cafe\u0301.html';
    expect(nfd.normalize('NFC')).toBe('caf\u00e9.html');
    expect(validateNodeName(nfd)).toBe('caf\u00e9.html');
  });

  it('长度按 Unicode 码点计：128 个增补平面 emoji（128 码点）合法通过', () => {
    // '😀' 为增补平面字符（U+1F600）：1 个码点、2 个 UTF-16 码元，按码点计应通过
    const emoji = '😀'.repeat(128);
    expect(emoji.length).toBe(256); // 前置确认：UTF-16 码元为 256，若按码元计数会误拒本用例
    expect(validateNodeName(emoji)).toBe(emoji);
  });

  it('拒绝：空串、超 255 码点、非法字符、控制字符', () => {
    invalid('');
    invalid('a'.repeat(256));
    invalid('a'.repeat(255) + '😀'); // 256 码点（ASCII 与增补平面混合）
    invalid('😀'.repeat(256)); // 256 码点
    for (const ch of ['/', '\\', ':', '*', '?', '"', '<', '>', '|']) invalid(`a${ch}b`);
    invalid('a\u0000b');
    invalid('a\u0007b');
    invalid('a\u007fb');
  });

  it('拒绝：Windows 保留名（大小写不敏感、含带扩展名形式）', () => {
    for (const name of [
      'CON',
      'con.txt',
      'Prn',
      'AUX',
      'NUL',
      'COM1',
      'com9',
      'LPT1',
      'lpt4.html',
    ]) {
      invalid(name);
    }
    expect(validateNodeName('CONX')).toBe('CONX'); // 非保留名
    expect(validateNodeName('notes.com1')).toBe('notes.com1'); // 主名不是保留名
  });

  it('拒绝：. 与 .. 与尾随空格/点', () => {
    invalid('.');
    invalid('..');
    invalid('a ');
    invalid('a.');
    invalid('. '); // 尾随空格优先命中
  });

  it('拒绝：非字符串输入（运行时防御边界，绕过 TS 契约的调用同样拒绝）', () => {
    invalid(42 as unknown as string);
  });
});
