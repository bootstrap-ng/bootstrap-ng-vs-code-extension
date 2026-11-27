"""Review a pull request diff with Ollama and keep one summary comment on the PR."""

import base64
import json
import os
import re
import urllib.error
import urllib.request

HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)
FILE_BOUNDARY_PREFIXES = ("+++ ", "--- ", "diff --git ")

NO_DIFF_MESSAGE = "No reviewable diff after excluding lockfiles and generated files."
STYLE_ONLY_MESSAGE = "Only style/formatting changes remain; skipping review."
DEFAULT_SUMMARY = "Automated Ollama Pro review completed."
DEFAULT_MODEL = "glm-5.3"
# Written by the workflow from the base branch's AGENTS.md files.
GUIDELINES_FILE = "guidelines.md"
MAX_GUIDELINES_CHARS = 10000
MAX_DIFF_CHARS = 65000
BOT_LOGIN = "github-actions[bot]"
COMMENT_MARKER = "<!-- ollama-pro-pr-review -->"
# Hidden state in the comment: findings and resolved findings, base64 JSON.
STATE_PREFIX = "<!-- ollama-state:"
STATUS_MARKER = "<!-- ollama-status -->"
MAX_RESOLVED = 20
MAX_STATE_TEXT = 200
OLLAMA_TIMEOUT = 300
# A timed-out Ollama request is tried this many more times.
OLLAMA_RETRIES = 1
# PR authors whose clean reviews may be auto-approved.
DEFAULT_APPROVE_AUTHORS = "coliff,dependabot[bot]"

SYSTEM_PROMPT = (
    "You are a senior code reviewer. Inspect the annotated git diff where [LN] "
    "marks the exact line number in the new file (RIGHT side of the diff). "
    "Lockfiles, generated files, and formatting/style-only changes have already "
    "been filtered out. "
    "Return ONLY valid JSON matching this schema with no markdown fences:\n"
    '{"verdict":"clean or issues","summary":"short overall summary","comments":'
    '[{"path":"file/path","line":12,"body":"what is wrong and why it matters",'
    '"suggestion":"corrected code for that line or block, or empty"}]}\n'
    'Set "verdict" to "clean" only when you found no problems at all, anywhere '
    'in the diff; otherwise set it to "issues". '
    "Rules: Ignore formatting, indentation, quotes, semicolons, or import "
    "ordering unless they cause a runtime/type error. "
    "Only comment on real bugs, logic errors, security risks, edge cases, or "
    "regressions on lines marked with [LN]. Unmarked context lines are there to "
    "help you understand the change. "
    "For each comment, explain the concrete problem and give a specific fix: "
    'put replacement code in "suggestion" whenever the fix is a code change. '
    "Do not give vague advice such as 'consider adding error handling'. "
    "When repository guidelines are provided, follow them: do not flag code "
    "that the guidelines allow, and do flag clear violations of them."
)


def read_text(path: str) -> str:
    """Read a diff file, replacing undecodable bytes."""
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def normalize_style_token(s: str) -> str:
    """Strip whitespace, quote style and semicolons so style-only edits compare equal."""
    s = re.sub(r"\s+", "", s)
    s = s.replace("'", '"').replace(";", "")
    return s


def is_added(diff_line: str) -> bool:
    """Return True for an added line, excluding the +++ file header."""
    return diff_line.startswith("+") and not diff_line.startswith("+++")


def is_removed(diff_line: str) -> bool:
    """Return True for a removed line, excluding the --- file header."""
    return diff_line.startswith("-") and not diff_line.startswith("---")


def normalized_lines(hunk: dict, predicate) -> list[str]:
    """Normalize the hunk lines matching predicate, dropping ones that end up empty."""
    result = []
    for diff_line in hunk["lines"]:
        if predicate(diff_line):
            norm = normalize_style_token(diff_line[1:])
            if norm:
                result.append(norm)
    return result


def split_file_hunks(diff_text: str) -> dict[str, list[dict]]:
    """Split a unified diff into hunks, keyed by the new file path."""
    files: dict[str, list[dict]] = {}
    current_file = None
    current_hunk: dict | None = None

    for diff_line in diff_text.splitlines():
        if diff_line.startswith("+++ b/"):
            current_file = diff_line[6:].strip()
            files.setdefault(current_file, [])
            current_hunk = None
            continue
        if diff_line.startswith(FILE_BOUNDARY_PREFIXES):
            current_file = None
            current_hunk = None
            continue

        if current_file is None:
            continue

        m = HUNK_RE.match(diff_line)
        if m:
            current_hunk = {
                "header": diff_line,
                "start_new": int(m.group(1)),
                "lines": [],
            }
            files[current_file].append(current_hunk)
        elif current_hunk is not None:
            current_hunk["lines"].append(diff_line)

    return files


def hunk_style_signature(hunk: dict) -> str:
    """Build a whitespace/style-insensitive signature of a hunk's changes."""
    added = normalized_lines(hunk, is_added)
    removed = normalized_lines(hunk, is_removed)
    return f"ADD:{'|'.join(added)}||DEL:{'|'.join(removed)}"


def has_changes(hunk: dict) -> bool:
    """Return True when a hunk adds or removes at least one line."""
    return any(is_added(dl) or is_removed(dl) for dl in hunk["lines"])


def is_style_only(hunk: dict, no_ws_sigs: set[str]) -> bool:
    """Return True when a hunk only changes whitespace, quotes or semicolons."""
    if hunk_style_signature(hunk) not in no_ws_sigs:
        return False
    return normalized_lines(hunk, is_added) == normalized_lines(hunk, is_removed)


def is_reviewable(hunk: dict, no_ws_sigs: set[str]) -> bool:
    """Return True when a hunk has changes beyond whitespace and style."""
    return has_changes(hunk) and not is_style_only(hunk, no_ws_sigs)


def annotate_diff(raw_diff: str, no_ws_diff: str) -> tuple[str, dict[str, set[int]]]:
    """Annotate reviewable hunks with new-file line numbers.

    Returns the annotated diff and, for each file, the line numbers that
    can carry an inline review comment.
    """
    raw_files = split_file_hunks(raw_diff)
    no_ws_files = split_file_hunks(no_ws_diff)

    valid_lines_by_file: dict[str, set[int]] = {}
    annotated_lines: list[str] = []

    for file_path, hunks in raw_files.items():
        no_ws_sigs = {hunk_style_signature(h) for h in no_ws_files.get(file_path, [])}
        kept_hunks = [h for h in hunks if is_reviewable(h, no_ws_sigs)]

        if not kept_hunks:
            continue

        valid_lines = valid_lines_by_file.setdefault(file_path, set())
        annotated_lines.append(f"diff --git a/{file_path} b/{file_path}")
        annotated_lines.append(f"--- a/{file_path}")
        annotated_lines.append(f"+++ b/{file_path}")

        for hunk in kept_hunks:
            annotated_lines.append(hunk["header"])
            new_line = hunk["start_new"]
            for diff_line in hunk["lines"]:
                if is_removed(diff_line):
                    annotated_lines.append(f"[DEL ] {diff_line}")
                else:
                    valid_lines.add(new_line)
                    annotated_lines.append(f"[L{new_line}] {diff_line}")
                    new_line += 1

    return "\n".join(annotated_lines), valid_lines_by_file


def build_user_message(annotated_diff: str, guidelines: str) -> str:
    """Combine repository guidelines (if any) with the annotated diff."""
    if not guidelines.strip():
        return annotated_diff
    return (
        "Repository guidelines:\n\n"
        f"{guidelines.strip()[:MAX_GUIDELINES_CHARS]}\n\n"
        "Annotated diff:\n\n"
        f"{annotated_diff}"
    )


def request_review(api_key: str, user_message: str, model: str) -> dict:
    """Ask the model for a review and parse its JSON reply."""
    payload = json.dumps(
        {
            "model": model,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        "https://ollama.com/v1/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    for attempt in range(OLLAMA_RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as resp:
                api_data = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Ollama HTTP {exc.code} ({model}): {body}") from exc
        except (TimeoutError, urllib.error.URLError) as exc:
            reason = getattr(exc, "reason", exc)
            if not isinstance(reason, TimeoutError) or attempt == OLLAMA_RETRIES:
                raise
            print(f"Ollama request timed out after {OLLAMA_TIMEOUT}s; retrying.")

    content = api_data["choices"][0]["message"]["content"].strip()
    content = FENCE_RE.sub("", content).strip()

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Unparseable reply: never treat it as a clean review.
        return {"summary": content[:4000], "comments": [], "unparsed": True}


def line_at(path: str, line_num: int) -> str:
    """Return a line of the checked-out file at HEAD, or "" if unavailable."""
    try:
        lines = read_text(path).splitlines()
    except OSError:
        return ""
    return lines[line_num - 1] if 0 < line_num <= len(lines) else ""


def build_findings(
    parsed: dict,
    valid_lines_by_file: dict[str, set[int]],
) -> list[dict]:
    """Normalize model comments, remembering the code line each one points at."""
    findings: list[dict] = []

    raw_comments = parsed.get("comments", [])
    if not isinstance(raw_comments, list):
        return findings

    for item in raw_comments:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path", "")).strip().removeprefix("./")
        body = str(item.get("body", "")).strip()
        suggestion = str(item.get("suggestion") or "").strip("\n")
        try:
            line_num = int(item.get("line", 0))
        except (TypeError, ValueError):
            line_num = 0

        if not path or not body:
            continue

        in_diff = line_num in valid_lines_by_file.get(path, set())
        findings.append(
            {
                "path": path,
                "line": line_num,
                "body": body,
                "suggestion": suggestion,
                "linked": in_diff,
                "snippet": line_at(path, line_num).strip() if in_diff else "",
            }
        )

    return findings


def render_finding(finding: dict) -> str:
    """Render one finding as a Markdown bullet, linking its line in the diff."""
    repo = os.environ["REPO"]
    head_sha = os.environ["HEAD_SHA"]
    path, line_num = finding["path"], finding["line"]
    if finding.get("linked"):
        url = f"https://github.com/{repo}/blob/{head_sha}/{path}#L{line_num}"
        location = f"[`{path}:{line_num}`]({url})"
    else:
        location = f"`{path}` (line {line_num or '?'})"
    text = f"- {location}: {finding['body']}"
    suggestion = finding.get("suggestion", "")
    if suggestion.strip():
        fence = "~~~" if "```" in suggestion else "```"
        code = "\n".join(f"  {ln}" if ln else "" for ln in suggestion.splitlines())
        text += f"\n\n  {fence}\n{code}\n  {fence}"
    return text


def render_resolved(finding: dict) -> str:
    """Render a finding whose code has since changed, struck through."""
    body = " ".join(finding["body"].split())
    if len(body) > 200:
        body = body[:197].rstrip() + "..."
    body = body.replace("~", "")
    where = f"`{finding['path']}:{finding['line']}`"
    return f"- ~~{where}: {body}~~ (code changed in {finding['resolved_in'][:7]})"


def code_changed(finding: dict) -> bool:
    """Return True when the line a finding pointed at is gone from the file at HEAD."""
    snippet = finding.get("snippet", "")
    if not snippet:
        return False
    try:
        lines = read_text(finding["path"]).splitlines()
    except OSError:
        return True
    # Snippets are stored trimmed, so compare against trimmed lines.
    return snippet not in (ln.strip()[:MAX_STATE_TEXT] for ln in lines)


def find_resolved(previous: dict, findings: list[dict]) -> list[dict]:
    """Carry over resolved findings and add earlier ones whose code has changed."""
    head_sha = os.environ["HEAD_SHA"]
    # A finding reported again at the same place is still open, not resolved.
    open_locations = {(f["path"], f["line"]) for f in findings}
    newly = [
        {**f, "resolved_in": head_sha}
        for f in previous.get("findings", [])
        if code_changed(f) and (f["path"], f["line"]) not in open_locations
    ]
    return (newly + previous.get("resolved", []))[:MAX_RESOLVED]


def is_clean_review(parsed: dict, findings: list[dict]) -> bool:
    """Return True only for an explicit "clean" verdict with an empty comments list.

    A missing verdict or comments field, or an unparseable reply, is never clean.
    """
    if parsed.get("unparsed") or findings:
        return False
    if str(parsed.get("verdict", "")).strip().lower() != "clean":
        return False
    raw_comments = parsed.get("comments")
    return isinstance(raw_comments, list) and not raw_comments


def may_auto_approve() -> bool:
    """Return True when the PR author is allowed to receive automatic approvals.

    The diff is author-controlled and could try to talk the model into a clean
    verdict, so only trusted authors get an approval.
    """
    allowed = os.environ.get("AUTO_APPROVE_AUTHORS", DEFAULT_APPROVE_AUTHORS)
    authors = {a.strip().lower() for a in allowed.split(",") if a.strip()}
    return os.environ.get("PR_AUTHOR", "").strip().lower() in authors


class GitHubError(RuntimeError):
    """A GitHub API call failed with an HTTP error."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def github_api(method: str, path: str, payload: dict | None = None):
    """Call the GitHub REST API and return the decoded JSON response."""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['REPO']}{path}",
        data=data,
        headers={
            "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        message = f"GitHub {method} {path} HTTP {exc.code}: {body}"
        raise GitHubError(exc.code, message) from exc
    return json.loads(raw) if raw else None


def list_all(path: str) -> list[dict]:
    """Fetch every page of a GitHub list endpoint."""
    items: list[dict] = []
    page = 1
    while True:
        batch = github_api("GET", f"{path}?per_page=100&page={page}") or []
        items.extend(batch)
        if len(batch) < 100:
            return items
        page += 1


def is_bot(user: dict | None) -> bool:
    """Return True for the github-actions bot that GITHUB_TOKEN acts as."""
    return user is not None and user.get("login") == BOT_LOGIN


def compact(finding: dict) -> dict:
    """Keep only what later runs need, trimmed so the comment stays small."""
    kept = {
        "path": finding["path"],
        "line": finding["line"],
        "body": finding["body"][:MAX_STATE_TEXT],
        "snippet": finding.get("snippet", "")[:MAX_STATE_TEXT],
    }
    if finding.get("resolved_in"):
        kept["resolved_in"] = finding["resolved_in"]
    return kept


def encode_state(state: dict) -> str:
    """Encode the comment's hidden state (trimmed findings) as an HTML comment."""
    state = {key: [compact(f) for f in items] for key, items in state.items()}
    raw = base64.b64encode(json.dumps(state).encode("utf-8")).decode("ascii")
    return f"{STATE_PREFIX}{raw} -->"


def decode_state(body: str) -> dict:
    """Read the hidden state from an earlier comment, or {} if there is none."""
    # The real state is always the last line; earlier matches may be quoted text.
    start = body.rfind(STATE_PREFIX)
    if start < 0:
        return {}
    end = body.find("-->", start)
    raw = body[start + len(STATE_PREFIX) : end].strip()
    try:
        state = json.loads(base64.b64decode(raw, validate=True).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}
    if not isinstance(state, dict):
        return {}
    return {
        "findings": valid_entries(state.get("findings"), resolved=False),
        "resolved": valid_entries(state.get("resolved"), resolved=True),
    }


def valid_entries(items, resolved: bool) -> list[dict]:
    """Keep only well-formed findings from stored state."""
    if not isinstance(items, list):
        return []
    entries = []
    for item in items:
        if not isinstance(item, dict):
            continue
        path, line = item.get("path"), item.get("line")
        body, snippet = item.get("body"), item.get("snippet", "")
        if not (isinstance(path, str) and isinstance(line, int)):
            continue
        if not (isinstance(body, str) and isinstance(snippet, str)):
            continue
        entry = {"path": path, "line": line, "body": body, "snippet": snippet}
        if resolved:
            sha = item.get("resolved_in")
            if not (isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{7,40}", sha)):
                continue
            entry["resolved_in"] = sha
        entries.append(entry)
    return entries


def build_body(
    summary: str,
    findings: list[dict],
    resolved: list[dict],
    clean: bool,
    model: str,
) -> str:
    """Build the Markdown body of the single review comment."""
    head_sha = os.environ["HEAD_SHA"]
    parts = [COMMENT_MARKER, "## Ollama Pro PR Review", "", summary]
    if findings:
        rendered = [render_finding(f) for f in findings]
        parts += ["", f"**Findings ({len(findings)}):**", "", *rendered]
    elif clean:
        parts += ["", "No issues found."]
    if resolved:
        rendered = [render_resolved(f) for f in resolved]
        parts += ["", f"**Resolved ({len(resolved)}):**", "", *rendered]
    parts += ["", f"<sub>Reviewed commit {head_sha[:7]} with {model}.</sub>"]
    parts += [encode_state({"findings": findings, "resolved": resolved})]
    return "\n".join(parts)


def is_current_head() -> bool:
    """Return True while the reviewed commit is still the PR's head.

    A run for an older push can finish after a newer one; it must not
    overwrite the newer review.
    """
    pr = github_api("GET", f"/pulls/{os.environ['PR_NUMBER']}") or {}
    head = (pr.get("head") or {}).get("sha")
    reviewed = os.environ["HEAD_SHA"]
    if head != reviewed:
        current = head[:7] if head else "unknown"
        print(f"Skipping update: {reviewed[:7]} is no longer the PR head ({current}).")
        return False
    return True


def find_comment() -> dict | None:
    """Return the bot's existing review comment on the PR, if any."""
    pr_number = os.environ["PR_NUMBER"]
    for c in list_all(f"/issues/{pr_number}/comments"):
        if is_bot(c.get("user")) and COMMENT_MARKER in (c.get("body") or ""):
            return c
    return None


def upsert_comment(body: str, existing: dict | None) -> None:
    """Edit the existing review comment on the PR, or post it if there is none."""
    pr_number = os.environ["PR_NUMBER"]
    if not is_current_head():
        return
    if existing:
        comment_id = existing["id"]
        github_api("PATCH", f"/issues/comments/{comment_id}", {"body": body})
        print(f"Updated review comment #{comment_id}.")
    else:
        result = github_api("POST", f"/issues/{pr_number}/comments", {"body": body})
        print(f"Posted review comment #{result.get('id')}.")


def mark_not_reviewed(existing: dict | None, reason: str) -> None:
    """Note on the existing comment that the latest commit wasn't reviewed."""
    if not existing:
        return
    head_sha = os.environ["HEAD_SHA"]
    old_body = existing.get("body") or ""
    old_body = re.sub(
        r"\n\n> Latest commit [0-9a-f]+ was not reviewed: [^\n]*"
        + re.escape(STATUS_MARKER),
        "",
        old_body,
    )
    lines = old_body.splitlines()
    note = (
        f"> Latest commit {head_sha[:7]} was not reviewed: {reason} "
        f"The review below is from an earlier commit. {STATUS_MARKER}"
    )
    heading = "## Ollama Pro PR Review"
    at = lines.index(heading) + 1 if heading in lines else len(lines)
    lines[at:at] = ["", note]
    upsert_comment("\n".join(lines), existing)


def update_approval(clean: bool) -> bool:
    """Approve a clean PR once, and dismiss that approval if findings appear later.

    Only PRs from trusted authors (see may_auto_approve) are approved. Approving
    needs the repository setting "Allow GitHub Actions to create and
    approve pull requests"; if GitHub refuses, the comment still stands.
    Returns True when the PR is clean and carries the bot's approval.
    """
    pr_number = os.environ["PR_NUMBER"]
    reviews = [
        r
        for r in list_all(f"/pulls/{pr_number}/reviews")
        if is_bot(r.get("user")) and r.get("state") in ("APPROVED", "DISMISSED")
    ]
    approved = bool(reviews) and reviews[-1].get("state") == "APPROVED"

    try:
        if clean and not approved and may_auto_approve():
            github_api(
                "POST",
                f"/pulls/{pr_number}/reviews",
                {
                    "commit_id": os.environ["HEAD_SHA"],
                    "event": "APPROVE",
                    "body": "Ollama Pro review found no issues.",
                },
            )
            print("Approved the pull request.")
            approved = True
        elif not clean and approved:
            review_id = reviews[-1]["id"]
            github_api(
                "PUT",
                f"/pulls/{pr_number}/reviews/{review_id}/dismissals",
                {
                    "message": "Ollama Pro review found new issues.",
                    "event": "DISMISS",
                },
            )
            print(f"Dismissed earlier approval #{review_id}.")
            approved = False
    except GitHubError as exc:
        if exc.status not in (403, 422):
            raise
        print(f"Could not change approval: {exc}")
    return clean and approved


def set_output(name: str, value: str) -> None:
    """Pass a step output to later workflow steps and jobs."""
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")


def main() -> None:
    """Review the PR diff and post the result."""
    api_key = os.environ["OLLAMA_API_KEY"]
    model = os.environ.get("OLLAMA_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    raw_diff = read_text("pr.diff")
    no_ws_diff = read_text("pr-no-ws.diff")

    existing = find_comment()

    if not raw_diff.strip() or not no_ws_diff.strip():
        print(NO_DIFF_MESSAGE)
        mark_not_reviewed(existing, NO_DIFF_MESSAGE)
        return

    annotated_diff, valid_lines_by_file = annotate_diff(raw_diff, no_ws_diff)
    if not valid_lines_by_file:
        print(STYLE_ONLY_MESSAGE)
        mark_not_reviewed(existing, STYLE_ONLY_MESSAGE)
        return

    guidelines = read_text(GUIDELINES_FILE) if os.path.exists(GUIDELINES_FILE) else ""
    user_message = build_user_message(annotated_diff[:MAX_DIFF_CHARS], guidelines)
    try:
        parsed = request_review(api_key, user_message, model)
    except Exception:
        mark_not_reviewed(existing, "the Ollama request failed (see the workflow log).")
        # An approval from an earlier commit must not let unreviewed code auto-merge.
        if is_current_head():
            update_approval(False)
        raise
    findings = build_findings(parsed, valid_lines_by_file)
    clean = is_clean_review(parsed, findings)
    summary = str(parsed.get("summary", DEFAULT_SUMMARY)).strip() or DEFAULT_SUMMARY
    if parsed.get("unparsed"):
        summary = (
            "The model's reply wasn't valid JSON, so it's shown as-is:\n\n"
            f"~~~\n{summary}\n~~~"
        )

    previous = decode_state((existing or {}).get("body") or "")
    resolved = find_resolved(previous, findings)
    upsert_comment(build_body(summary, findings, resolved, clean, model), existing)
    if is_current_head() and update_approval(clean):
        set_output("approved", "true")


if __name__ == "__main__":
    main()
