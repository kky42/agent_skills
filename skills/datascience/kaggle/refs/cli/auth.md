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

If credentials are missing, create or place `kaggle.json` where the CLI expects
it, usually `~/.kaggle/kaggle.json`, or set `KAGGLE_CONFIG_DIR`.

For competition-scoped work, prefer passing `-c SLUG` explicitly. Use
`kaggle config set competition SLUG` only when a workflow clearly benefits from
a default.

Record the CLI version, user-visible competition slug, and command used when a
Kaggle action matters for reproducibility.
