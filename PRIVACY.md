# Privacy

Boss is a Claude Code plugin made of markdown files and one local shell hook. It has no server, collects no data and sends nothing to its author.

**What it reads.** The files and command output in the repo you are working in, through your own Claude Code session, only to do the task you asked for.

**What it stores.** When you state a standing preference ("keep reports short"), boss saves it to Claude Code's own auto-memory on your machine. It offers a one-line addition to `~/.claude/CLAUDE.md` and writes it only if you say yes. It never stores passwords, tokens or keys.

**What it sends.** Nothing by itself. Subagents run inside your Claude Code session on your Anthropic account, under Anthropic's terms. If you name Codex or another model CLI (Gemini, Kimi, Qwen, Cursor, Ollama…), boss calls that vendor's CLI on your machine, which sends the prompt and the code it reads to that vendor under your account and their terms. Without that ask, nothing goes to them.

**Credentials.** Boss reads no credentials. Outside CLIs use the login you already set up for them.

**Children.** Boss is a developer tool and is not intended for users under 18.

**Contact.** Questions: open an issue at https://github.com/mefayed/boss-skill/issues.
