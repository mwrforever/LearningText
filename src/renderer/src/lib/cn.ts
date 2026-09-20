/** className 合并（shadcn 惯例）：clsx 条件拼接 + tailwind-merge 冲突消解（后写胜） */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
