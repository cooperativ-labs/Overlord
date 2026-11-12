#!/bin/sh
# Mechanical contract alignment check (contract/CONTRACT.md section 6). Runs on
# every push and pull request through .github/workflows/contract.yml and as
# part of `yarn check`. Dependency-free: it needs only POSIX sh and Node.
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
contract_dir="$root_dir/contract"

fail() {
  echo "contract check failed: $*" >&2
  exit 1
}

required_files='CONTRACT.md
VERSION
CHANGELOG.md
architecture.md
protocol.md
authorization.md
conformance.md
data/README.md
decisions/README.md
components.yaml
protocol-commands.yaml
extension-points.yaml
conformance-manifest.schema.yaml
harness-capabilities.schema.yaml
api/openapi.yaml
api/openapi-ratchet.json'

printf '%s\n' "$required_files" | while IFS= read -r relative_path; do
  [ -f "$contract_dir/$relative_path" ] || fail "missing contract/$relative_path"
  [ -s "$contract_dir/$relative_path" ] || fail "empty contract/$relative_path"
done

# The REST surface is specified by contract/api/openapi.yaml (ADR 0006); the
# rules it cannot express live in the topic documents (ADR 0051), so the retired
# holding file contract/api/rest-notes.md must not come back as a second home.
# The OpenAPI structural check (operationIds and the schema-stub ratchet, ADR 0048)
# is dependency-free like this script.
[ ! -e "$contract_dir/api/rest-notes.md" ] \
  || fail "contract/api/rest-notes.md was retired in phase 4d (ADR 0051); REST rules belong in api/openapi.yaml or the topic documents"
node "$root_dir/scripts/check-openapi.mjs" >/dev/null \
  || fail "contract/api/openapi.yaml failed its structural check (see above)"

# The contract has one home. A root CONTRACT.md would be a second authority.
[ ! -e "$root_dir/CONTRACT.md" ] \
  || fail "CONTRACT.md exists at the repository root; the contract lives in contract/"

for instructions in AGENTS.md CLAUDE.md; do
  grep -Fq 'contract/CONTRACT.md' "$root_dir/$instructions" \
    || fail "$instructions does not direct agents to contract/CONTRACT.md"
done

# Every decision record is listed in the index, and every index entry exists.
for record in "$contract_dir"/decisions/[0-9][0-9][0-9][0-9]-*.md; do
  [ -e "$record" ] || continue
  name=$(basename "$record")
  grep -Fq "($name)" "$contract_dir/decisions/README.md" \
    || fail "contract/decisions/$name is not listed in contract/decisions/README.md"
done
grep -o '([0-9][0-9][0-9][0-9]-[^)]*\.md)' "$contract_dir/decisions/README.md" \
  | tr -d '()' | while IFS= read -r name; do
  [ -f "$contract_dir/decisions/$name" ] \
    || fail "contract/decisions/README.md lists $name, which does not exist"
done

# The shared strict Semantic Versioning parser validates the contract version:
# VERSION, the CONTRACT.md header, the current CHANGELOG.md heading, the
# components.yaml contractVersion and the OpenAPI
# info.x-overlord-contract-version must agree; OpenAPI info.version is checked
# for strict Semantic Versioning only.
node "$root_dir/scripts/version-contract.mjs" --check >/dev/null \
  || fail "contract version files are inconsistent (see above)"

version=$(tr -d '[:space:]' < "$contract_dir/VERSION")
echo "contract check passed for $version"
