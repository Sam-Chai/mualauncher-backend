#!/bin/sh
# Administrator operation. Installs a reviewed complete gVisor release, not a lone runsc binary.
set -eu
umask 022
[ "$(uname -s)" = Linux ] || { echo 'Run this inside Linux (the Colima guest on macOS)' >&2; exit 1; }
arch=$(uname -m)
case "$arch" in x86_64|aarch64) ;; *) echo 'Unsupported architecture' >&2; exit 1;; esac
: "${RUNSC_VERSION:?Set an exact YYYYMMDD.N point release}"
: "${RUNSC_SHA512:?Set the reviewed SHA-512 of gvisor.tar.bz2 for this architecture}"
printf '%s' "$RUNSC_VERSION" | grep -Eq '^[0-9]{8}\.[0-9]+$'
printf '%s' "$RUNSC_SHA512" | grep -Eq '^[a-f0-9]{128}$'
base=${RUNSC_INSTALL_ROOT:-/opt/union-link/runsc}
config=${RUNSC_DAEMON_CONFIG:-/etc/docker/daemon.json}
target="$base/$RUNSC_VERSION-$arch"
if [ -f "$target/.bundle-sha512" ]; then
    [ "$(cat "$target/.bundle-sha512")" = "$RUNSC_SHA512" ] || { echo 'Installed release checksum conflict' >&2; exit 1; }
else
    [ ! -e "$target" ] || { echo 'Incomplete release directory; inspect it before retrying' >&2; exit 1; }
    temporary=$(mktemp -d)
    trap 'rm -f "$temporary/bundle.tar.bz2"; rmdir "$temporary"' EXIT HUP INT TERM
    curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 300 \
        "https://storage.googleapis.com/gvisor/releases/release/$RUNSC_VERSION/$arch/gvisor.tar.bz2" -o "$temporary/bundle.tar.bz2"
    printf '%s  %s\n' "$RUNSC_SHA512" "$temporary/bundle.tar.bz2" | sha512sum -c -
    mkdir -p "$target"
    chmod 755 "$base" "$target"
    tar -xjf "$temporary/bundle.tar.bz2" -C "$target"
    test -x "$target/runsc" && test -d "$target/gvisor-bin"
    printf '%s' "$RUNSC_SHA512" > "$target/.bundle-sha512"
fi
"$target/runsc" --version
# Merge only this runtime; preserve all existing daemon settings. Keep a dated backup.
RUNSC_RUNTIME_PATH="$target/runsc" RUNSC_CONFIG_PATH="$config" python3 - <<'PY'
import os, json, pathlib, tempfile, datetime
path = pathlib.Path(os.environ['RUNSC_CONFIG_PATH'])
path.parent.mkdir(parents=True, exist_ok=True)
old = path.read_bytes() if path.exists() else b'{}'
config = json.loads(old)
runtime = {'path': os.environ['RUNSC_RUNTIME_PATH'], 'runtimeArgs': ['--platform=systrap']}
if config.get('runtimes', {}).get('runsc') != runtime:
    if path.exists():
        backup = path.with_name(path.name + '.before-unionlink-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        backup.write_bytes(old); backup.chmod(0o600)
    config.setdefault('runtimes', {})['runsc'] = runtime
    fd, name = tempfile.mkstemp(dir=path.parent)
    with os.fdopen(fd, 'w') as out: json.dump(config, out, indent=2); out.write('\n')
    os.chmod(name, 0o600); os.replace(name, path)
PY
echo 'Runtime registered. Reload/restart Docker in your maintenance window, then run npm run sandbox:check.'
