# Optional Skill Packs

Optional skills are organized as pack manifests plus per-skill manifests.

Structure:

- `template/skill-packs/<pack-id>/pack.json`
- `template/skill-packs/<pack-id>/skills/<skill-id>/skill.json`
- `template/skill-packs/<pack-id>/skills/<skill-id>/SKILL.md`
- `template/skill-packs/<pack-id>/skills/<skill-id>/README.md` (optional)
- `template/skill-packs/<pack-id>/skills/<skill-id>/references/*` (optional)

Rules:

- `pack.json` describes the pack only.
- `skill.json` is the compact machine-readable manifest used for indexing and suggestion.
- `SKILL.md` is the full optional skill and may stay minimal until the skill is authored.
- Agents should read only `live/config/skills-index.json` when suggesting optional skills.
- Agents should open a full optional `SKILL.md` only after the skill is explicitly selected or auto-activated by a hard rule.
