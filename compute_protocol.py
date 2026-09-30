"""Cheap request validation and a shared, content-addressed compute revision."""
from functools import lru_cache
import hashlib
import json
from pathlib import Path

from configuration import OBJECTIVES, objective, parse_config as normalize

ROOT = Path(__file__).resolve().parent
def computed_objectives(value):
    value = objective(value)
    return list(OBJECTIVES) if value == 'all' else ['shortest', 'cheapest'] if value == 'cheapest' else [value]


def objective_result(result, requested):
    """Project a completed result without confusing unsearched and infeasible."""
    wanted = computed_objectives(requested)
    completed = [key for key in wanted if key in result.get('computedObjectives', [])]
    return {**result, 'objective': requested, 'computedObjectives': completed,
            'solutions': {k: v for k, v in result['solutions'].items() if k in completed}}


def encode(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


@lru_cache(maxsize=1)
def revision():
    names = ['game_data.py', 'configuration.py', 'search_context.py', 'compute_protocol.py', 'optimal.py', 'routes.py', 'planner.py', 'mixed.py',
             'search_graph.py', 'essences.py', 'skill_text.py', 'unlock_text.py',
             'innate_text.py', 'native_engine.py', 'compute_worker.py', 'engine_limited.py', 'native/optimal.cpp']
    names += [str(p.relative_to(ROOT)) for p in sorted((ROOT / 'data').glob('*.json'))
              if p.name not in ('demon-profiles.json', 'demon-traits.json')]
    digest = hashlib.sha256()
    for name in names:
        digest.update(name.encode() + b'\0' + (ROOT / name).read_bytes() + b'\0')
    return digest.hexdigest()


def identifier(value, title='计算请求编号'):
    if not isinstance(value, str) or not 1 <= len(value) <= 80:
        raise ValueError(title + '不合法。')
    return value


def cache_key(kind, config, version):
    return hashlib.sha256(encode([version, kind, config]).encode()).hexdigest()
