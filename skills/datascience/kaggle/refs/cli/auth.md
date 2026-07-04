# Auth

Use the Kaggle CLI directly. Start each new environment with a short check.

```bash
command -v kaggle
kaggle --version
kaggle config view
kaggle competitions list --page-size 5
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

Accept the standard Kaggle auth sources before declaring auth broken:

- `~/.kaggle/kaggle.json`;
- `$KAGGLE_CONFIG_DIR/kaggle.json`;
- `KAGGLE_USERNAME` + `KAGGLE_KEY`;
- a repo/user-specific `KAGGLE_API_TOKEN` wrapper if that project documents one.

Do not require `KAGGLE_API_TOKEN` when the normal CLI is already authenticated
with `kaggle.json`. If credentials are missing, create or place `kaggle.json`
where the CLI expects it, usually `~/.kaggle/kaggle.json`, or set
`KAGGLE_CONFIG_DIR`.

`kaggle config view` often prints optional fields such as `path: None`,
`proxy: None`, or `competition: None`. These are not auth failures. Inspect the
username/auth fields or run a harmless authenticated command instead of grepping
for any occurrence of `None`.

Some NVIDIA-derived helpers use Kaggle internal APIs and require a KGAT bearer
token in `KAGGLE_API_TOKEN`, even when the normal CLI is authenticated. Treat
that as a helper-specific requirement, not as the general Kaggle auth standard.
Check for it without printing the secret:

```bash
: "${KAGGLE_API_TOKEN:?KAGGLE_API_TOKEN is required for this helper}"
```

For competition-scoped work, prefer passing `-c SLUG` explicitly. Use
`kaggle config set competition SLUG` only when a workflow clearly benefits from
a default.

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
