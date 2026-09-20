'use client';

/**
 * shadcn/ui RadioGroup（按需手工落官方 registry 模板，Task 6/7/8/9 先例——CLI 不可用）：
 * 单选组。导入重名策略三选（M5 批次⑥ Task 12）首个消费方；radix-ui 统一包含
 * RadioGroup 命名空间（依赖闭包已就绪，零新增 npm 依赖）。
 * 导入形态对齐 alert-dialog.tsx：统一包命名空间导出，Tailwind 语义变量与 tw-animate。
 */
import * as React from 'react';
import { cn } from 'cn';
import { CircleIcon } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-3', className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-checked:bg-primary aria-checked:text-primary-foreground dark:bg-input/30 data-[state=checked]:border-primary shrink-0 rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
