-- Merge participants.kind 'monster' into 'npc'. The encounter builder
-- exposes one "NPC" choice now; the underlying participant row always
-- references a content row when one applies (statblockSlug), so the
-- separate 'monster' kind no longer carries meaning. The Zod
-- ParticipantKind enum tightens to ['pc', 'npc'] in the same change.
UPDATE `participants` SET `kind` = 'npc' WHERE `kind` = 'monster';
