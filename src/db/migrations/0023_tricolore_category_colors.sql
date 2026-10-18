-- Slice 35 (SPEC §49): categories still on a colour the old "Create all" picked
-- get the new palette; the user never chose these exact values, so they are defaults.
-- Colours the user picked are left alone. Values come from src/lib/category-color.ts
-- and src/lib/categorize/bank-icons.ts (category-colors-migration.test.ts checks them).

-- 1. Top-level: the palette colours the user doesn't use yet, in order, by creation date.
WITH legacy_top AS (
  SELECT id, user_id, row_number() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn
  FROM categories
  WHERE parent_id IS NULL AND lower(color) IN ('#2e7d32', '#1565c0', '#ef6c00', '#6a1b9a', '#00838f', '#c2185b', '#5d4037', '#558b2f', '#ad1457', '#00695c', '#b71c1c', '#455a64')
),
palette(color, ord) AS (VALUES
  ('#7c3aed', 0),
  ('#0891b2', 1),
  ('#d97706', 2),
  ('#db2777', 3),
  ('#64748b', 4),
  ('#ea580c', 5),
  ('#c026d3', 6),
  ('#92400e', 7),
  ('#a16207', 8),
  ('#6366f1', 9),
  ('#86198f', 10),
  ('#78716c', 11)
),
free AS (
  SELECT u.user_id, p.color, row_number() OVER (PARTITION BY u.user_id ORDER BY p.ord) AS rn
  FROM (SELECT DISTINCT user_id FROM legacy_top) u
  CROSS JOIN palette p
  WHERE NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.user_id = u.user_id AND c.parent_id IS NULL AND lower(c.color) = p.color
  )
)
UPDATE categories c
SET color = coalesce(f.color, (SELECT p.color FROM palette p WHERE p.ord = (l.rn - 1) % 12))
FROM legacy_top l
LEFT JOIN free f ON f.user_id = l.user_id AND f.rn = l.rn
WHERE c.id = l.id;
--> statement-breakpoint
-- 2. Subcategories: a shade of the parent's colour (subcategoryShade), by sibling order.
-- A parent outside the palette falls back to a palette colour.
WITH legacy_sub AS (
  SELECT c.id, lower(p.color) AS parent_color,
    (row_number() OVER (PARTITION BY c.parent_id ORDER BY c.created_at, c.id) - 1) AS idx
  FROM categories c
  JOIN categories p ON p.id = c.parent_id AND p.user_id = c.user_id
  WHERE lower(c.color) IN ('#2e7d32', '#1565c0', '#ef6c00', '#6a1b9a', '#00838f', '#c2185b', '#5d4037', '#558b2f', '#ad1457', '#00695c', '#b71c1c', '#455a64')
),
shades(parent_color, idx, color) AS (VALUES
  ('#7c3aed', 0, '#5d2cb2'),
  ('#7c3aed', 1, '#9965f1'),
  ('#7c3aed', 2, '#442082'),
  ('#7c3aed', 3, '#4a238e'),
  ('#7c3aed', 4, '#32175f'),
  ('#7c3aed', 5, '#381a6b'),
  ('#0891b2', 0, '#066d86'),
  ('#0891b2', 1, '#06718b'),
  ('#0891b2', 2, '#045062'),
  ('#0891b2', 3, '#05576b'),
  ('#0891b2', 4, '#033a47'),
  ('#0891b2', 5, '#044150'),
  ('#d97706', 0, '#a35905'),
  ('#d97706', 1, '#a95d05'),
  ('#d97706', 2, '#774103'),
  ('#d97706', 3, '#824704'),
  ('#d97706', 4, '#573002'),
  ('#d97706', 5, '#623603'),
  ('#db2777', 0, '#a41d59'),
  ('#db2777', 1, '#e35795'),
  ('#db2777', 2, '#781541'),
  ('#db2777', 3, '#831747'),
  ('#db2777', 4, '#581030'),
  ('#db2777', 5, '#631236'),
  ('#64748b', 0, '#4b5768'),
  ('#64748b', 1, '#8693a5'),
  ('#64748b', 2, '#37404c'),
  ('#64748b', 3, '#3c4653'),
  ('#64748b', 4, '#282e38'),
  ('#64748b', 5, '#2d343f'),
  ('#ea580c', 0, '#b04209'),
  ('#ea580c', 1, '#b74509'),
  ('#ea580c', 2, '#813007'),
  ('#ea580c', 3, '#8c3507'),
  ('#ea580c', 4, '#5e2305'),
  ('#ea580c', 5, '#692805'),
  ('#c026d3', 0, '#901d9e'),
  ('#c026d3', 1, '#ce56dd'),
  ('#c026d3', 2, '#6a1574'),
  ('#c026d3', 3, '#73177f'),
  ('#c026d3', 4, '#4d0f54'),
  ('#c026d3', 5, '#56115f'),
  ('#92400e', 0, '#6e300b'),
  ('#92400e', 1, '#aa6a43'),
  ('#92400e', 2, '#502308'),
  ('#92400e', 3, '#582608'),
  ('#92400e', 4, '#3a1a06'),
  ('#92400e', 5, '#421d06'),
  ('#a16207', 0, '#794a05'),
  ('#a16207', 1, '#b6853e'),
  ('#a16207', 2, '#593604'),
  ('#a16207', 3, '#613b04'),
  ('#a16207', 4, '#402703'),
  ('#a16207', 5, '#482c03'),
  ('#6366f1', 0, '#4a4db5'),
  ('#6366f1', 1, '#8588f4'),
  ('#6366f1', 2, '#363885'),
  ('#6366f1', 3, '#3b3d91'),
  ('#6366f1', 4, '#282960'),
  ('#6366f1', 5, '#2d2e6c'),
  ('#86198f', 0, '#65136b'),
  ('#86198f', 1, '#a14ca8'),
  ('#86198f', 2, '#4a0e4f'),
  ('#86198f', 3, '#b675bc'),
  ('#86198f', 4, '#360a39'),
  ('#86198f', 5, '#3c0b40'),
  ('#78716c', 0, '#5a5551'),
  ('#78716c', 1, '#96908c'),
  ('#78716c', 2, '#423e3b'),
  ('#78716c', 3, '#484441'),
  ('#78716c', 4, '#302d2b'),
  ('#78716c', 5, '#363331')
),
palette(color, ord) AS (VALUES
  ('#7c3aed', 0),
  ('#0891b2', 1),
  ('#d97706', 2),
  ('#db2777', 3),
  ('#64748b', 4),
  ('#ea580c', 5),
  ('#c026d3', 6),
  ('#92400e', 7),
  ('#a16207', 8),
  ('#6366f1', 9),
  ('#86198f', 10),
  ('#78716c', 11)
)
UPDATE categories c
SET color = coalesce(s.color, (SELECT p.color FROM palette p WHERE p.ord = l.idx % 12))
FROM legacy_sub l
LEFT JOIN shades s ON s.parent_color = l.parent_color AND s.idx = l.idx % 6
WHERE c.id = l.id;
--> statement-breakpoint
-- 3. Default emojis for top-level categories with a known bank name and no icon.
-- Names are compared like normalizeBankCategoryName: lowercase, no accents, single spaces.
WITH icons(name, icon) AS (VALUES
  ('alimentation', '🛒'),
  ('logement - maison', '🏠'),
  ('transports', '🚗'),
  ('loisirs et vacances', '🎉'),
  ('shopping et services', '🛍️'),
  ('banque et assurances', '🏦'),
  ('transaction exclue', '🔁'),
  ('sante', '🩺'),
  ('revenus', '💶'),
  ('epargne', '🐷'),
  ('impots et taxes', '🧾')
)
UPDATE categories c
SET icon = i.icon
FROM icons i
WHERE c.parent_id IS NULL
  AND (c.icon IS NULL OR c.icon = '')
  AND btrim(regexp_replace(translate(lower(c.name), 'àâäéèêëîïôöùûüç', 'aaaeeeeiioouuuc'), '\s+', ' ', 'g')) = i.name;
