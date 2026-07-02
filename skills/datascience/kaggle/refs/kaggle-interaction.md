# Kaggle Browser Interaction via OpenCLI

Perform Kaggle operations that require write access or browser interaction
using your logged-in Chrome session via an OpenCLI browser session. No manual
cookie or CSRF-token extraction is needed; commands run as the logged-in browser
user.

Use this for any Kaggle task that the CLI and Python scripts cannot do:
posting discussions, replying to comments, notebook commenting, or other
interactive operations.

## Setup

Before any browser-based operation, verify OpenCLI is connected. Examples use
`kaggle` as the OpenCLI browser session name; reuse it within one workflow to
keep the same tab state.

```bash
opencli doctor
```

See `refs/opencli-setup.md` if setup is needed.

---

## Post a New Discussion Topic

### Workflow

```bash
# 1. Open the competition discussion page
opencli browser kaggle open "https://www.kaggle.com/competitions/{SLUG}/discussion"

# 2. Inspect to find the "New Topic" button
opencli browser kaggle state

# 3. Click "New Topic" button (ref varies per render — find it first)
opencli browser kaggle click <new-topic-ref>

# 4. Wait for the form to appear
opencli browser kaggle wait time 2

# 5. Fill in the title
opencli browser kaggle type <title-input-ref> "Your topic title"

# 6. Fill in the body (markdown supported)
opencli browser kaggle type <body-textarea-ref> "Your content here..."

# 7. Click "Publish Topic"
opencli browser kaggle click <publish-ref>

# 8. Record the resulting URL
opencli browser kaggle get url
```

### Notes

- Numeric refs change between sessions — always run `opencli browser kaggle state`
  to find current refs.
- The "New Topic" button is generally near the "Follow" button in the
  discussion header area.
- After posting, the browser redirects to the new topic page.
- Record the topic id, message id, URL, and timestamp in the active repo.

---

## Reply to a Discussion Topic

### Workflow

```bash
# 1. Open the specific discussion topic
opencli browser kaggle open "https://www.kaggle.com/competitions/{SLUG}/discussion/{TOPIC_ID}"

# 2. Wait for content to load
opencli browser kaggle wait time 2

# 3. Inspect to find the reply form / textarea
opencli browser kaggle state

# 4. Scroll to the reply area if needed
opencli browser kaggle scroll down --amount 800

# 5. Type the reply into the comment textarea
opencli browser kaggle type <reply-textarea-ref> "Your reply here..."

# 6. Click the "Post Comment" button
opencli browser kaggle click <post-ref>

# 7. Verify it appeared
opencli browser kaggle state
```

### Notes

- If the page has many comments, `scroll down` may be needed to reach the
  reply form at the bottom.
- After posting, the new comment should appear at the top of the comment list.
- Record the comment id and timestamp in the active repo.

---

## Comment on a Notebook

### Workflow

```bash
# 1. Open the notebook page
opencli browser kaggle open "https://www.kaggle.com/code/{OWNER}/{NOTEBOOK_SLUG}"

# 2. Wait for content to load, then scroll down to the comments section
opencli browser kaggle wait time 3
opencli browser kaggle scroll down --amount 1200

# 3. Inspect to find the comment textarea
opencli browser kaggle state

# 4. Type the comment
opencli browser kaggle type <comment-textarea-ref> "Your comment here..."

# 5. Click the "Post" / "Comment" button
opencli browser kaggle click <post-ref>

# 6. Verify it appeared
opencli browser kaggle state
```

### Notes

- Notebook pages load more content lazily (kernel output, data sources).
  Scroll progressively and `state` between scrolls to find the comments
  section at the bottom.
- The comment form on notebook pages works the same as discussion replies.
- Record the comment id and timestamp in the active repo.

---

## General Principle

For any Kaggle operation not covered by the CLI or scripts:

1. Navigate to the relevant page with `opencli browser kaggle open`
2. Use `opencli browser kaggle state` to discover interactive elements
3. Interact with `click`, `type`, `select`
4. Verify with `state` or `get text/value`

The browser is your fallback for anything that requires authentication
beyond the API key.

---

## Finding Element Refs

Always discover refs dynamically — never hardcode them:

```bash
opencli browser kaggle state
```

Look for elements by their visible text or placeholder:

```bash
opencli browser kaggle find --css "button" --limit 10
opencli browser kaggle find --css "textarea"
opencli browser kaggle find --css "input[placeholder*='Topic']"
```
