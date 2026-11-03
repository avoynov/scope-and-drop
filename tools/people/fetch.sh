#!/bin/bash
# Download MakeHuman assets (LFS files) listed one per line in $1, as paths under
# assets/make_human/ in the slyedoc/bevy_make_human mirror, into $MHDATA (default ./mhdata).
# The MakeHuman site itself (static.makehumancommunity.org) may be blocked; this mirror holds the
# same community asset packs. Each asset keeps its own licence (see the .mhclo header).
#   git clone --depth 1 --filter=blob:none --sparse https://github.com/slyedoc/bevy_make_human
#   (cd bevy_make_human && git ls-tree -r --name-only HEAD assets/make_human/ | grep <what you want>) > want.txt
#   tools/people/fetch.sh want.txt
set -euo pipefail
MHDATA=${MHDATA:-mhdata}
while read -r p; do
  rel=${p#assets/make_human/}
  out="$MHDATA/$rel"
  if [ -s "$out" ] && [ "$(head -c 7 "$out")" != "version" ]; then continue; fi
  mkdir -p "$(dirname "$out")"
  echo "$p"
done <"$1" | xargs -P 8 -I{} sh -c 'p="{}"; rel=${p#assets/make_human/}; curl -sS --retry 3 -o "'"$MHDATA"'/$rel" "https://media.githubusercontent.com/media/slyedoc/bevy_make_human/main/$p" || echo FAIL $p'
