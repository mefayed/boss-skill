# Privacy

Boss is a Claude Code plugin. It comes in two builds: the one in Anthropic's plugin directory is markdown files only, with no hooks and no scripts; the one installed from GitHub adds one hooks module for the live card and learning, described below. Neither has a server, collects data or sends anything to its author.

**What it reads.** The files and command output in the repo you are working in, through your own Claude Code session, only to do the task you asked for.

**The live card.** It reads boss's own agent events in the session, Claude Code's usage numbers (context % and plan limit %), and the modified times of files a proven test covers. It saves small settings (hidden, compact, a daily run count) through Claude Code's plugin store on this machine. It sends nothing anywhere.

**What it stores.** When you state a standing preference ("keep reports short"), boss saves it to Claude Code's own auto-memory on your machine. It offers a one-line addition to `~/.claude/CLAUDE.md` and writes it only if you say yes. It never stores passwords, tokens or keys. The handoff is separate: `/boss:handoff` only prints a checkpoint in chat for you to keep. Boss does not store or read it.

**Learning.** When an agent starts, the hooks read the `## Boss lessons` section of `~/.claude/CLAUDE.md` and the current project's memory folder (`~/.claude/projects/<project>/memory/`), and copy up to five matching lessons into that agent's brief. Before a memory edit they read that file to check its size limit. Of your message they check only whether it starts with `/boss`. At the end of a turn they read boss's reply to check two rules (questions are numbered, and "learned" comes only after a saved file), and keep nothing of it. The hooks write no files. Boss writes lessons with Claude Code's normal file tools: to `~/.claude/CLAUDE.md` only after your one-time yes, otherwise to the project's memory. Text you wrap in `<private>…</private>` is never saved. Nothing goes anywhere new: a lesson in a brief travels with the brief, inside your Claude Code session.

**What it sends.** Nothing by itself. Subagents run inside your Claude Code session on your Anthropic account, under Anthropic's terms. If you name Codex or another model CLI (Gemini, Kimi, Qwen, Cursor, Ollama…), boss calls that vendor's CLI on your machine, which sends the prompt and the code it reads to that vendor under your account and their terms. Without that ask, nothing goes to them.

**Credentials.** Boss reads no credentials. Outside CLIs use the login you already set up for them.

**Children.** Boss is a developer tool and is not intended for users under 18.

**Contact.** Questions: open an issue at https://github.com/mefayed/boss-skill/issues.
