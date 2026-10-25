#!/bin/sh
# Creates a new dedicated Colima profile only. Does not start/reconfigure an existing VM.
set -eu
[ "$(uname -s)" = Darwin ] || { echo 'macOS only' >&2; exit 1; }
[ "$(sw_vers -productVersion | cut -d. -f1)" -ge 13 ] || { echo 'macOS 13+ required for VZ' >&2; exit 1; }
[ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" != 1 ] || { echo 'Use a native terminal; Rosetta provisioning is unsupported' >&2; exit 1; }
command -v colima >/dev/null
: "${RUNSC_VERSION:?Set exact YYYYMMDD.N}"
: "${RUNSC_SHA512:?Set reviewed native architecture release bundle SHA-512}"
printf '%s' "$RUNSC_VERSION" | grep -Eq '^[0-9]{8}\.[0-9]+$'
printf '%s' "$RUNSC_SHA512" | grep -Eq '^[a-f0-9]{128}$'
script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export RUNSC_VERSION RUNSC_SHA512
export UNIONLINK_PROVISION_SOURCE="$script_directory/install-runsc.sh"
python3 - <<'PY'
import os, json, pathlib, shlex, shutil
home = pathlib.Path(os.environ.get('COLIMA_HOME', str(pathlib.Path.home() / '.colima'))).resolve()
profile = home / 'union-link'
config = profile / 'colima.yaml'
if config.exists(): raise SystemExit('Profile already configured; review it instead of overwriting it')
provision = home / 'union-link-provision'
provision.mkdir(parents=True, exist_ok=True)
shutil.copyfile(os.environ['UNIONLINK_PROVISION_SOURCE'], provision / 'install-runsc.sh')
profile.mkdir(parents=True, exist_ok=True)
version, checksum = os.environ['RUNSC_VERSION'], os.environ['RUNSC_SHA512']
script = '''set -eu
missing=0
for executable in curl python3 sha512sum tar bunzip2; do
  command -v "$executable" >/dev/null || missing=1
done
if [ "$missing" = 1 ]; then
  command -v apt-get >/dev/null
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl python3 bzip2
fi
RUNSC_VERSION=''' + shlex.quote(version) + ' RUNSC_SHA512=' + shlex.quote(checksum) + ' sh ' + shlex.quote(str(provision / 'install-runsc.sh'))
data = {'cpu': 4, 'memory': 10, 'disk': 60, 'rootDisk': 20, 'arch': 'host', 'runtime': 'docker',
        'autoActivate': False, 'vmType': 'vz', 'mountType': 'virtiofs', 'rosetta': False, 'binfmt': False,
        'forwardAgent': False, 'sshConfig': False, 'kubernetes': {'enabled': False},
        # A nonempty explicit mount list replaces the default writable home share.
        'mounts': [{'location': str(provision), 'writable': False}],
        'docker': {'runtimes': {'runsc': {'path': '/opt/union-link/runsc/' + version + '-' + ('aarch64' if os.uname().machine == 'arm64' else 'x86_64') + '/runsc', 'runtimeArgs': ['--platform=systrap']}}},
        'provision': [{'mode': 'after-boot', 'script': script}]}
with config.open('x') as out: json.dump(data, out, indent=2); out.write('\n')
print('Created', config)
print('Start: colima start --profile union-link --foreground')
print('Worker: SANDBOX_DOCKER_CONTEXT=colima-union-link')
PY
