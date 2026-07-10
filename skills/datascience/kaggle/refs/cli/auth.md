# Auth

Use the Kaggle CLI directly. Start each new environment with a short check.

```bash
command -v kaggle
kaggle --version
kaggle config view
kaggle competitions list --page-size 20 --format json
```

If Kaggle is installed with uv, keep the CLI on PATH:

```bash
uv tool install kaggle
uv tool upgrade kaggle
uv tool list | rg '^kaggle '
```

For shells launched outside an interactive terminal, put uv tool binaries on
PATH in `~/.zshenv`:

```zsh
export PATH="$HOME/.local/bin:$PATH"
```

Do not assume `import kaggle` works in the system Python when Kaggle was
installed as a uv tool. For Python scripts that import Kaggle, run them with an
explicit dependency:

```bash
uv run --with kaggle python script.py
```

Accept the current Kaggle authentication methods before declaring auth broken:

- OAuth via `kaggle auth login` (`~/.kaggle/credentials.json`);
- API token via `KAGGLE_API_TOKEN` or `~/.kaggle/access_token`;
- legacy `~/.kaggle/kaggle.json` or `$KAGGLE_CONFIG_DIR/kaggle.json`;
- legacy `KAGGLE_USERNAME` + `KAGGLE_KEY`.

Do not require one method when the CLI is already authenticated by another. Use
a harmless authenticated read command to verify access. Keep credential files
private and never print tokens.

`kaggle config view` often prints optional fields such as `path: None`,
`proxy: None`, or `competition: None`. These are not auth failures. Inspect the
username/auth fields or run a harmless authenticated command instead of grepping
for any occurrence of `None`.

Some direct-HTTP or NVIDIA-derived helpers require a bearer token even when the
CLI is authenticated through OAuth or legacy credentials. Treat that as a
helper-specific limitation. Check for the token without printing it:

```bash
: "${KAGGLE_API_TOKEN:?KAGGLE_API_TOKEN is required for this helper}"
```

For competition-scoped work, prefer passing the competition argument explicitly.
Set a default only when a workflow clearly benefits from it:

```bash
kaggle config set -n competition -v SLUG
```

Record the CLI version, user-visible competition slug, and command used when a
Kaggle action matters for reproducibility. If a wrapper script checks auth, make
it fail loudly with stderr/stdout when a Kaggle command fails; do not silently
convert a failed `submissions`, `files`, or `leaderboard` call into an empty
result.

Check accelerator availability before planning GPU/TPU notebook work:

```bash
kaggle quota
kaggle quota --csv
```
