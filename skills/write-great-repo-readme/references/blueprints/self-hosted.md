# Self-Hosted or Data-Sensitive Product

Recommended order:

1. Product outcome and screenshot
2. Prominent status and data-safety notice
3. Demo, when safe and available
4. Installation path
5. Backup, restore, upgrade, and storage expectations
6. Authentication, network exposure, and privacy model
7. Client or feature matrix
8. Documentation and troubleshooting
9. Security reporting, contributing, license

Put backup and destructive-risk warnings before installation or migration steps. Distinguish application availability from data durability. State whether the project is pre-1.0, what upgrades may break, and which responsibilities remain with the operator.

Keep these boundaries:

- distinguish service availability from an independent backup;
- include restore verification;
- present secure production configurations, labeling development-only insecure defaults and their mitigations;
- state specific migration risks and mitigations before the relevant action.

**Accepted when:** an operator can install the service only after seeing verified backup, restore, upgrade, authentication, exposure, storage, and data-durability responsibilities.
