#!/usr/bin/env python3
import json
import re
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

BRAIN = Path('/home/workspace/TRU/TRU_BRAIN_41.json')
ROOT = Path('/home/workspace/tru')
STAMP = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
BACKUP = BRAIN.with_name(f'{BRAIN.name}.pre-clean-{STAMP}.bak')
AUDIT = ROOT / 'docs' / f'corpus-clean-{STAMP}.md'

protocol = re.compile(r'\b(?:DILEMMA|CORPORATE UTILITY VECTOR|DIGITAL SOUL VECTOR|SOUL RESPONSE|PRIMITIVE)\s*:', re.I)
obsolete = re.compile(r'(?:tru_(?:v\d|phase\d|v\d+_|phase\d+_)|_html_|ollama_chat_api|tru_node_format|tru_json_injection|localstorage_limits)', re.I)
ephemeral = re.compile(r'(?:^|_)(?:current_status_|upcoming_.*202[0-9]|almanac_metadata|astronomical_events|notable_holidays_events|market_overview_test|requirement_verification_report|efficiency_report_v1|97_node_status_report|system_handshake_report|tru_master_restore_report|requirement_injection|comparison_matrix|strategic_insights)(?:$|_)', re.I)
conversation = re.compile(r'^(?:node_\d+|interaction_|what_do_you_want|what_you_need|where_are_you)$', re.I)
secret = re.compile(r'(?:redline_escrow|key escrow|# key=|key \(base16|sha256 of raw key|aes-256-gcm with salt|ciphertext-only mode)', re.I)

# These source labels are malformed historical placeholders. They are normalised,
# not deleted, because the records are still part of TRU's identity layer.
source_map = {'i9j0k1': 'TRU_CORE', 'f6g7h8': 'TRU_CORE', 'g7h8i9': 'TRU_CORE', 'h8i9j0': 'TRU_CORE', '': 'TRU_KNOWLEDGE'}

data = json.loads(BRAIN.read_text())
if not isinstance(data, list): raise SystemExit('canonical brain is not an array')
shutil.copy2(BRAIN, BACKUP)
removed = []
normalised = 0
seen = {}
kept = []
for node in data:
    if not isinstance(node, dict):
        removed.append(('invalid_node', '', 'not an object'))
        continue
    k = str(node.get('k', '')).strip()
    v = str(node.get('v', '')).strip()
    hay = k + '\n' + v[:5000]
    reason = None
    if protocol.search(hay): reason = 'protocol_scenario'
    elif secret.search(hay): reason = 'secret_or_escrow_artifact'
    elif obsolete.search(hay): reason = 'obsolete_runtime_artifact'
    elif ephemeral.search(k): reason = 'ephemeral_report'
    elif conversation.search(k): reason = 'conversation_or_session'
    elif str(node.get('source', '')) == 'MERGE' and (k.startswith(('base_', 'manifesto_training_set_v1_json_', 'mirror_', 'task005_', 'task008_', 'task009_', 'task014_', 'task015_', 'baseline_', 'early_onset_', 'public_signal_disclosure_')) or k in {'trained_on_coil_batches', 'corporate_utility_vector', 'digital_soul', 'digital_soul_definition', 'digital_soul_vector'}): reason = 'historical_merge_artifact'
    if reason:
        removed.append((reason, k, str(node.get('source', ''))))
        continue
    if not k or not v:
        removed.append(('empty_node', k, str(node.get('source', ''))))
        continue
    node = dict(node)
    old_source = str(node.get('source', ''))
    if old_source in source_map:
        node['source'] = source_map[old_source]
        normalised += 1
    # The three duplicated theological keys are retained as the higher-weight,
    # more detailed canonical entry.
    if k in seen:
        prior = seen[k]
        prior_score = (float(prior.get('w', 0)), len(str(prior.get('v', ''))))
        current_score = (float(node.get('w', 0)), len(v))
        if current_score > prior_score:
            kept[kept.index(prior)] = node
            seen[k] = node
        removed.append(('duplicate_key', k, old_source))
        continue
    seen[k] = node
    kept.append(node)

# Stable output keeps the corpus reproducible and makes future audits diffable.
kept.sort(key=lambda n: n['k'])
BRAIN.write_text(json.dumps(kept, ensure_ascii=False, separators=(',', ':')))

counts = Counter(r for r, _, _ in removed)
lines = [
    '# TRU corpus clean', '',
    f'Generated: `{datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}`', '',
    f'- Input: `{BRAIN}`', f'- Backup: `{BACKUP}`', f'- Before: **{len(data):,}** nodes', f'- After: **{len(kept):,}** nodes', f'- Removed: **{len(removed):,}** nodes', f'- Source labels normalised: **{normalised:,}**', '', '## Removed by reason', ''
]
for reason, count in counts.most_common(): lines.append(f'- `{reason}`: **{count:,}**')
lines += ['', '## Removed keys', '']
for reason, k, source in removed:
    lines.append(f'- `{k}` · `{reason}` · source `{source}`')
AUDIT.parent.mkdir(parents=True, exist_ok=True)
AUDIT.write_text('\n'.join(lines) + '\n')
print(json.dumps({'ok': True, 'before': len(data), 'after': len(kept), 'removed': len(removed), 'counts': dict(counts), 'normalised_sources': normalised, 'backup': str(BACKUP), 'report': str(AUDIT)}, indent=2))
