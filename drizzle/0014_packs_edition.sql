-- Tag each pack with its rules edition so the browse / picker layers can
-- segregate 5e / 5.5e / future content without parsing pack slugs. Nullable
-- because pre-existing packs may not declare one yet; backfill the bundled
-- SRD 5.2 pack to '5e' so today's content keeps surfacing under that edition
-- once filters land.
ALTER TABLE packs ADD COLUMN edition TEXT;
--> statement-breakpoint
UPDATE packs SET edition = '5e' WHERE slug = 'srd-5.2';
