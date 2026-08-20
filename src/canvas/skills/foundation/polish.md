# Polish

**Deliverable**: A subtraction-first pass: align, unify, reduce — then stop.
**Core process**: Still Decide → Paint → Observe → Review. This skill owns the last mile.

## When to use

After the plate has a hero, title, support, and (if needed) CTA. Not during the first paint. Load before claiming complete.

## Process overview

Answer before any polish ops:

1. What can be deleted without losing information?
2. What can be merged (same function, two nodes)?
3. What is duplicate (two titles, two CTAs, two heroes)?
4. What decoration does not strengthen the thesis?
5. Are there >1 primary focals? Keep one.

Then: `scene_summary` → align/distribute/reorder → `update_node` for spacing/contrast → do **not** `create_*` decorative extras.

## Checklist

### Alignment & spacing

- [ ] Shared left/right margins (poster: ≥6–8% of width)
- [ ] Type blocks share an edge or a clear center axis — not “almost”
- [ ] Gaps are multiples of a spacing unit (8/16/24/32/48)
- [ ] `canvas.align_nodes` / `canvas.distribute_nodes` used instead of eyeballing 3+ siblings

### Color & contrast

- [ ] Body/support readable on surface
- [ ] Accent used once (CTA or mark), not as a wash
- [ ] No leftover default gray fills on “finished” shapes

### Hierarchy

- [ ] Title reads first at arm’s length
- [ ] Date / venue / CTA are secondary
- [ ] Z-order: hero and title above decorative marks (`reorder_nodes`)

### Copy

- [ ] No typos; language matches the user
- [ ] No invented slogans, logos, prices, QR, phone numbers
- [ ] Title ≤ 2 lines

### Anti-slop

- [ ] `anti_ai_slop` hits empty or justified
- [ ] No emoji-as-icon

## Allowed vs forbidden

```text
Allowed:   remove · merge · simplify · align · reduce · restyle via update_node
Forbidden: new particles · new glass cards · new icon rows · extra create_* decoration
```

Hero, primary title, and the frame itself are protected — do not delete them to “simplify”.

## Hard rules

1. Polish does not add graphics.
2. If two elements fight, remove or quiet one — do not add a third.
3. Prefer `update_node` on the same id over delete+create.
4. Stop when the brief’s thesis is visible in ~1s, not when every gap is filled.

## Done when

- [ ] At least one subtraction considered (even if the answer is “keep”)
- [ ] Alignment / spacing tightened
- [ ] No new decorative nodes this pass
- [ ] You would not be embarrassed at 50% zoom

## Related skills

`anti_ai_slop` · `composition` · `typography`

关键词：打磨 / 对齐 / 间距 / 减法 / 自检 / 完成标准
