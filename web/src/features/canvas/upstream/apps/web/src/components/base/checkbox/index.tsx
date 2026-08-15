/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/base/checkbox/index.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo } from 'react';
import { Checkbox } from './Checkbox';
import { CheckboxGroup } from './CheckboxGroup';
import type { CheckboxProps, CheckboxChangeEvent, CheckboxGroupOption } from './Checkbox';
import type { CheckboxGroupProps } from './CheckboxGroup';

/** Attach `Group` for static `Checkbox.Group` usage */
(Checkbox as typeof Checkbox & { Group: typeof CheckboxGroup }).Group = CheckboxGroup;

export default memo(Checkbox);
export { Checkbox, CheckboxGroup };
export type { CheckboxProps, CheckboxGroupProps, CheckboxGroupOption, CheckboxChangeEvent };
