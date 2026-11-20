WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS position
  FROM team_members
  WHERE calendar_color = '#67c7cf'
)
UPDATE team_members AS member
SET calendar_color = (ARRAY['#5fc4cd', '#a78bfa', '#f59e8b', '#84cc98', '#f0b86e', '#7baaf7', '#db8cb0'])[1 + ((ranked.position - 1) % 7)]
FROM ranked
WHERE member.id = ranked.id;
