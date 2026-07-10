# Diátaxis boundaries and voice

Four types, four jobs, four voices. A document serves exactly one.

**Tutorial** — learning by doing, for newcomers. Voice: guiding instructor
("we'll build…"). One happy path, working end state, no options or theory.
Smell test: if it explains alternatives or edge cases, it's leaking how-to
or explanation.

**How-to guide** — one task, for someone already working. Voice: direct
imperative ("Add the header. Run X."). Assumes competence; starts from a
real situation; no teaching, no concept detours. Title is the task:
"Rotate the signing key", not "Keys".

**Reference** — facts, for lookup. Voice: neutral, declarative, complete,
structured for scanning. States what IS — never advice ("should"), never
steps. Generated-from-code reference beats hand-written when available;
hand-written reference must cite the code element it describes.

**Explanation** — understanding, for context. Voice: discursive. Why it's
built this way, trade-offs, history, alternatives rejected. The only type
where opinions belong — attributed and reasoned. Decision-shaped
explanations are usually decision records instead.

## Mixing — the failure mode this standard exists to prevent

- Tutorial sprouting "Note: in production you'd also…" → move to how-to.
- How-to explaining the architecture mid-task → link to explanation.
- Reference saying "we recommend" → split fact (reference) from advice
  (how-to or explanation).
- README accumulating depth of any type → README keeps the one-paragraph
  what-it-is, quickstart, and links; depth moves into docs/.

When restructuring a mixed document: split by type, keep each part's text
otherwise intact, leave a link at the old location if inbound links exist.
