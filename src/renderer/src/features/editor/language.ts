/**
 * MIME → 语言包映射（M4 spec 裁决 D6）：FR-EDIT-01 字面（HTML/CSS/JS）开箱高亮，
 * html() 内嵌 script/style 的 JS/CSS 解析随包内置；json/xml/txt 纯文本不装额外包（YAGNI）。
 */
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import type { LanguageSupport } from '@codemirror/language';

export function languageFor(mimeType: string): LanguageSupport | null {
  switch (mimeType) {
    case 'text/html':
      return html();
    case 'text/css':
      return css();
    case 'text/javascript':
    case 'application/javascript':
      return javascript();
    default:
      return null;
  }
}
