# Development

## Set up a source checkout

Use Node.js 22.19.0 or newer. These commands require the repository checkout; scripts and tests are not included in the installable package.

```bash
git clone https://github.com/hyein-cbio/pi-codemode-usage.git
cd pi-codemode-usage
npm ci
npm run check
npm run replay
npm pack --dry-run --ignore-scripts
```

- `npm run check`: TypeScript checks against Pi 1.3.0 plus all tests.
- `npm run replay`: record two synthetic calls without a model, verify the metadata does not contain script source, and print a summary. It creates a temporary SQLite database and prints its path.
- CI repeats these checks on Node 22.19.0, 22, 24, and 26.

Runtime imports use Node's standard library only. Pi is a development dependency for types and the local CLI, and a `*` peer dependency because the host provides it at runtime. Do not bundle a second Pi installation.

## Run Pi locally

```bash
npm run dev
```

This runs `pi --tools +codemode`. After you trust the project, Pi reads `.pi/settings.json`:

```json
{
  "packages": [".."],
  "defaultTools": ["+codemode"]
}
```

The `..` package path is relative to `.pi/settings.json`, so it points at the repository root.

To load just this extension for one invocation, without trusting project resources:

```bash
pi -e ./extensions/codemode-usage.ts --tools +codemode --no-approve
```

Do not add `-e` on top of trusted package loading: that can load the extension twice and duplicate records.

To save a project-local package declaration, use `pi install . -l`. Pi does not install dependencies for local packages; run `npm ci` yourself in the checkout.

## CLI reports

Run from the repository root:

```bash
npm run report
npm run report -- --session <session-id>
npm run report -- --file /path/to/<session-id>.sqlite
npm run report -- --dir /path/to/usage-directory
```

Reports use the same directory settings as the extension. See [storage](storage.md) for environment variables, schema, and direct SQL queries.

## Contributing

Open an issue for a proposal or send a pull request with a focused change. Add tests for changed behavior, run `npm run check` and `npm run replay`, and keep English/Korean quick-start documentation consistent. Do not attach real databases, session logs, credentials, or private paths.

Report vulnerabilities privately as described in [SECURITY.md](../SECURITY.md).

## Release 0.1.0

The package manifest, lockfile, Git tag `v0.1.0`, and GitHub release identify the same release version. Historical commits are retained; the release tag includes all changes up to its target commit.

The tag was realigned for the public release from a pre-rename development snapshot. If you cached that earlier tag, remove and reinstall the package; simply reloading an old checkout will not replace it.

Before releasing, require CI to pass, inspect `npm pack --dry-run --ignore-scripts`, and check for credentials and local databases. GitHub releases do not publish to npm automatically.
