-- Reference data that production needs from day one (docs/03-database.md §5).
-- BR-Y step 4a / Q13: มุตะวัซซิต classes are not part of the system; the student sync skips them silently.
INSERT INTO class_skip_rules (id, prefix, note) VALUES
  (gen_random_uuid(), 'มุตะวัซซิต', 'มุตะวัซซิต ไม่อยู่ในระบบ (Q13)'),
  (gen_random_uuid(), '1M ', 'มุตะวัซซิต ปี 1 (Q13)'),
  (gen_random_uuid(), '2M ', 'มุตะวัซซิต ปี 2 (Q13)'),
  (gen_random_uuid(), '3M ', 'มุตะวัซซิต ปี 3 (Q13)')
ON CONFLICT (prefix) DO NOTHING;
