// 语言映射（M4 spec 裁决 D6）：html/css/js 有高亮，json/xml/txt 纯文本（FR-EDIT-01 字面）
import { describe, expect, it } from 'vitest';
import { languageFor } from '../../../src/renderer/src/features/editor/language';

describe('languageFor', () => {
  it('text/html、text/css、javascript 三系返回语言支持实例', () => {
    expect(languageFor('text/html')).not.toBeNull();
    expect(languageFor('text/css')).not.toBeNull();
    expect(languageFor('text/javascript')).not.toBeNull();
    expect(languageFor('application/javascript')).not.toBeNull();
  });

  it('json/xml/txt/未知与目录 null（无高亮纯文本，不装额外语言包）', () => {
    expect(languageFor('application/json')).toBeNull();
    expect(languageFor('application/xml')).toBeNull();
    expect(languageFor('text/plain')).toBeNull();
    expect(languageFor('application/octet-stream')).toBeNull();
  });
});
