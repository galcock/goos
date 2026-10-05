# Goos: The Super Intelligent Web Browser

Goos is a web browser that learns how you work, sees what you're doing, and does
the next thing before you ask. Its brain runs on your own Mac, so there's no
cloud AI and no API key. It searches with [Goos](https://goos.si), the super
intelligent search engine. It's made by [Ameka](https://ameka.ai).

**Download:** [goos.si/download](https://goos.si/download)

Install it in one step. On a Mac, in Terminal:

```sh
curl -fsSL https://goos.si/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://goos.si/install.ps1 | iex
```

Goos runs on Macs with Apple silicon (M1 or newer) and macOS 13 or later, and
on 64-bit Windows 10 and 11. It thinks with [Ollama](https://ollama.com/download),
the free engine that runs its brain; both installers add it if it's missing.
Using other apps and talking to Goos are Mac-only for now.

This repository holds Goos's releases. Each release has a Mac disk image
(`Goos-mac-arm64.dmg`), a Mac zip (`Goos-mac-arm64.zip`), and Windows zips for
Intel and AMD PCs (`Goos-win-x64.zip`) and ARM PCs (`Goos-win-arm64.zip`).
