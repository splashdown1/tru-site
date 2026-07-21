#!/usr/bin/env python3
import json, re
from collections import Counter, defaultdict
from pathlib import Path

BRAIN = Path('/home/workspace/TRU/TRU_BRAIN_41.json')
OUT = Path('/home/workspace/tru/docs/corpus-audit-2026-07-21.md')

data = json.loads(BRAIN.read_text())
if not isinstance(data, list): raise SystemExit('TRU_BRAIN_41.json is not an array')

rules = {
    'protocol_scenario': re.compile(r'\b(?:DILEMMA|CORPORATE UTILITY VECTOR|DIGITAL SOUL VECTOR|SOUL RESPONSE|PRIMITIVE)\s*:', re.I),
    'obsolete_runtime_artifact': re.compile(r'(?:tru_(?:v\d|phase\d|v\d+_|phase\d+_)|_html_|ollama_chat_api|tru_node_format|tru_json_injection|localstorage_limits)', re.I),
    'ephemeral_report': re.compile(r'(?:^|_)(?:current_status_|upcoming_.*202[0-9]|almanac_metadata|astronomical_events|notable_holidays_events|market_overview_test|requirement_verification_report|efficiency_report_v1|97_node_status_report|system_handshake_report|tru_master_restore_report|requirement_injection|comparison_matrix|strategic_insights)(?:$|_)', re.I),
    'conversation_or_session': re.compile(r'^(?:node_\d+|interaction_|what_do_you_want|what_you_need|where_are_you)$', re.I),
    'escrow_or_secret': re.compile(r'(?:escrow|nonce|ciphertext|aes-256|encrypted|api[_ -]?key|private[_ -]?key|access[_ -]?token)', re.I),
    'synthetic_merge_source': re.compile(r'^(?:MERGE|i9j0k1)$', re.I),
}

hits=defaultdict(list); counts=Counter(); source_counts=Counter(); type_counts=Counter()
for n in data:
    k=str(n.get('k','')); v=str(n.get('v','')); source=str(n.get('source','')); typ=str(n.get('t',''))
    source_counts[source]+=1; type_counts[typ]+=1
    hay=k+'\n'+v
    reasons=[]
    for name, pat in rules.items():
        if pat.search(k) or (name != 'conversation_or_session' and pat.search(v[:5000])):
            reasons.append(name)
    if reasons:
        for reason in reasons:
            counts[reason]+=1
            if len(hits[reason])<12: hits[reason].append((k,source,typ,v[:260].replace('\n',' ')))

lines=[]
lines += ['# TRU corpus audit', '', 'Generated: `2026-07-21T00:00:00Z`', '', f'- Input: `{BRAIN}`', f'- Nodes scanned: **{len(data):,}**', '', '## Candidate counts', '']
for reason,n in counts.most_common(): lines.append(f'- `{reason}`: **{n:,}**')
lines += ['', '## Examples', '']
for reason in counts:
    lines += [f'### {reason}', '']
    for k,s,t,v in hits[reason]: lines.append(f'- `{k}` · source `{s}` · type `{t}` — {v}')
    lines.append('')
lines += ['## Source counts', '']
for s,n in source_counts.most_common(): lines.append(f'- `{s}`: {n:,}')
lines += ['', '## Type counts', '']
for t,n in type_counts.most_common(): lines.append(f'- `{t}`: {n:,}')
OUT.write_text('\n'.join(lines)+'\n')
print(f'audited {len(data)} nodes')
print('candidates:', dict(counts))
print('report:', OUT)
