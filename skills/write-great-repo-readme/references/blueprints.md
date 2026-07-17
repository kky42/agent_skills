# README Blueprint Router

After repository inspection identifies the project category, open exactly one matching blueprint:

- [Library, SDK, framework, or CLI](blueprints/library-cli.md)
- [User-facing desktop, mobile, or web application](blueprints/application.md)
- [Hosted product plus package, component, or SDK](blueprints/hosted-package.md)
- [Platform, monorepo, or multi-component system](blueprints/platform-monorepo.md)
- [Self-hosted or data-sensitive product](blueprints/self-hosted.md)
- [Tutorial, curriculum, roadmap, or knowledge repository](blueprints/tutorial-knowledge.md)

Treat its order as a default reading path. Keep only sections that earn their space, and name headings with the project's vocabulary.

## Evidence Patterns

Use the cheapest proof that answers the reader's biggest uncertainty:

| Reader uncertainty | Useful evidence |
| --- | --- |
| “What does it look like?” | Focused screenshot or short GIF |
| “What does this code produce?” | Code/result pair |
| “Can I run it quickly?” | Complete terminal transcript |
| “Is it actually faster?” | Reproducible benchmark and methodology |
| “How do the pieces fit?” | Labeled architecture diagram |
| “Does my platform support it?” | Compatibility matrix |
| “Is it safe for my data?” | Explicit backup, privacy, and failure model |
| “Where should I start?” | Goal-based route or ordered curriculum |

A visual is evidence rather than decoration. Include it when it resolves uncertainty faster than prose, and keep its generation or update process reproducible when possible.
